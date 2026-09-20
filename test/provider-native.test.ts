import { afterEach, describe, expect, it, vi } from 'vitest'
import { errorCodeOf } from '../src/errors.ts'
import type { SearchEngineDeps } from '../src/search/engines/types.ts'
import {
  createAnthropicEngine,
  createDeepseekEngine,
  ANTHROPIC_DEFAULT_BASE_URL,
  DEEPSEEK_DEFAULT_BASE_URL,
} from '../src/search/engines/provider-native/anthropic.ts'
import { createOpenaiEngine, createXaiEngine } from '../src/search/engines/provider-native/openai.ts'
import { GeminiEngine } from '../src/search/engines/provider-native/gemini.ts'
import { PerplexityEngine } from '../src/search/engines/provider-native/perplexity.ts'
import { ExaEngine } from '../src/search/engines/exa.ts'
import { normalizeUrl } from '../src/search/url.ts'
import { JinaEngine } from '../src/search/engines/jina.ts'
import type { EngineSearchResult } from '../src/search/engines/types.ts'

const deps: SearchEngineDeps = { userAgent: 'test-ua/1.0' }
const signal = (): AbortSignal => new AbortController().signal

/** Capture fetch calls and reply with a canned Response. */
function installFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>): { calls: { url: string; init: RequestInit }[] } {
  const calls: { url: string; init: RequestInit }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, init: init ?? {} })
      return handler(url, init ?? {})
    }),
  )
  return { calls }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

