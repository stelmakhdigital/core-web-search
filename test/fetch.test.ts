import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'


// Mock node:dns/promises so the SSRF guard resolves hosts deterministically.
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(),
}))

import { CachedHttpFetchProvider } from '../src/fetch/provider.ts'
import { normalizeUrl } from '../src/fetch/url.ts'
import { WebStore } from '../src/store/index.ts'
import { makePdf } from './fixtures/pdf.ts'

import { lookup } from 'node:dns/promises'
const mockLookup = vi.mocked(lookup)

/** A public address so the SSRF guard lets example.com through. */
function resolvePublic(): void {
  mockLookup.mockImplementation(async (_host: string, options?: { all?: boolean }) => {
    const records = [{ address: '93.184.215.14', family: 4 }]
    return (options?.all ? records : records[0]!) as unknown as Awaited<ReturnType<typeof lookup>>
  })
}

function makeStore(): WebStore {
  return new WebStore({ path: ':memory:' })
}

function makeProvider(store: WebStore, overrides: Record<string, unknown> = {}): CachedHttpFetchProvider {
  return new CachedHttpFetchProvider({
    maxUrlLength: 2048,
    maxResponseBytes: 5_000_000,
    maxBodyChars: 100_000,
    timeoutMs: 10_000,
    maxRedirects: 5,
    userAgent: 'dsh-web-automation-test',
    cacheTtlMs: 60_000,
    store,
    revalidate: true,
    allowPrivateNetworks: false,
    pdf: { enabled: true, maxSizeBytes: 2_000_000, maxPages: 5 },
    video: { enabled: true },
    github: { enabled: true, maxCloneBytes: 10 * 1024 * 1024, maxTreeEntries: 500, maxFileBytes: 1024 * 1024, clonesDir: '/tmp/web-search-clones' },
    ...overrides,
  })
}

