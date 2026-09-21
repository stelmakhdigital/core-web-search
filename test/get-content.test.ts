import { describe, expect, it, vi } from 'vitest'

import { WebStore } from '../src/store/index.ts'
import { MultiSearchProvider } from '../src/search/provider.ts'
import type { SearchEngine } from '../src/search/engines/types.ts'
import { buildCoreTools, buildGetSearchContentTool, type ToolHost } from '../src/tools/index.ts'
import { resolveCoreConfig } from '../src/config.ts'
import type { FetchResult, PlatformSearchResult, SearchResult } from '../src/types.ts'

function makeHost(): { host: ToolHost; store: WebStore } {
  const store = new WebStore({ path: ':memory:' })
  const config = resolveCoreConfig(undefined, '/tmp')
  const host: ToolHost = {
    config,
    store,
    search: async () => ({ sources: [], truncated: false }) as SearchResult,
    fetch: async () => ({ url: 'https://example.com', statusCode: 200, body: { kind: 'text', content: 'hi' }, truncated: false }) as FetchResult,
    platformSearch: async () => ({ platform: 'github', query: 'q', sources: [], truncated: false }) as PlatformSearchResult,
  }
  return { host, store }
}

const noop = { signal: new AbortController().signal }

describe('web store by-id reads (5.5)', () => {
  it('getSearch/getPage return records and undefined for unknown ids', async () => {
    const store = new WebStore({ path: ':memory:' })
    const searchId = await store.recordSearch({
      cacheKey: 'multi:multi:ddg:test query',
      query: 'test query',
      engines: ['ddg'],
      createdAt: Date.now(),
      sources: [{ url: 'https://example.com', title: 'Example', snippet: 'snip' }],
      truncated: false,
      content: 'stored answer',
    })
    const pageId = await store.recordPage({
      url: 'https://example.com/a',
      normalizedUrl: 'https://example.com/a',
      fetchedAt: Date.now(),
      statusCode: 200,
      bodyKind: 'text',
      body: 'page body',
      truncated: false,
    })
    expect(await store.getSearch(searchId)).toMatchObject({ query: 'test query', content: 'stored answer' })
    expect(await store.getPage(pageId)).toMatchObject({ url: 'https://example.com/a', body: 'page body' })
    expect(await store.getSearch(searchId + 999)).toBeUndefined()
    expect(await store.getPage(pageId + 999)).toBeUndefined()
    await store.close()
  })

  it('recordPage keeps the same id when upserting an existing URL', async () => {
    const store = new WebStore({ path: ':memory:' })
    const first = await store.recordPage({
      url: 'https://example.com/x',
      normalizedUrl: 'https://example.com/x',
      fetchedAt: Date.now(),
      statusCode: 200,
      bodyKind: 'text',
      body: 'v1',
      truncated: false,
    })
    const second = await store.recordPage({
      url: 'https://example.com/x',
      normalizedUrl: 'https://example.com/x',
      fetchedAt: Date.now(),
      statusCode: 200,
      bodyKind: 'text',
      body: 'v2',
      truncated: false,
    })
    expect(second).toBe(first)
    expect((await store.getPage(first))?.body).toBe('v2')
    await store.close()
  })
})

