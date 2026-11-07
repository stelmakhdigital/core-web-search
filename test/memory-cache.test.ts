import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock node:dns/promises so the SSRF guard resolves hosts deterministically.
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(),
}))

import { resolveCoreConfig } from '../src/config.ts'
import { CachedHttpFetchProvider } from '../src/fetch/provider.ts'
import { MemoryPageCache } from '../src/fetch/memory-cache.ts'
import { normalizeUrl } from '../src/fetch/url.ts'
import type { CoreConfig } from '../src/types.ts'
import type { WebStore } from '../src/store/index.ts'

import { lookup } from 'node:dns/promises'
const mockLookup = vi.mocked(lookup)

function resolvePublic(): void {
  mockLookup.mockImplementation(async (_host: string, options?: { all?: boolean }) => {
    const records = [{ address: '93.184.215.14', family: 4 }]
    return (options?.all ? records : records[0]!) as unknown as Awaited<ReturnType<typeof lookup>>
  })
}

/** A store whose reads/writes always fail (simulates a broken store). */
function brokenStore(): WebStore {
  const fail = () => Promise.reject(new Error('store is broken'))
  return {
    readPage: fail,
    recordPage: fail,
    refreshPage: fail,
  } as unknown as WebStore
}

function makeProvider(store: WebStore, memoryCacheMaxEntries = 50): CachedHttpFetchProvider {
  return new CachedHttpFetchProvider({
    maxUrlLength: 2048,
    maxResponseBytes: 5_000_000,
    maxBodyChars: 100_000,
    timeoutMs: 10_000,
    maxRedirects: 5,
    userAgent: 'agents-web-search-test',
    cacheTtlMs: 60_000,
    memoryCacheMaxEntries,
    store,
    revalidate: true,
    allowPrivateNetworks: false,
    pdf: { enabled: true, maxSizeBytes: 2_000_000, maxPages: 5 },
    video: { enabled: true },
    github: { enabled: false, maxCloneBytes: 10 * 1024 * 1024, maxTreeEntries: 500, maxFileBytes: 1024 * 1024, clonesDir: '/tmp/web-search-clones' },
  })
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  resolvePublic()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('MemoryPageCache', () => {
  it('LRU: the oldest entry is evicted over the cap and a get() bumps recency', () => {
    const cache = new MemoryPageCache(2)
    const page = (url: string): Parameters<typeof cache.set>[1] => ({
      id: 1, url, normalizedUrl: url, fetchedAt: Date.now(), statusCode: 200, bodyKind: 'text', body: 'x', truncated: false,
    })
    cache.set('a', page('a'))
    cache.set('b', page('b'))
    cache.get('a') // bump a: b is now the oldest
    cache.set('c', page('c'))
    expect(cache.get('a')).toBeDefined()
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('c')).toBeDefined()
    expect(cache.size).toBe(2)
  })

  it('rejects a non-negative-integer cap', () => {
    expect(() => new MemoryPageCache(-1)).toThrow(/non-negative integer/)
    expect(() => new MemoryPageCache(1.5)).toThrow(/non-negative integer/)
  })
})

describe('CachedHttpFetchProvider — in-memory page layer', () => {
  it('a repeat fetch is served from memory even with a broken store', async () => {
    const provider = makeProvider(brokenStore())
    fetchMock.mockResolvedValue(new Response('<html>hello</html>', { status: 200, headers: { 'content-type': 'text/html' } }) as unknown as Response)
    const first = await provider.fetch({ url: 'https://example.com' })
    expect(first.body.content).toBe('<html>hello</html>')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const second = await provider.fetch({ url: 'https://example.com/' })
    expect(second.body.content).toBe('<html>hello</html>')
    expect(second.fromCache).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('clearMemoryCache forces the next fetch back to the store (or the network)', async () => {
    const provider = makeProvider(brokenStore())
    fetchMock.mockResolvedValue(new Response('<html>hello</html>', { status: 200, headers: { 'content-type': 'text/html' } }) as unknown as Response)
    await provider.fetch({ url: 'https://example.com' })
    provider.clearMemoryCache()
    // The store is broken, so the only remaining source is the network.
    fetchMock.mockResolvedValue(new Response('<html>refetched</html>', { status: 200, headers: { 'content-type': 'text/html' } }) as unknown as Response)
    const result = await provider.fetch({ url: 'https://example.com' })
    expect(result.body.content).toBe('<html>refetched</html>')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('a memory entry evicted over the cap is re-fetched from the network', async () => {
    const provider = makeProvider(brokenStore(), 1)
    fetchMock.mockImplementation(async (input: unknown) =>
      new Response(`<html>${String(input)}</html>`, { status: 200, headers: { 'content-type': 'text/html' } }) as unknown as Response)
    await provider.fetch({ url: 'https://a.example.com' })
    await provider.fetch({ url: 'https://b.example.com' })
    const result = await provider.fetch({ url: 'https://a.example.com' })
    expect(result.body.content).toBe('<html>https://a.example.com/</html>')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('memoryCacheMaxEntries 0 disables the layer entirely', async () => {
    const provider = makeProvider(brokenStore(), 0)
    fetchMock.mockImplementation(async () =>
      new Response('<html>hello</html>', { status: 200, headers: { 'content-type': 'text/html' } }) as unknown as Response)
    await provider.fetch({ url: 'https://example.com' })
    // With the layer off, every fetch re-reads the (broken) store and
    // therefore re-fetches from the network.
    await provider.fetch({ url: 'https://example.com' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('web_cache_clear drops the memory layer (pages/all scopes only)', async () => {
    // Tool-level wiring: the host stub must be called with the right scope.
    const { buildCacheClearTool } = await import('../src/tools/index.ts')
    const cleared: Array<'search' | 'pages' | 'all'> = []
    const host = {
      config: resolveCoreConfig(undefined, '/tmp/web-search-test'),
      store: { clearSearches: async () => 0, clearPages: async () => 0 } as unknown as WebStore,
      clearMemoryCache: () => { cleared.push('all') },
      search: async () => { throw new Error('unused') },
      fetch: async () => { throw new Error('unused') },
      platformSearch: async () => { throw new Error('unused') },
    }
    const tool = buildCacheClearTool(host as Parameters<typeof buildCacheClearTool>[0])
    await tool.execute({ scope: 'search' }, { signal: new AbortController().signal })
    expect(cleared).toEqual([])
    await tool.execute({ scope: 'pages' }, { signal: new AbortController().signal })
    expect(cleared).toEqual(['all'])
  })
})

describe('fetch.memoryCacheMaxEntries config', () => {
  const configOf = (fetch: CoreConfig['fetch']): number =>
    resolveCoreConfig({ fetch }, '/tmp/web-search-test').fetch.memoryCacheMaxEntries

  it('defaults to 50', () => {
    expect(configOf(undefined)).toBe(50)
  })

  it('accepts 0 (disabled) and rejects negatives', () => {
    expect(configOf({ memoryCacheMaxEntries: 0 })).toBe(0)
    expect(() => configOf({ memoryCacheMaxEntries: -1 })).toThrow(/memoryCacheMaxEntries/)
  })
})
