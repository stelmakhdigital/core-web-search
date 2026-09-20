import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildCoreTools, type ToolHost } from '../src/tools/index.ts'
import { WebStore } from '../src/store/index.ts'
import { resolveCoreConfig } from '../src/config.ts'
import { CoreError } from '../src/errors.ts'
import type { FetchResult, LlmClient, PlatformSearchResult, SearchResult } from '../src/types.ts'

function makeHost(overrides: {
  search?: (request: unknown) => Promise<SearchResult>
  fetch?: (request: { url: string }) => Promise<FetchResult>
  platform?: (request: unknown) => Promise<PlatformSearchResult>
  platformsEnabled?: boolean
  llm?: LlmClient
} = {}): { host: ToolHost; store: WebStore } {
  const store = new WebStore({ path: ':memory:' })
  const config = resolveCoreConfig({ platforms: { enabled: overrides.platformsEnabled ?? true } }, '/tmp')
  const host: ToolHost = {
    config,
    store,
    search: overrides.search ?? (async () => ({ sources: [], truncated: false })),
    fetch: overrides.fetch ?? (async () => ({ url: 'https://example.com', statusCode: 200, body: { kind: 'text', content: 'hi' }, truncated: false })),
    platformSearch: overrides.platform ?? (async () => ({ platform: 'github', query: 'q', sources: [], truncated: false })),
    llm: overrides.llm,
  }
  return { host, store }
}

const noop = { signal: new AbortController().signal }

