import { describe, expect, it, vi } from 'vitest'
import { createServer, type AddressInfo } from 'node:net'

import { CoreError } from '../src/errors.ts'
import type { SearchRequest, SearchResult, SearchSource } from '../src/types.ts'
import { MULTI_SEARCH_PROVIDER_ID, MultiSearchProvider } from '../src/search/provider.ts'
import { SearXNGEngine, SEARXNG_DEFAULT_ENDPOINT } from '../src/search/engines/searxng.ts'
import { HttpSearchClient, dedupeSources, isBlockedDomain } from '../src/search/http.ts'
import type { WebStore } from '../src/store/index.ts'

/** Grab a free TCP port and release it (a closed port refuses immediately). */
function closedPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port
      server.close(() => resolve(port))
    })
  })
}

const UA = 'test-agent/1.0'
function makeEngine(id: string, impl?: (query: string, maxResults: number) => Promise<{ sources: SearchSource[] }>) {
  const search = vi.fn(impl ?? (async () => ({ sources: [{ url: `https://${id}.example/` }] })))
  return { id, available: () => true, search }
}

function makeStore(): WebStore {
  return {
    readSearch: async () => undefined,
    recordSearch: async () => 0,
  } as unknown as WebStore
}

function makeProvider(engineIds: readonly string[], engineById: Map<string, ReturnType<typeof makeEngine>>) {
  return new MultiSearchProvider({
    engines: engineIds,
    mode: 'fallback',
    defaultMaxResults: 5,
    store: makeStore(),
    engineById: engineById as never,
    enrich: false,
    enrichFetchLimit: 0,
    enrichKeep: 0,
    searchCacheTtlMs: 1000,
    pageCacheTtlMs: 1000,
    timeoutMs: 10_000,
    cooldownBaseMs: 1000,
    cooldownMaxMs: 4000,
    enrichOptions: {} as never,
  })
}

const QUERY: SearchRequest = { query: 'hello world' }

describe('SearXNG fast fail (closed port)', () => {
  let port = 0

  it('refuses immediately and the router falls through in one request', async () => {
    const searxng = new SearXNGEngine({
      endpoint: `http://127.0.0.1:${port}`,
      userAgent: UA,
      rateLimitPerSec: 10,
      maxSerpBytes: 1_000_000,
      blockedDomains: [],
    })
    const ddg = makeEngine('ddg')
    const provider = makeProvider(['searxng', 'ddg'], new Map([['searxng', searxng as never], ['ddg', ddg as never]]))

    const started = Date.now()
    const result: SearchResult = await provider.search(QUERY)
    const elapsed = Date.now() - started

    // One request, no hang: the refusal surfaced immediately (no artificial
    // retry or wait), and the search completed via the next engine.
    expect(elapsed).toBeLessThan(2_000)
    expect(result.sources).toHaveLength(1)
    expect(ddg.search).toHaveBeenCalledTimes(1)
    expect(searxng.available()).toBe(true) // cheap local check, no network
  })

  it('the failed engine cools down and the next search skips it', async () => {
    if (port === 0) port = await closedPort()
    const real = new SearXNGEngine({
      endpoint: `http://127.0.0.1:${port}`,
      userAgent: UA,
      rateLimitPerSec: 10,
      maxSerpBytes: 1_000_000,
      blockedDomains: [],
    })
    const searxng = makeEngine('searxng', (q, m) => real.search(q, m, new AbortController().signal) as never)
    const ddg = makeEngine('ddg')
    const provider = makeProvider(['searxng', 'ddg'], new Map([['searxng', searxng as never], ['ddg', ddg as never]]))

    await provider.search(QUERY) // endpoint up (listening port) → refused → down
    await provider.search(QUERY) // must go straight to ddg

    expect(searxng.search).toHaveBeenCalledTimes(1) // skipped under cooldown
    expect(ddg.search).toHaveBeenCalledTimes(2)
  })

  it('reports the default endpoint', () => {
    expect(SEARXNG_DEFAULT_ENDPOINT).toBe('http://localhost:8080')
  })
})

describe('HttpSearchClient connect guard', () => {
  it('aborts when the headers never arrive within connectTimeoutMs', async () => {
    // A TCP server that accepts the connection but never responds.
    const port = await new Promise<number>((resolve, reject) => {
      const server = createServer((socket) => { socket.resume() })
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port))
      server.unref()
    })
    const client = new HttpSearchClient({ userAgent: UA })
    const started = Date.now()
    const attempt = client.fetchText({
      url: `http://127.0.0.1:${port}/search`,
      signal: new AbortController().signal,
      maxBytes: 1000,
      context: 'guard test',
      connectTimeoutMs: 200,
    })
    await expect(attempt).rejects.toThrow(CoreError)
    expect(Date.now() - started).toBeLessThan(2_000)
  })

  it('a healthy endpoint is unaffected by the guard (cleared after headers)', async () => {
    const port = await new Promise<number>((resolve, reject) => {
      const server = createServer((socket) => {
        socket.end('HTTP/1.1 200 OK\r\ncontent-length: 2\r\n\r\nok')
      })
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port))
      server.unref()
    })
    const client = new HttpSearchClient({ userAgent: UA })
    const text = await client.fetchText({
      url: `http://127.0.0.1:${port}/`,
      signal: new AbortController().signal,
      maxBytes: 1000,
      context: 'healthy test',
      connectTimeoutMs: 5000,
    })
    expect(text).toBe('ok')
  })
})