/** Minimal Response stand-in with a real Headers and a one-chunk body stream. */
function fakeResponse(opts: { status?: number; body?: string; bytes?: Uint8Array; jsonValue?: unknown; headers?: Record<string, string> }): Response {
  const status = opts.status ?? 200
  const bytes = opts.bytes !== undefined ? opts.bytes : new TextEncoder().encode(opts.body ?? '')
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
  return {
    status,
    ok: status >= 200 && status < 300,
    statusText: String(status),
    headers: new Headers(opts.headers ?? {}),
    body: stream,
    url: '',
    ...(opts.jsonValue !== undefined ? { json: async () => opts.jsonValue } : {}),
  } as unknown as Response
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  resolvePublic()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('CachedHttpFetchProvider — cache behavior', () => {
  it('miss: fetches fresh, caches a 2xx result', async () => {
    const store = makeStore()
    fetchMock.mockImplementation(() => Promise.resolve(fakeResponse({ status: 200, body: '<html>hello</html>', headers: { 'content-type': 'text/html' } })))
    const provider = makeProvider(store)
    const result = await provider.fetch({ url: 'https://example.com' })
    expect(result.statusCode).toBe(200)
    expect(result.body.content).toBe('<html>hello</html>')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const cached = await store.readPage(normalizeUrl('https://example.com'))
    expect(cached).toBeDefined()
    expect(cached!.body).toBe('<html>hello</html>')
    await store.close()
  })

  it('fresh hit: serves from cache with no network round-trip', async () => {
    const store = makeStore()
    fetchMock.mockImplementation(() => Promise.resolve(fakeResponse({ status: 200, body: '<html>hello</html>', headers: { 'content-type': 'text/html' } })))
    const provider = makeProvider(store)
    await provider.fetch({ url: 'https://example.com' })
    // The entry is now fresh (within the 60s TTL); any further network call fails loudly.
    fetchMock.mockRejectedValue(new Error('network must not be touched'))
    const result = await provider.fetch({ url: 'https://example.com' })
    expect(result.body.content).toBe('<html>hello</html>')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await store.close()
  })

  it('expired + revalidate: a 304 serves the stale body and refreshes the timestamp', async () => {
    const store = makeStore()
    const key = normalizeUrl('https://example.com')
    await store.recordPage({
      url: 'https://example.com/',
      normalizedUrl: key,
      fetchedAt: Date.now() - 120_000, // beyond the 60s TTL
      etag: 'W/"v1"',
      statusCode: 200,
      bodyKind: 'html',
      body: '<html>stale</html>',
      truncated: false,
    })
    fetchMock.mockResolvedValue(fakeResponse({ status: 304 }))
    const provider = makeProvider(store)
    const result = await provider.fetch({ url: 'https://example.com' })
    expect(result.body.content).toBe('<html>stale</html>')
    // The conditional request carried the stored ETag.
    const requestHeaders = fetchMock.mock.calls[0]![1]!.headers as Record<string, string>
    expect(requestHeaders['if-none-match']).toBe('W/"v1"')
    // The 304 refreshed the timestamp: the entry is fresh again.
    const refreshed = await store.readPage(key)
    expect(refreshed!.fetchedAt).toBeGreaterThan(Date.now() - 10_000)
    await store.close()
  })

  it('expired + revalidate: a 200 reads the new body from the conditional response (single request)', async () => {
    const store = makeStore()
    const key = normalizeUrl('https://example.com')
    await store.recordPage({
      url: 'https://example.com/',
      normalizedUrl: key,
      fetchedAt: Date.now() - 120_000,
      etag: 'W/"v1"',
      statusCode: 200,
      bodyKind: 'html',
      body: '<html>stale</html>',
      truncated: false,
    })
    fetchMock.mockResolvedValue(fakeResponse({ status: 200, body: '<html>fresh</html>', headers: { 'content-type': 'text/html', etag: 'W/"v2"' } }))
    const provider = makeProvider(store)
    const result = await provider.fetch({ url: 'https://example.com' })
    expect(result.body.content).toBe('<html>fresh</html>')
    // The new body came from the conditional response itself — exactly one request.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // The fresh ETag was re-cached to seed the next revalidation cycle.
    const cached = await store.readPage(key)
    expect(cached!.etag).toBe('W/"v2"')
    await store.close()
  })

  it('expired + revalidate: a transport failure serves the stale body (stale-on-error)', async () => {
    const store = makeStore()
    const key = normalizeUrl('https://example.com')
    await store.recordPage({
      url: 'https://example.com/',
      normalizedUrl: key,
      fetchedAt: Date.now() - 120_000,
      etag: 'W/"v1"',
      statusCode: 200,
      bodyKind: 'html',
      body: '<html>stale</html>',
      truncated: false,
    })
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))
    const provider = makeProvider(store)
    const result = await provider.fetch({ url: 'https://example.com' })
    expect(result.body.content).toBe('<html>stale</html>')
    await store.close()
  })

  it('expired + revalidate=false: falls through to a full fetch', async () => {
    const store = makeStore()
    const key = normalizeUrl('https://example.com')
    await store.recordPage({
      url: 'https://example.com/',
      normalizedUrl: key,
      fetchedAt: Date.now() - 120_000,
      etag: 'W/"v1"',
      statusCode: 200,
      bodyKind: 'html',
      body: '<html>stale</html>',
      truncated: false,
    })
    fetchMock.mockImplementation(() => Promise.resolve(fakeResponse({ status: 200, body: '<html>fresh</html>', headers: { 'content-type': 'text/html' } })))
    const provider = makeProvider(store, { revalidate: false })
    const result = await provider.fetch({ url: 'https://example.com' })
    expect(result.body.content).toBe('<html>fresh</html>')
    // No conditional headers on a plain full fetch.
    const requestHeaders = fetchMock.mock.calls[0]![1]!.headers as Record<string, string>
    expect(requestHeaders['if-none-match']).toBeUndefined()
    await store.close()
  })

  it('blocks private targets before any network call', async () => {
    const store = makeStore()
    const provider = makeProvider(store)
    await expect(provider.fetch({ url: 'http://127.0.0.1:8080/' })).rejects.toMatchObject({ code: 'WEB_SSRF_BLOCKED' })
    expect(fetchMock).not.toHaveBeenCalled()
    await store.close()
  })

  it('does not cache non-2xx results', async () => {
    const store = makeStore()
    fetchMock.mockImplementation(() => Promise.resolve(fakeResponse({ status: 404, body: 'nope', headers: { 'content-type': 'text/plain' } })))
    const provider = makeProvider(store)
    const result = await provider.fetch({ url: 'https://example.com/missing' })
    expect(result.statusCode).toBe(404)
    const cached = await store.readPage(normalizeUrl('https://example.com/missing'))
    expect(cached).toBeUndefined()
    await store.close()
  })
})