describe('buildCoreTools', () => {
  afterEach(() => undefined)

  it('exposes the six v1.0 tools in order', () => {
    const { host } = makeHost()
    const names = buildCoreTools(host).map((tool) => tool.name)
    expect(names).toEqual(['web_search', 'web_fetch', 'web_platform_search', 'web_history', 'web_search_stats', 'web_cache_clear'])
    for (const tool of buildCoreTools(host)) {
      expect(tool.parameters.type).toBe('object')
      expect(tool.description.length).toBeGreaterThan(10)
    }
  })

  it('drops web_platform_search when platforms are disabled', () => {
    const { host } = makeHost({ platformsEnabled: false })
    const names = buildCoreTools(host).map((tool) => tool.name)
    expect(names).not.toContain('web_platform_search')
    expect(names).toHaveLength(5)
  })

  it('web_search merges multiple queries and deduplicates by URL', async () => {
    let calls = 0
    const { host } = makeHost({
      search: async () => {
        calls += 1
        return {
          sources: [
            { url: 'https://example.com/a', title: 'A', snippet: 'snip-a' },
            { url: 'https://example.com/b/', title: 'B' },
          ],
          truncated: false,
        } satisfies SearchResult
      },
    })
    const spec = buildCoreTools(host).find((tool) => tool.name === 'web_search')!
    const out = await spec.execute({ queries: ['q1', 'q2'], max_results: 10 }, noop)
    expect(calls).toBe(2)
    expect(out.isError).toBeUndefined()
    const details = out.details as { sources: { url: string }[]; queries: string[] }
    expect(details.queries).toEqual(['q1', 'q2'])
    // example.com/a and example.com/b/ normalize to distinct URLs; both kept.
    expect(details.sources).toHaveLength(2)
    expect(out.text).toContain('1. A')
    expect(out.text).toContain('https://example.com/a')
    expect(out.text).toContain('2. B')
  })

  it('web_search truncates to max_results', async () => {
    const sources = Array.from({ length: 30 }, (_, i) => ({ url: `https://example.com/${i}` }))
    const { host } = makeHost({ search: async () => ({ sources, truncated: true }) })
    const spec = buildCoreTools(host).find((tool) => tool.name === 'web_search')!
    const out = await spec.execute({ queries: ['q'], max_results: 5 }, noop)
    const details = out.details as { sources: unknown[] }
    expect(details.sources).toHaveLength(5)
    expect(out.text).toContain('(truncated to 5 sources)')
  })

  it('web_search rejects invalid arguments with WEB_BAD_REQUEST', async () => {
    const { host } = makeHost()
    const spec = buildCoreTools(host).find((tool) => tool.name === 'web_search')!
    const bad = await spec.execute({ queries: [] }, noop)
    expect(bad.isError).toBe(true)
    expect(bad.text).toContain('WEB_BAD_REQUEST')
    const notString = await spec.execute({ queries: 'not-an-array' }, noop)
    expect(notString.isError).toBe(true)
  })

  it('web_search surfaces CoreErrors as isError outputs', async () => {
    const { host } = makeHost({
      search: async () => {
        throw new CoreError('no engine', 'WEB_NO_ENGINE')
      },
    })
    const spec = buildCoreTools(host).find((tool) => tool.name === 'web_search')!
    const out = await spec.execute({ queries: ['q'] }, noop)
    expect(out.isError).toBe(true)
    expect(out.text).toContain('WEB_NO_ENGINE')
    expect(out.text).toContain('no engine')
  })

  it('web_fetch converts html to markdown in readable mode', async () => {
    const { host } = makeHost({
      fetch: async () => ({
        url: 'https://example.com',
        statusCode: 200,
        body: { kind: 'html', content: '<html><body><h1>Page</h1><p>Hello <a href="https://example.com/l">link</a></p></body></html>' },
        truncated: false,
      }),
    })
    const spec = buildCoreTools(host).find((tool) => tool.name === 'web_fetch')!
    const out = await spec.execute({ url: 'https://example.com' }, noop)
    expect(out.text).toContain('# Page')
    expect(out.text).toContain('[link](https://example.com/l)')
    expect(out.text).not.toContain('<html>')
    expect(out.text).toContain('HTTP 200')
  })

  it('web_fetch raw mode returns the body unchanged', async () => {
    const { host } = makeHost({
      fetch: async () => ({
        url: 'https://example.com',
        statusCode: 200,
        body: { kind: 'html', content: '<html><body><p>raw</p></body></html>' },
        truncated: false,
      }),
    })
    const spec = buildCoreTools(host).find((tool) => tool.name === 'web_fetch')!
    const out = await spec.execute({ url: 'https://example.com', mode: 'raw' }, noop)
    expect(out.text).toContain('<html>')
  })

  it('web_fetch truncates overlong bodies', async () => {
    const { host } = makeHost({
      fetch: async () => ({
        url: 'https://example.com',
        statusCode: 200,
        body: { kind: 'text', content: 'x'.repeat(150_000) },
        truncated: false,
      }),
    })
    const spec = buildCoreTools(host).find((tool) => tool.name === 'web_fetch')!
    const out = await spec.execute({ url: 'https://example.com' }, noop)
    expect(out.text).toContain('[...truncated...]')
    expect((out.details as { truncated: boolean }).truncated).toBe(true)
  })

  describe('web_fetch question mode (5.1)', () => {
    const pdfContent = '# report\n\n## Page 1\n\nThe answer is 42. Second page.'

    it('answers from the fetched document via the host LLM', async () => {
      const complete = vi.fn(async (req: { prompt: string }) => {
        expect(req.prompt).toContain('The answer is 42')
        expect(req.prompt).toContain('Question: what is the answer?')
        return { text: 'The answer is 42.', model: 'test-model' }
      })
      const { host } = makeHost({
        fetch: async () => ({
          url: 'https://example.com/r.pdf',
          statusCode: 200,
          body: { kind: 'text', content: pdfContent },
          truncated: false,
        }),
        llm: { complete } satisfies LlmClient,
      })
      const spec = buildCoreTools(host).find((tool) => tool.name === 'web_fetch')!
      const out = await spec.execute({ url: 'https://example.com/r.pdf', question: 'what is the answer?' }, noop)
      expect(out.isError).toBeFalsy()
      expect(out.text).toContain('Answer to "what is the answer?"')
      expect(out.text).toContain('The answer is 42.')
      expect(out.text).toContain('(model: test-model)')
      expect((out.details as { model: string }).model).toBe('test-model')
      expect(complete).toHaveBeenCalledTimes(1)
    })

    it('fails closed with WEB_NOT_AVAILABLE when the host has no LLM client', async () => {
      const { host } = makeHost({
        fetch: async () => ({
          url: 'https://example.com/r.pdf',
          statusCode: 200,
          body: { kind: 'text', content: pdfContent },
          truncated: false,
        }),
      })
      const spec = buildCoreTools(host).find((tool) => tool.name === 'web_fetch')!
      const out = await spec.execute({ url: 'https://example.com/r.pdf', question: 'what is the answer?' }, noop)
      expect(out.isError).toBe(true)
      expect(out.text).toContain('Error (WEB_NOT_AVAILABLE)')
      expect(out.text).toContain('HostAdapter.llm')
    })

    it('ignores the question in raw mode (no LLM call)', async () => {
      const complete = vi.fn()
      const { host } = makeHost({
        fetch: async () => ({
          url: 'https://example.com/raw.pdf',
          statusCode: 200,
          body: { kind: 'text', content: pdfContent },
          truncated: false,
        }),
        llm: { complete } as LlmClient,
      })
      const spec = buildCoreTools(host).find((tool) => tool.name === 'web_fetch')!
      const out = await spec.execute({ url: 'https://example.com/raw.pdf', mode: 'raw', question: 'x' }, noop)
      expect(out.isError).toBeFalsy()
      expect(out.text).toContain('## Page 1')
      expect(complete).not.toHaveBeenCalled()
    })

    it('does not call the LLM without a question', async () => {
      const complete = vi.fn()
      const { host } = makeHost({
        fetch: async () => ({
          url: 'https://example.com/r.pdf',
          statusCode: 200,
          body: { kind: 'text', content: pdfContent },
          truncated: false,
        }),
        llm: { complete } as LlmClient,
      })
      const spec = buildCoreTools(host).find((tool) => tool.name === 'web_fetch')!
      const out = await spec.execute({ url: 'https://example.com/r.pdf' }, noop)
      expect(out.isError).toBeFalsy()
      expect(complete).not.toHaveBeenCalled()
    })
  })

  it('web_platform_search formats sources', async () => {
    const { host } = makeHost({
      platform: async () => ({
        platform: 'github',
        query: 'typescript',
        sources: [{ url: 'https://github.com/microsoft/TypeScript', title: 'microsoft/TypeScript', snippet: 'TS repo' }],
        truncated: false,
      }),
    })
    const spec = buildCoreTools(host).find((tool) => tool.name === 'web_platform_search')!
    const out = await spec.execute({ platform: 'github', query: 'typescript' }, noop)
    expect(out.text).toContain('Platform search: github')
    expect(out.text).toContain('1. microsoft/TypeScript')
  })

  it('web_history / web_search_stats / web_cache_clear operate on the store', async () => {
    const { host, store } = makeHost()
    await store.recordSearch({
      cacheKey: 'k1',
      query: 'node 22',
      engines: ['ddg'],
      createdAt: Date.now(),
      sources: [{ url: 'https://nodejs.org' }],
      truncated: false,
    })
    await store.recordPage({
      url: 'https://nodejs.org',
      normalizedUrl: 'https://nodejs.org/',
      fetchedAt: Date.now(),
      statusCode: 200,
      bodyKind: 'html',
      body: '<html></html>',
      truncated: false,
    })
    const specs = new Map(buildCoreTools(host).map((tool) => [tool.name, tool]))
    const history = await specs.get('web_history')!.execute({ kind: 'search', query: 'node' }, noop)
    expect(history.text).toContain('search: node 22')
    const stats = await specs.get('web_search_stats')!.execute({}, noop)
    expect(stats.text).toContain('Stored searches: 1')
    expect(stats.text).toContain('Stored pages: 1')
    const cleared = await specs.get('web_cache_clear')!.execute({ scope: 'all' }, noop)
    expect(cleared.text).toContain('Cleared 1 search records')
    expect(cleared.text).toContain('Cleared 1 page records')
    const empty = await specs.get('web_history')!.execute({}, noop)
    expect(empty.text).toBe('No matching history entries.')
  })
})