describe('shared dedupe helpers', () => {
  it('dedupeSources drops duplicates (normalized), blocked domains, and empty rows', () => {
    const rows = [
      { url: 'https://a.example/?utm_source=x', title: 'A', snippet: 'first' },
      { url: 'https://a.example/', title: 'A dup' },
      { url: 'https://blocked.example/', title: 'B' },
      { url: '', title: 'no url' },
      { url: 'https://c.example/', title: '', snippet: '' },
    ]
    const sources = dedupeSources(rows, ['blocked.example'])
    expect(sources).toEqual([
      { url: 'https://a.example/?utm_source=x', title: 'A', snippet: 'first' },
      { url: 'https://c.example/' },
    ])
  })

  it('isBlockedDomain matches suffixes and treats garbage as blocked', () => {
    expect(isBlockedDomain('https://a.blocked.example/x', ['blocked.example'])).toBe(true)
    expect(isBlockedDomain('https://blocked.example/', ['blocked.example'])).toBe(true)
    expect(isBlockedDomain('https://notblocked.example/', ['blocked.example'])).toBe(false)
    expect(isBlockedDomain('not a url', ['blocked.example'])).toBe(true)
    expect(isBlockedDomain('https://ok.example/', [])).toBe(false)
  })
})

describe('provider id stability', () => {
  it('keeps the multi provider id', () => {
    expect(MULTI_SEARCH_PROVIDER_ID).toBe('multi')
  })
})

describe('fuse mode (parallel + RRF)', () => {
  function fuseProvider(engineById: Map<string, ReturnType<typeof makeEngine>>, engineIds?: readonly string[]) {
    return new MultiSearchProvider({
      engines: engineIds ?? [...engineById.keys()],
      mode: 'fuse',
      defaultMaxResults: 5,
      store: makeStore(),
      engineById: engineById as never,
      enrich: false,
      enrichFetchLimit: 0,
      enrichKeep: 0,
      searchCacheTtlMs: 1000,
      pageCacheTtlMs: 1000,
      timeoutMs: 10_000,
      cooldownBaseMs: 1000,
      cooldownMaxMs: 4000,
      enrichOptions: {} as never,
    })
  }

  it('merges parallel engine results by RRF (consensus first)', async () => {
    const a = makeEngine('a', async () => ({ sources: [{ url: 'https://one.example/', title: 'One' }, { url: 'https://two.example/' }] }))
    const b = makeEngine('b', async () => ({ sources: [{ url: 'https://two.example/' }, { url: 'https://three.example/' }] }))
    const provider = fuseProvider(new Map([['a', a as never], ['b', b as never]]))
    const result = await provider.search(QUERY)
    // Both engines ran (parallel), consensus doc ranks first.
    expect(a.search).toHaveBeenCalledTimes(1)
    expect(b.search).toHaveBeenCalledTimes(1)
    expect(result.sources[0]?.url).toBe('https://two.example/')
    expect(result.sources).toHaveLength(3)
  })

  it('one failing engine does not fail the fuse and cools it down', async () => {
    const failing = makeEngine('failing', async () => {
      throw new CoreError('boom', 'WEB_PROVIDER_ERROR')
    })
    const healthy = makeEngine('healthy')
    const provider = fuseProvider(new Map([['failing', failing as never], ['healthy', healthy as never]]))
    const result = await provider.search(QUERY)
    expect(result.sources).toEqual([{ url: 'https://healthy.example/' }])
    const diag = provider.diagnostics().find((engine) => engine.id === 'failing')
    expect(diag?.coolingDown).toBe(true)
    expect(diag?.consecutiveFailures).toBe(1)
    // Next search skips the cooling engine entirely.
    await provider.search(QUERY)
    expect(failing.search).toHaveBeenCalledTimes(1)
    expect(healthy.search).toHaveBeenCalledTimes(2)
  })

  it('all engines failing (or empty) throws a provider error', async () => {
    const a = makeEngine('a', async () => ({ sources: [] }))
    const b = makeEngine('b', async () => ({ sources: [] }))
    const provider = fuseProvider(new Map([['a', a as never], ['b', b as never]]))
    await expect(provider.search(QUERY)).rejects.toThrow(/all search engines failed/)
  })

  it('diagnostics list the config chain first, then extra built engines', () => {
    const chain = makeEngine('ddg')
    const extra = makeEngine('exa')
    const provider = fuseProvider(new Map([['exa', extra as never], ['ddg', chain as never]]), ['ddg'])
    const diag = provider.diagnostics()
    expect(diag.find((engine) => engine.id === 'ddg')?.inChain).toBe(true)
    expect(diag.find((engine) => engine.id === 'exa')?.inChain).toBe(false)
    expect(diag.find((engine) => engine.id === 'ddg')?.available).toBe(true)
  })
})