describe('CachedHttpFetchProvider — PDF extraction (5.1)', () => {
  it('extracts application/pdf to markdown (kind text) and caches the result', async () => {
    const store = makeStore()
    const pdf = makePdf(['First page text', 'Second page text'])
    fetchMock.mockImplementation(() =>
      Promise.resolve(fakeResponse({ status: 200, bytes: pdf, headers: { 'content-type': 'application/pdf' } })),
    )
    const provider = makeProvider(store)
    const result = await provider.fetch({ url: 'https://example.com/docs/report.pdf' })
    expect(result.body.kind).toBe('text')
    const markdown = result.body.content
    expect(markdown).toContain('# report')
    expect(markdown).toContain('https://example.com/docs/report.pdf (PDF, 2 pages)')
    expect(markdown).toContain('## Page 1')
    expect(markdown).toContain('First page text')
    expect(markdown).toContain('## Page 2')
    expect(markdown).toContain('Second page text')
    const cached = await store.readPage(normalizeUrl('https://example.com/docs/report.pdf'))
    expect(cached?.bodyKind).toBe('text')
    // A fresh re-fetch is served from the cache without a network call.
    const again = await provider.fetch({ url: 'https://example.com/docs/report.pdf' })
    expect(again.fromCache).toBe(true)
    expect(again.body.content).toBe(markdown)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await store.close()
  })

  it('refuses PDFs when fetch.pdf.enabled is false (WEB_UNSUPPORTED_CONTENT_TYPE)', async () => {
    const store = makeStore()
    const pdf = makePdf(['nope'])
    fetchMock.mockImplementation(() =>
      Promise.resolve(fakeResponse({ status: 200, bytes: pdf, headers: { 'content-type': 'application/pdf' } })),
    )
    const provider = makeProvider(store, { pdf: { enabled: false, maxSizeBytes: 2_000_000, maxPages: 5 } })
    await expect(provider.fetch({ url: 'https://example.com/doc.pdf' })).rejects.toMatchObject({ code: 'WEB_UNSUPPORTED_CONTENT_TYPE' })
    await store.close()
  })

  it('enforces the PDF byte cap (WEB_FETCH_TOO_LARGE, no network drain)', async () => {
    const store = makeStore()
    const pdf = makePdf(['big'])
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        fakeResponse({
          status: 200,
          bytes: pdf,
          headers: { 'content-type': 'application/pdf', 'content-length': String(pdf.byteLength + 1) },
        }),
      ),
    )
    const provider = makeProvider(store, { pdf: { enabled: true, maxSizeBytes: 10, maxPages: 5 } })
    await expect(provider.fetch({ url: 'https://example.com/doc.pdf' })).rejects.toMatchObject({ code: 'WEB_FETCH_TOO_LARGE' })
    await store.close()
  })

  it('fails corrupt PDF bytes with WEB_PARSE_ERROR', async () => {
    const store = makeStore()
    const junk = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x48, 0x65, 0x6c, 0x6c, 0x6f])
    fetchMock.mockImplementation(() =>
      Promise.resolve(fakeResponse({ status: 200, bytes: junk, headers: { 'content-type': 'application/pdf' } })),
    )
    const provider = makeProvider(store)
    await expect(provider.fetch({ url: 'https://example.com/broken.pdf' })).rejects.toMatchObject({ code: 'WEB_PARSE_ERROR' })
    await store.close()
  })

  it('slices extraction to the first maxPages pages', async () => {
    const store = makeStore()
    const pdf = makePdf(['page one', 'page two', 'page three'])
    fetchMock.mockImplementation(() =>
      Promise.resolve(fakeResponse({ status: 200, bytes: pdf, headers: { 'content-type': 'application/pdf' } })),
    )
    const provider = makeProvider(store, { pdf: { enabled: true, maxSizeBytes: 2_000_000, maxPages: 2 } })
    const result = await provider.fetch({ url: 'https://example.com/multi.pdf' })
    const markdown = result.body.content
    expect(markdown).toContain('page one')
    expect(markdown).toContain('page two')
    expect(markdown).not.toContain('page three')
    expect(markdown).toContain('3 pages; showing the first 2')
    await store.close()
  })
})