describe('get_search_content tool (5.5)', () => {
  it('returns a character window of a stored search answer', async () => {
    const { host, store } = makeHost()
    const id = await store.recordSearch({
      cacheKey: 'multi:multi:ddg:window test',
      query: 'window test',
      engines: ['ddg'],
      createdAt: Date.now(),
      sources: [],
      truncated: false,
      content: 'AAAA BBBB CCCC DDDD',
    })
    const tool = buildGetSearchContentTool(host)
    const out = await tool.execute({ source: 'search', id, offset: 8, limit: 8 }, noop)
    expect(out.isError).toBeUndefined()
    expect(out.text).toContain('Search #')
    expect(out.text).toContain('window test')
    expect(out.text).toContain('B CCCC D')
    expect(out.text).toContain('[...3 more chars — continue with offset 16]')
    await store.close()
  })

  it('findText returns context windows around the first matches (max 3)', async () => {
    const { host, store } = makeHost()
    const id = await store.recordPage({
      url: 'https://example.com/find',
      normalizedUrl: 'https://example.com/find',
      fetchedAt: Date.now(),
      statusCode: 200,
      bodyKind: 'text',
      body: 'one two NEEDLE three four five six NEEDLE seven eight nine NEEDLE ten NEEDLE eleven',
      truncated: false,
    })
    const tool = buildGetSearchContentTool(host)
    const out = await tool.execute({ source: 'page', id, findText: 'needle' }, noop)
    expect(out.isError).toBeUndefined()
    expect(out.text).toContain('matches for "needle" (3 shown)')
    expect(out.text).toContain('[match 1/3 at char 8]')
    expect(out.text).toContain('more matches exist')
    const missing = await tool.execute({ source: 'page', id, findText: 'absent' }, noop)
    expect(missing.text).toContain('no occurrences of "absent"')
    await store.close()
  })

  it('fails with WEB_BAD_REQUEST for unknown ids and bad arguments', async () => {
    const { host, store } = makeHost()
    const tool = buildGetSearchContentTool(host)
    const missing = await tool.execute({ source: 'search', id: 424242 }, noop)
    expect(missing.isError).toBe(true)
    expect(missing.text).toContain('WEB_BAD_REQUEST')
    const badSource = await tool.execute({ source: 'blob', id: 1 }, noop)
    expect(badSource.text).toContain("source must be 'search' or 'page'")
    const badOffset = await tool.execute({ source: 'search', id: 1, offset: -1 }, noop)
    expect(badOffset.text).toContain('offset must be a non-negative integer')
    const badLimit = await tool.execute({ source: 'search', id: 1, limit: 100_001 }, noop)
    expect(badLimit.text).toContain('limit must be an integer between 1 and 100000')
    await store.close()
  })

  it('reports a record without stored content', async () => {
    const { host, store } = makeHost()
    const id = await store.recordPage({
      url: 'https://example.com/empty',
      normalizedUrl: 'https://example.com/empty',
      fetchedAt: Date.now(),
      statusCode: 200,
      bodyKind: 'text',
      body: '',
      truncated: false,
    })
    const tool = buildGetSearchContentTool(host)
    const out = await tool.execute({ source: 'page', id }, noop)
    expect(out.text).toContain('(no stored content for this record)')
    await store.close()
  })

  it('is registered by default in buildCoreTools', () => {
    const { host } = makeHost()
    expect(buildCoreTools(host).map((tool) => tool.name)).toContain('get_search_content')
  })
})

describe('MultiSearchProvider searchId (5.5)', () => {
  function fakeEngine(sources: { url: string; title?: string; snippet?: string }[]): SearchEngine {
    return {
      id: 'fake',
      available: () => true,
      search: vi.fn(async (_query: string, maxResults: number) => ({
        sources: sources.slice(0, maxResults),
        latencyMs: 1,
      })),
    }
  }

  function makeProvider(store: WebStore, engine: SearchEngine): MultiSearchProvider {
    return new MultiSearchProvider({
      engines: ['fake'],
      mode: 'fallback',
      defaultMaxResults: 5,
      store,
      engineById: new Map([['fake', engine]]),
      enrich: false,
      enrichFetchLimit: 3,
      enrichKeep: 3,
      searchCacheTtlMs: 86_400_000,
      pageCacheTtlMs: 86_400_000,
      timeoutMs: 30_000,
      cooldownBaseMs: 1_000,
      cooldownMaxMs: 30_000,
      enrichOptions: {
        pageTimeoutMs: 10_000,
        pageCacheTtlMs: 86_400_000,
        maxPageBytes: 5 * 1024 * 1024,
        maxBodyChars: 100_000,
        snippetChars: 500,
        userAgent: 'test',
        concurrency: 3,
        allowPrivateNetworks: false,
      },
    })
  }

  it('returns searchId on a fresh result and fromCache + the same id on a cache hit', async () => {
    const store = new WebStore({ path: ':memory:' })
    const provider = makeProvider(
      store,
      fakeEngine([
        { url: 'https://example.com/1', title: 'One', snippet: 's1' },
        { url: 'https://example.com/2', title: 'Two', snippet: 's2' },
      ]),
    )
    const first = await provider.search({ query: 'ids test' })
    expect(first.searchId).toBeTypeOf('number')
    expect(first.fromCache).toBeUndefined()
    const second = await provider.search({ query: 'ids test' })
    expect(second.fromCache).toBe(true)
    expect(second.searchId).toBe(first.searchId)
    expect(second.sources).toHaveLength(2)
    const stored = await store.getSearch(second.searchId!)
    expect(stored?.query).toBe('ids test')
    await store.close()
  })
})