async function expectCoreError(promise: Promise<EngineSearchResult>, code: string): Promise<void> {
  const error = await promise.catch((value: unknown) => value)
  expect(errorCodeOf(error)).toBe(code)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('provider-native: openai / xai (Responses API, hosted web_search)', () => {
  const RESONSES_OUTPUT = {
    output: [
      {
        type: 'message',
        content: [
          {
            type: 'output_text',
            text: 'Here is the answer.',
            annotations: [
              { type: 'url_citation', url_citation: { url: 'https://a.example/one', title: 'A' } },
              { type: 'url_citation', url_citation: { url: 'https://a.example/one#frag' } },
              { type: 'url_citation', url_citation: { url: 'https://b.example/two', title: 'B' } },
              { type: 'other_annotation' },
              { type: 'url_citation', url_citation: { url: 'not a url' } },
            ],
          },
        ],
      },
      { type: 'thinking', text: 'ignored' },
    ],
  }

  it('posts the Responses request with the web_search tool and parses citations', async () => {
    const { calls } = installFetch(() => jsonResponse(RESONSES_OUTPUT))
    const engine = createOpenaiEngine(deps, { apiKey: 'sk-openai-test' })
    const result = await engine.search('q', 5, signal())
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('https://api.openai.com/v1/responses')
    const init = calls[0]!.init
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers['authorization']).toBe('Bearer sk-openai-test')
    expect(headers['user-agent']).toBe('test-ua/1.0')
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body['model']).toBe('gpt-5.1')
    expect(body['input']).toEqual([{ role: 'user', content: [{ type: 'input_text', text: 'q' }] }])
    expect(body['tools']).toEqual([{ type: 'web_search', web_search_options: { count: 5 } }])
    expect(result.content).toBe('Here is the answer.')
    expect(result.sources.map((source) => source.url)).toEqual(['https://a.example/one', 'https://b.example/two'])
    expect(result.sources[0]).toEqual({ url: 'https://a.example/one', title: 'A' })
  })

  it('caps the provider result count by maxUses', async () => {
    const { calls } = installFetch(() => jsonResponse(RESONSES_OUTPUT))
    const engine = createOpenaiEngine(deps, { apiKey: 'k', maxUses: 3 })
    await engine.search('q', 20, signal())
    const body = JSON.parse(String(calls[0]!.init.body)) as { tools: { web_search_options: { count: number } }[] }
    expect(body.tools[0]!.web_search_options.count).toBe(3)
  })

  it('caps sources at maxResults', async () => {
    installFetch(() => jsonResponse({
      output: [{
        type: 'message',
        content: [{
          type: 'output_text',
          text: 'x',
          annotations: [
            { type: 'url_citation', url_citation: { url: 'https://1.example/' } },
            { type: 'url_citation', url_citation: { url: 'https://2.example/' } },
            { type: 'url_citation', url_citation: { url: 'https://3.example/' } },
          ],
        }],
      }],
    }))
    const engine = createOpenaiEngine(deps, { apiKey: 'k' })
    const result = await engine.search('q', 2, signal())
    expect(result.sources).toHaveLength(2)
  })

  it('fails WEB_AUTH without any available key', async () => {
    const engine = createOpenaiEngine(deps, undefined)
    expect(engine.available()).toBe(false)
    await expectCoreError(engine.search('q', 5, signal()), 'WEB_AUTH')
  })

  it('resolves the key through the secret resolver (config > credentials > env)', async () => {
    const resolveSecret = vi.fn(async () => 'resolved-key')
    installFetch(() => jsonResponse(RESONSES_OUTPUT))
    const engine = createOpenaiEngine({ userAgent: 'ua', resolveSecret }, undefined)
    const result = await engine.search('q', 5, signal())
    expect(result.sources).toHaveLength(2)
    expect(resolveSecret).toHaveBeenCalledWith({ name: 'websearch:openai', explicit: undefined, env: 'OPENAI_API_KEY' })
  })

  it('xai preset: x.ai endpoint, grok model, XAI secret name', async () => {
    const { calls } = installFetch(() => jsonResponse(RESONSES_OUTPUT))
    const resolveSecret = vi.fn(async () => 'xai-key')
    const engine = createXaiEngine({ userAgent: 'ua', resolveSecret }, undefined)
    await engine.search('q', 5, signal())
    expect(calls[0]!.url).toBe('https://api.x.ai/v1/responses')
    const body = JSON.parse(String(calls[0]!.init.body)) as { model: string }
    expect(body.model).toBe('grok-4.5')
    expect(resolveSecret).toHaveBeenCalledWith({ name: 'websearch:xai', explicit: undefined, env: 'XAI_API_KEY' })
  })

  it('supports custom baseUrl (trailing slash trimmed) and model override', async () => {
    const { calls } = installFetch(() => jsonResponse(RESONSES_OUTPUT))
    const engine = createOpenaiEngine(deps, { apiKey: 'k', baseUrl: 'http://localhost:4000/v1/', model: 'custom-model' })
    await engine.search('q', 5, signal())
    expect(calls[0]!.url).toBe('http://localhost:4000/v1/responses')
    const body = JSON.parse(String(calls[0]!.init.body)) as { model: string }
    expect(body.model).toBe('custom-model')
  })

  it('maps provider status codes to CoreError codes', async () => {
    const engine = createOpenaiEngine(deps, { apiKey: 'k' })
    for (const [status, code] of [[401, 'WEB_AUTH'], [403, 'WEB_AUTH'], [402, 'WEB_QUOTA'], [429, 'WEB_QUOTA'], [404, 'WEB_UNSUPPORTED'], [501, 'WEB_UNSUPPORTED'], [500, 'WEB_PROVIDER_ERROR']] as const) {
      installFetch(() => jsonResponse({ error: 'x' }, status))
      await expectCoreError(engine.search('q', 5, signal()), code)
    }
  })

  it('maps a non-JSON success body to WEB_PARSE_ERROR', async () => {
    installFetch(() => new Response('not json', { status: 200, headers: { 'content-type': 'text/plain' } }))
    const engine = createOpenaiEngine(deps, { apiKey: 'k' })
    await expectCoreError(engine.search('q', 5, signal()), 'WEB_PARSE_ERROR')
  })

  it('maps a transport failure to WEB_PROVIDER_ERROR and an abort to WEB_ABORTED', async () => {
    const engine = createOpenaiEngine(deps, { apiKey: 'k' })
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('fetch failed')
    }))
    const error = await engine.search('q', 5, signal()).catch((value: unknown) => value)
    expect(errorCodeOf(error)).toBe('WEB_PROVIDER_ERROR')
    expect((error as Error).message).toContain('fetch failed')
    const aborted = new AbortController()
    aborted.abort()
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError')
      throw new Error('unreachable')
    }))
    await expectCoreError(engine.search('q', 5, aborted.signal), 'WEB_ABORTED')
  })
})