describe('CachedHttpFetchProvider — YouTube video enrichment (5.2)', () => {
  const WATCH = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
  const watchHtml =
    '<html><head><meta name="description" content="The &amp; classic description"></head><body>watch page</body></html>'
  const oembedJson = { title: 'Test Video', author_name: 'Test Author', thumbnail_url: 'https://i.ytimg.com/x.jpg' }
  const vtt = 'WEBVTT\n\n00:00:01.280 --> 00:00:04.000\nhello world\n'

  function routeWatch(opts: { oembed?: unknown; oembedStatus?: number; vtt?: string; vttStatus?: number; html?: string } = {}): void {
    fetchMock.mockImplementation((input: URL | string) => {
      const u = typeof input === 'string' ? input : input.toString()
      if (u.startsWith('https://www.youtube.com/oembed')) {
        return Promise.resolve(
          fakeResponse({
            status: opts.oembedStatus ?? 200,
            jsonValue: opts.oembed ?? oembedJson,
            headers: { 'content-type': 'application/json' },
          }),
        )
      }
      if (u.startsWith('https://www.youtube.com/api/timedtext')) {
        return Promise.resolve(
          fakeResponse({
            status: opts.vttStatus ?? 200,
            body: opts.vtt ?? vtt,
            headers: { 'content-type': 'text/vtt' },
          }),
        )
      }
      return Promise.resolve(
        fakeResponse({ status: 200, body: opts.html ?? watchHtml, headers: { 'content-type': 'text/html' } }),
      )
    })
  }

  it('enriches a watch URL into a markdown document and caches it', async () => {
    const store = makeStore()
    routeWatch()
    const provider = makeProvider(store)
    const result = await provider.fetch({ url: WATCH })
    expect(result.body.kind).toBe('text')
    const markdown = result.body.content
    expect(markdown).toContain('# Test Video (video)')
    expect(markdown).toContain('by Test Author')
    expect(markdown).toContain('## Description')
    expect(markdown).toContain('The & classic description')
    expect(markdown).toContain('[00:01] hello world')
    const cached = await store.readPage(normalizeUrl(WATCH))
    expect(cached?.bodyKind).toBe('text')
    const again = await provider.fetch({ url: WATCH })
    expect(again.fromCache).toBe(true)
    expect(again.body.content).toBe(markdown)
    const calls = fetchMock.mock.calls.map((call) => String(call[0]))
    expect(calls.filter((u) => u.startsWith('https://www.youtube.com/api/timedtext')).length).toBeLessThanOrEqual(1)
    await store.close()
  })

  it('degrades to the description when oEmbed and the transcript both fail', async () => {
    const store = makeStore()
    routeWatch({ oembedStatus: 404, vtt: '' })
    const provider = makeProvider(store)
    const result = await provider.fetch({ url: WATCH })
    expect(result.body.kind).toBe('text')
    expect(result.body.content).toContain('## Description')
    expect(result.body.content).not.toContain('## Transcript')
    await store.close()
  })

  it('rejects with WEB_NOT_AVAILABLE when every stage fails', async () => {
    const store = makeStore()
    routeWatch({ oembedStatus: 404, vtt: '', html: '<html><head></head><body></body></html>' })
    const provider = makeProvider(store)
    await expect(provider.fetch({ url: WATCH })).rejects.toMatchObject({ code: 'WEB_NOT_AVAILABLE' })
    await store.close()
  })

  it('never follows a video sub-request redirect to a private address (SSRF hop guard)', async () => {
    const store = makeStore()
    fetchMock.mockImplementation((input: URL | string) => {
      const u = typeof input === 'string' ? input : input.toString()
      if (u.startsWith('https://www.youtube.com/oembed')) {
        // A (malicious) 302 towards the cloud-metadata endpoint.
        return Promise.resolve(fakeResponse({ status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } }))
      }
      if (u.startsWith('https://www.youtube.com/api/timedtext')) {
        return Promise.resolve(fakeResponse({ status: 200, body: vtt, headers: { 'content-type': 'text/vtt' } }))
      }
      return Promise.resolve(fakeResponse({ status: 200, body: watchHtml, headers: { 'content-type': 'text/html' } }))
    })
    const provider = makeProvider(store)
    // The oembed stage is skipped by the guard; the pipeline degrades to the
    // description/timedtext stages — and the private URL is never requested.
    const result = await provider.fetch({ url: WATCH })
    expect(result.body.kind).toBe('text')
    const requested = fetchMock.mock.calls.map((call) => String(call[0]))
    expect(requested.some((url) => url.includes('169.254.169.254'))).toBe(false)
    await store.close()
  })

  it('serves the watch page as plain HTML when the video feature is disabled', async () => {
    const store = makeStore()
    routeWatch()
    const provider = makeProvider(store, { video: { enabled: false } })
    const result = await provider.fetch({ url: WATCH })
    expect(result.body.kind).toBe('html')
    expect(result.body.content).toContain('watch page')
    await store.close()
  })
})

  it('truncates a response body at maxResponseBytes', async () => {
    const store = makeStore()
    const payload = 'a'.repeat(10_000)
    fetchMock.mockResolvedValue(fakeResponse({ status: 200, bytes: new TextEncoder().encode(payload), headers: { 'content-type': 'text/plain' } }))
    const provider = makeProvider(store, { maxResponseBytes: 1_000 })
    const result = await provider.fetch({ url: 'https://example.com/big' })
    expect(result.truncated).toBe(true)
    expect(result.body.content).toHaveLength(1_000)
    await store.close()
  })

describe('CachedHttpFetchProvider — redirects + revalidate fallback (5.6)', () => {
  it('follows a same-origin redirect to the final document', async () => {
    const store = makeStore()
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith('/start')) {
        return fakeResponse({ status: 302, headers: { location: '/final' } })
      }
      return fakeResponse({ status: 200, body: '<html>final</html>', headers: { 'content-type': 'text/html' } })
    })
    const provider = makeProvider(store)
    const result = await provider.fetch({ url: 'https://example.com/start' })
    expect(result.statusCode).toBe(200)
    expect(result.url).toBe('https://example.com/final')
    expect(result.body.content).toBe('<html>final</html>')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await store.close()
  })

  it('blocks a redirect chain longer than maxRedirects with WEB_REDIRECT_BLOCKED', async () => {
    const store = makeStore()
    fetchMock.mockImplementation(async (url: string) => fakeResponse({ status: 302, headers: { location: '/loop' } }))
    const provider = makeProvider(store, { maxRedirects: 1 })
    await expect(provider.fetch({ url: 'https://example.com/start' })).rejects.toMatchObject({ code: 'WEB_REDIRECT_BLOCKED' })
    // The initial hop + one redirect attempt, then the cap.
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await store.close()
  })

  it('rejects a redirect response without a Location header', async () => {
    const store = makeStore()
    fetchMock.mockResolvedValue(fakeResponse({ status: 302 }))
    const provider = makeProvider(store)
    await expect(provider.fetch({ url: 'https://example.com/start' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
    await store.close()
  })

  it('blocks a cross-origin redirect with WEB_REDIRECT_BLOCKED', async () => {
    const store = makeStore()
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith('/start')) {
        return fakeResponse({ status: 302, headers: { location: 'https://other.example.org/x' } })
      }
      return fakeResponse({ status: 200, body: '<html>never</html>' })
    })
    const provider = makeProvider(store)
    await expect(provider.fetch({ url: 'https://example.com/start' })).rejects.toMatchObject({ code: 'WEB_REDIRECT_BLOCKED' })
    await store.close()
  })

  it('revalidate: a non-304/2xx response falls back to a full fetch', async () => {
    const store = makeStore()
    const key = normalizeUrl('https://example.com')
    await store.recordPage({
      url: 'https://example.com/',
      normalizedUrl: key,
      fetchedAt: Date.now() - 120_000, // beyond the 60s TTL
      etag: 'W/"v1"',
      statusCode: 200,
      bodyKind: 'html',
      body: '<html>stale</html>',
      truncated: false,
    })
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith('/moved')) {
        return fakeResponse({ status: 200, body: '<html>moved</html>', headers: { 'content-type': 'text/html' } })
      }
      // The conditional request gets a redirect: revalidation cannot proceed.
      return fakeResponse({ status: 302, headers: { location: '/moved' } })
    })
    const provider = makeProvider(store)
    const result = await provider.fetch({ url: 'https://example.com' })
    expect(result.url).toBe('https://example.com/moved')
    expect(result.body.content).toBe('<html>moved</html>')
    await store.close()
  })
})