describe('provider-native: anthropic / deepseek (Messages API + web_search_20250305)', () => {
  const MESSAGES_OUTPUT = {
    stop_reason: 'end_turn',
    content: [
      { type: 'text', text: 'Synthesized answer.' },
      {
        type: 'web_search_tool_result',
        content: [
          { type: 'web_search_result', url: 'https://a.example/', title: 'A', snippet: 'snippet a' },
          { type: 'web_search_result', url: 'https://a.example/?utm_source=x' },
          { type: 'web_search_result', url: 'https://b.example/', title: 'B' },
          { type: 'other_type' },
        ],
      },
    ],
  }

  it('posts the Messages request with the web_search server tool', async () => {
    const { calls } = installFetch(() => jsonResponse(MESSAGES_OUTPUT))
    const engine = createAnthropicEngine(deps, { apiKey: 'sk-ant-test' })
    const result = await engine.search('q', 10, signal())
    expect(calls[0]!.url).toBe(`${ANTHROPIC_DEFAULT_BASE_URL}/messages`)
    expect(calls[0]!.url).toBe('https://api.anthropic.com/v1/messages')
    const headers = calls[0]!.init.headers as Record<string, string>
    expect(headers['x-api-key']).toBe('sk-ant-test')
    expect(headers['anthropic-version']).toBe('2023-06-01')
    const body = JSON.parse(String(calls[0]!.init.body)) as Record<string, unknown>
    expect(body['model']).toBe('claude-sonnet-4-5')
    expect(body['max_tokens']).toBe(4096)
    expect(body['messages']).toEqual([{ role: 'user', content: [{ type: 'text', text: 'q' }] }])
    expect(body['tools']).toEqual([{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }])
    expect(result.content).toBe('Synthesized answer.')
    expect(result.sources.map((source) => source.url)).toEqual(['https://a.example/', 'https://b.example/'])
    expect(result.sources[0]).toEqual({ url: 'https://a.example/', title: 'A', snippet: 'snippet a' })
  })

  it('deepseek preset: anthropic-compat endpoint incl. /v1, flash model, cap 5', async () => {
    const { calls } = installFetch(() => jsonResponse(MESSAGES_OUTPUT))
    const resolveSecret = vi.fn(async () => 'ds-key')
    const engine = createDeepseekEngine({ userAgent: 'ua', resolveSecret }, undefined)
    await engine.search('q', 10, signal())
    expect(calls[0]!.url).toBe(`${DEEPSEEK_DEFAULT_BASE_URL}/messages`)
    expect(calls[0]!.url).toBe('https://api.deepseek.com/anthropic/v1/messages')
    const body = JSON.parse(String(calls[0]!.init.body)) as { model: string; tools: { max_uses: number }[] }
    expect(body.model).toBe('deepseek-v4-flash')
    expect(body.tools[0]!.max_uses).toBe(5)
    expect(resolveSecret).toHaveBeenCalledWith({ name: 'websearch:deepseek', explicit: undefined, env: 'DEEPSEEK_API_KEY' })
  })

  it('honors maxUses (capped at 10)', async () => {
    const { calls } = installFetch(() => jsonResponse(MESSAGES_OUTPUT))
    const engine = createAnthropicEngine(deps, { apiKey: 'k', maxUses: 25 })
    await engine.search('q', 10, signal())
    const body = JSON.parse(String(calls[0]!.init.body)) as { tools: { max_uses: number }[] }
    expect(body.tools[0]!.max_uses).toBe(10)
  })

  it('fails WEB_PARSE_ERROR when no web_search_result blocks are present', async () => {
    installFetch(() => jsonResponse({ stop_reason: 'max_tokens', content: [{ type: 'text', text: 'only prose' }] }))
    const engine = createAnthropicEngine(deps, { apiKey: 'k' })
    const error = await engine.search('q', 5, signal()).catch((value: unknown) => value)
    expect(errorCodeOf(error)).toBe('WEB_PARSE_ERROR')
    expect((error as Error).message).toContain('max_tokens')
  })

  it('fails WEB_AUTH without a key', async () => {
    const engine = createAnthropicEngine(deps, undefined)
    expect(engine.available()).toBe(false)
    await expectCoreError(engine.search('q', 5, signal()), 'WEB_AUTH')
  })

  it('maps 401 → WEB_AUTH', async () => {
    installFetch(() => jsonResponse({ error: 'nope' }, 401))
    const engine = createDeepseekEngine(deps, { apiKey: 'k' })
    await expectCoreError(engine.search('q', 5, signal()), 'WEB_AUTH')
  })
})

describe('provider-native: gemini (generateContent + google_search grounding)', () => {
  const GEMINI_OUTPUT = {
    candidates: [
      {
        content: {
          parts: [
            { text: 'Gemini answer part.' },
            { text: 'With citation.', citation: { sourceAttribution: { uri: 'https://g.example/1', title: 'G1' } } },
            { text: 'Dup.', citation: { sourceAttribution: { uri: 'https://g.example/1/?utm_source=x' } } },
          ],
        },
        groundingMetadata: {
          groundingChunks: [
            { web: { uri: 'https://g.example/2', title: 'G2' } },
            { web: { uri: 'broken' } },
            {},
          ],
        },
      },
    ],
  }

  it('posts generateContent with the google_search tool and merges citations + chunks', async () => {
    const { calls } = installFetch(() => jsonResponse(GEMINI_OUTPUT))
    const engine = new GeminiEngine({ ...deps, apiKey: 'gm-key' })
    const result = await engine.search('q', 10, signal())
    expect(calls[0]!.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent')
    const headers = calls[0]!.init.headers as Record<string, string>
    expect(headers['x-goog-api-key']).toBe('gm-key')
    const body = JSON.parse(String(calls[0]!.init.body)) as Record<string, unknown>
    expect(body['contents']).toEqual([{ parts: [{ text: 'q' }] }])
    expect(body['tools']).toEqual([{ google_search: {} }])
    expect(result.content).toBe('Gemini answer part.\n\nWith citation.\n\nDup.')
    expect(result.sources.map((source) => source.url)).toEqual(['https://g.example/1', 'https://g.example/2'])
    expect(result.sources[0]).toEqual({ url: 'https://g.example/1', title: 'G1' })
  })

  it('falls back to GEMINI_API_KEY/GOOGLE_API_KEY env vars', async () => {
    vi.stubEnv('GEMINI_API_KEY', '')
    vi.stubEnv('GOOGLE_API_KEY', 'env-google-key')
    installFetch(() => jsonResponse(GEMINI_OUTPUT))
    const resolveSecret = vi.fn(async () => undefined)
    const engine = new GeminiEngine({ userAgent: 'ua', resolveSecret })
    await engine.search('q', 5, signal())
    expect(resolveSecret).toHaveBeenCalledWith({ name: 'websearch:gemini', explicit: '', env: 'GEMINI_API_KEY' })
    const headers = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit
    expect((headers.headers as Record<string, string>)['x-goog-api-key']).toBe('env-google-key')
  })

  it('fails WEB_AUTH when no key source exists', async () => {
    vi.stubEnv('GEMINI_API_KEY', '')
    vi.stubEnv('GOOGLE_API_KEY', '')
    const engine = new GeminiEngine(deps)
    expect(engine.available()).toBe(false)
    await expectCoreError(engine.search('q', 5, signal()), 'WEB_AUTH')
  })
})

describe('provider-native: perplexity (chat completions + citations, 10/min guard)', () => {
  const PERPLEXITY_OUTPUT = {
    choices: [{ message: { content: 'Perplexity synthesis.' } }],
    citations: ['https://p.example/1', 'https://p.example/1', 'https://p.example/2', 'not-a-url', 42],
  }

  it('posts chat/completions and returns content + deduped citations', async () => {
    const { calls } = installFetch(() => jsonResponse(PERPLEXITY_OUTPUT))
    const engine = new PerplexityEngine({ ...deps, apiKey: 'px-key' })
    const result = await engine.search('q', 10, signal())
    expect(calls[0]!.url).toBe('https://api.perplexity.ai/chat/completions')
    const headers = calls[0]!.init.headers as Record<string, string>
    expect(headers['authorization']).toBe('Bearer px-key')
    const body = JSON.parse(String(calls[0]!.init.body)) as Record<string, unknown>
    expect(body['model']).toBe('sonar')
    expect(body['messages']).toEqual([{ role: 'user', content: 'q' }])
    expect(result.content).toBe('Perplexity synthesis.')
    expect(result.sources.map((source) => source.url)).toEqual(['https://p.example/1', 'https://p.example/2'])
  })

  it('fails WEB_PARSE_ERROR when the answer content is missing', async () => {
    installFetch(() => jsonResponse({ choices: [] }))
    const engine = new PerplexityEngine({ ...deps, apiKey: 'px-key' })
    await expectCoreError(engine.search('q', 5, signal()), 'WEB_PARSE_ERROR')
  })

  it('enforces the client-side 10 requests/minute budget', async () => {
    installFetch(() => jsonResponse(PERPLEXITY_OUTPUT))
    const engine = new PerplexityEngine({ ...deps, apiKey: 'px-key' })
    for (let i = 0; i < 10; i += 1) {
      await engine.search(`q${i}`, 5, signal())
    }
    await expectCoreError(engine.search('q10', 5, signal()), 'WEB_QUOTA')
  })

  it('maps 429 → WEB_QUOTA', async () => {
    installFetch(() => jsonResponse({ error: 'slow down' }, 429))
    const engine = new PerplexityEngine({ ...deps, apiKey: 'px-key' })
    await expectCoreError(engine.search('q', 5, signal()), 'WEB_QUOTA')
  })
})

describe('API engines: exa / jina (native HTTP clients)', () => {
  it('exa posts /search with x-api-key and maps results (snippet, publishedAt, dedupe)', async () => {
    const { calls } = installFetch(() => jsonResponse({
      answer: 'Exa answer',
      results: [
        { url: 'https://e.example/1', title: 'E1', snippet: 's', publishedDate: '2026-01-01T00:00:00Z' },
        { url: 'https://e.example/1/?utm_source=x', title: 'dup' },
        { url: 'https://e.example/2', title: 'E2', published_date: '2026-02-02T00:00:00Z' },
        { title: 'no-url' },
      ],
    }))
    const engine = new ExaEngine({ ...deps, apiKey: 'exa-key' })
    const result = await engine.search('q', 5, signal())
    expect(calls[0]!.url).toBe('https://api.exa.ai/search')
    const headers = calls[0]!.init.headers as Record<string, string>
    expect(headers['x-api-key']).toBe('exa-key')
    const body = JSON.parse(String(calls[0]!.init.body)) as Record<string, unknown>
    expect(body['query']).toBe('q')
    expect(body['numResults']).toBe(5)
    expect(body['type']).toBe('auto')
    expect(result.content).toBe('Exa answer')
    expect(result.sources).toHaveLength(2)
    expect(result.sources[0]).toEqual({ url: 'https://e.example/1', title: 'E1', snippet: 's', publishedAt: '2026-01-01T00:00:00Z' })
    expect(result.sources[1]).toEqual({ url: 'https://e.example/2', title: 'E2', publishedAt: '2026-02-02T00:00:00Z' })
  })

  it('exa maps 401 → WEB_AUTH and 429 → WEB_QUOTA', async () => {
    const engine = new ExaEngine({ ...deps, apiKey: 'exa-key' })
    installFetch(() => jsonResponse({ error: 'bad key' }, 401))
    await expectCoreError(engine.search('q', 5, signal()), 'WEB_AUTH')
    installFetch(() => jsonResponse({ error: 'slow down' }, 429))
    await expectCoreError(engine.search('q', 5, signal()), 'WEB_QUOTA')
  })

  it('exa fails WEB_AUTH without a key', async () => {
    const engine = new ExaEngine(deps)
    expect(engine.available()).toBe(false)
    await expectCoreError(engine.search('q', 5, signal()), 'WEB_AUTH')
  })

  it('jina GETs /{query} with bearer auth and maps data[] (description, content cap)', async () => {
    const { calls } = installFetch(() => jsonResponse({
      data: [
        { title: 'J1', url: 'https://j.example/1', description: 'desc' },
        { title: 'J2', url: 'https://j.example/2', content: 'c'.repeat(500) },
      ],
    }))
    const engine = new JinaEngine({ ...deps, apiKey: 'jina-key', maxResponseBytes: 1_048_576 })
    const result = await engine.search('hello world', 5, signal())
    expect(calls[0]!.url).toBe('https://s.jina.ai/hello%20world')
    const init = calls[0]!.init
    expect(init.method).toBe('GET')
    const headers = init.headers as Record<string, string>
    expect(headers['authorization']).toBe('Bearer jina-key')
    expect(headers['accept']).toBe('application/json')
    expect(result.sources[0]).toEqual({ url: 'https://j.example/1', title: 'J1', snippet: 'desc' })
    expect(result.sources[1]?.snippet).toBe('c'.repeat(300))
  })

  it('jina caps sources at maxResults and maps 429 → WEB_QUOTA', async () => {
    const engine = new JinaEngine({ ...deps, apiKey: 'jina-key', maxResponseBytes: 1_048_576 })
    installFetch(() => jsonResponse({
      data: [
        { url: 'https://j.example/1' },
        { url: 'https://j.example/2' },
        { url: 'https://j.example/3' },
      ],
    }))
    const result = await engine.search('q', 2, signal())
    expect(result.sources).toHaveLength(2)
    installFetch(() => jsonResponse({ error: 'quota' }, 429))
    await expectCoreError(engine.search('q', 5, signal()), 'WEB_QUOTA')
  })
})

describe('normalizeUrl (dedupe-key canonicalization)', () => {
  it('collapses trailing slashes and tracking params into one key', () => {
    expect(normalizeUrl('https://g.example/1/?utm_source=x')).toBe(normalizeUrl('https://g.example/1'))
    expect(normalizeUrl('https://g.example/1/')).toBe('https://g.example/1')
    expect(normalizeUrl('https://g.example/')).toBe('https://g.example/')
    expect(normalizeUrl('https://g.example/a/b/#top')).toBe('https://g.example/a/b')
  })
})
