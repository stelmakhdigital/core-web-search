import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { checkSsrf } from '../src/fetch/ssrf.ts'

// Mock node:dns/promises so domain tests control the resolved addresses.
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(),
}))

import { lookup } from 'node:dns/promises'
const mockLookup = vi.mocked(lookup)

/**
 * `lookup` is overloaded (with/without `all: true`); `vi.mocked` keeps the
 * overloads, so the `all: true` result shape needs a cast to the union.
 */
function resolvedAddresses(addresses: Array<{ address: string; family: number }>): Awaited<ReturnType<typeof lookup>> {
  return addresses as unknown as Awaited<ReturnType<typeof lookup>>
}

beforeEach(() => {
  mockLookup.mockReset()
})

describe('checkSsrf — IP literals (no DNS)', () => {
  it('allows a public IPv4 literal', async () => {
    const result = await checkSsrf('http://8.8.8.8/')
    expect(result.allowed).toBe(true)
    expect(result.addresses).toEqual(['8.8.8.8'])
  })

  it('allows a public IPv4 literal (https)', async () => {
    const result = await checkSsrf('https://1.1.1.1/')
    expect(result.allowed).toBe(true)
  })

  it.each([
    ['http://10.0.0.1/', '10/8 private'],
    ['http://172.16.0.1/', '172.16/12 private'],
    ['http://172.31.255.255/', '172.16/12 private (upper bound)'],
    ['http://192.168.1.1/', '192.168/16 private'],
    ['http://127.0.0.1/', 'loopback'],
    ['http://169.254.169.254/', 'link-local (cloud metadata)'],
    ['http://0.0.0.0/', 'this network'],
  ])('blocks %s (%s)', async (url, _label) => {
    const result = await checkSsrf(url)
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/private|reserved/)
  })

  it.each([
    ['http://[::1]/', 'IPv6 loopback'],
    ['http://[::]/', 'IPv6 unspecified'],
    ['http://[fe80::1]/', 'IPv6 link-local'],
    ['http://[fc00::1]/', 'IPv6 ULA (fc)'],
    ['http://[fd00::1]/', 'IPv6 ULA (fd)'],
  ])('blocks %s (%s)', async (url, _label) => {
    const result = await checkSsrf(url)
    expect(result.allowed).toBe(false)
  })
})

describe('checkSsrf — embedded-IPv4 forms (mapped/compatible/NAT64)', () => {
  // Regression: Node's fetch connects through these to the mapped IPv4 host,
  // so a private IPv4 tail must be blocked even when the address is written
  // in IPv6 notation (the URL parser keeps it as an IPv6 hostname).
  it.each([
    ['http://[::ffff:127.0.0.1]/', 'IPv4-mapped loopback'],
    ['http://[::ffff:10.0.0.1]/', 'IPv4-mapped 10/8 private'],
    ['http://[::ffff:169.254.169.254]/', 'IPv4-mapped cloud metadata'],
    ['http://[::ffff:192.168.1.1]/', 'IPv4-mapped 192.168/16 private'],
    ['http://[::ffff:172.16.0.1]/', 'IPv4-mapped 172.16/12 private'],
    ['http://[::ffff:0.0.0.0]/', 'IPv4-mapped this-network'],
    ['http://[::10.0.0.1]/', 'IPv4-compatible 10/8 private'],
    ['http://[64:ff9b::169.254.169.254]/', 'NAT64 cloud metadata'],
  ])('blocks %s (%s)', async (url, _label) => {
    const result = await checkSsrf(url)
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/private|reserved/)
  })

  it('allows an IPv4-mapped address with a public tail', async () => {
    const result = await checkSsrf('http://[::ffff:8.8.8.8]/')
    expect(result.allowed).toBe(true)
  })

  it('allows a plain public IPv6 literal', async () => {
    const result = await checkSsrf('http://[2606:4700:4700::1111]/')
    expect(result.allowed).toBe(true)
  })
})

describe('checkSsrf — protocol / parse guards', () => {
  it.each([
    ['ftp://example.com/', 'ftp'],
    ['file:///etc/passwd', 'file'],
    ['gopher://example.com/', 'gopher'],
  ])('blocks %s protocol', async (url) => {
    const result = await checkSsrf(url)
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/protocol/)
  })

  it('blocks an unparseable URL', async () => {
    const result = await checkSsrf('not-a-url')
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/unparseable/)
  })
})

describe('checkSsrf — domain resolution (DNS mock)', () => {
  it('allows a domain that resolves to a public IP', async () => {
    mockLookup.mockResolvedValueOnce(resolvedAddresses([{ address: '93.184.216.34', family: 4 }]))
    const result = await checkSsrf('https://example.com/')
    expect(result.allowed).toBe(true)
    expect(result.addresses).toEqual(['93.184.216.34'])
  })

  it('blocks a domain that resolves to a private IP', async () => {
    mockLookup.mockResolvedValueOnce(resolvedAddresses([{ address: '10.0.0.5', family: 4 }]))
    const result = await checkSsrf('https://internal.example.com/')
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/private|reserved/)
  })

  it('blocks a domain with mixed public+private addresses (anti-rebinding)', async () => {
    mockLookup.mockResolvedValueOnce(resolvedAddresses([
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]))
    const result = await checkSsrf('https://rebinding.example.com/')
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/private|reserved/)
  })

  it('blocks when DNS resolution fails', async () => {
    mockLookup.mockRejectedValueOnce(new Error('ENOTFOUND'))
    const result = await checkSsrf('https://missing.example.com/')
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/DNS resolution failed/)
  })

  it('blocks when no addresses resolve', async () => {
    mockLookup.mockResolvedValueOnce(resolvedAddresses([]))
    const result = await checkSsrf('https://empty.example.com/')
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/no addresses/)
  })
})

describe('checkSsrf — allowPrivate bypass', () => {
  it('allows a private IP when allowPrivate is true', async () => {
    const result = await checkSsrf('http://10.0.0.1/', { allowPrivate: true })
    expect(result.allowed).toBe(true)
  })

  it('allows any URL when allowPrivate is true', async () => {
    const result = await checkSsrf('http://127.0.0.1/admin', { allowPrivate: true })
    expect(result.allowed).toBe(true)
  })
})

/* ------------------------------------------------------------------ */
/* fetchPublic — the SSRF guard enforced on every redirect hop (6.3)  */
/* ------------------------------------------------------------------ */

import { fetchPublic, SsrfBlockedError, SSRF_MAX_REDIRECTS } from '../src/fetch/ssrf.ts'

/** Minimal Response stand-in (status + headers + a cancellable body). */
function fakeRedirectResponse(status: number, location?: string): Response {
  const headers = new Headers(location !== undefined ? { location } : {})
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close()
    },
  })
  return {
    status,
    ok: status >= 200 && status < 300,
    statusText: String(status),
    headers,
    body: stream,
    url: '',
  } as unknown as Response
}

describe('fetchPublic — redirect handling (6.3 security review)', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  // The redirect targets below must pass the guard's DNS check.
  beforeEach(() => {
    mockLookup.mockImplementation(async () => {
      const records = [{ address: '93.184.215.14', family: 4 }, { address: '203.0.113.7', family: 4 }]
      return records as unknown as Awaited<ReturnType<typeof lookup>>
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('follows a public redirect hop and returns the final response', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith('/start')) return fakeRedirectResponse(302, '/final')
      return { status: 200, ok: true, statusText: 'OK', headers: new Headers(), body: null, url: '' } as unknown as Response
    })
    const response = await fetchPublic('https://example.com/start')
    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[1]![0])).toBe('https://example.com/final')
    // The request used manual redirects so the guard sees every hop.
    expect(fetchMock.mock.calls[0]![1]!).toMatchObject({ redirect: 'manual' })
  })

  it('blocks a redirect that lands on a private address (metadata SSRF)', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith('/start')) return fakeRedirectResponse(302, 'http://169.254.169.254/latest/meta-data/')
      throw new Error('must not fetch the private target')
    })
    await expect(fetchPublic('https://example.com/start')).rejects.toBeInstanceOf(SsrfBlockedError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('blocks a redirect to a domain that resolves to a private IP (rebinding hop)', async () => {
    mockLookup.mockImplementation(async (host: string) => {
      if (host === 'evil.example') {
        return [{ address: '10.0.0.5', family: 4 }] as unknown as Awaited<ReturnType<typeof lookup>>
      }
      const records = [{ address: '93.184.215.14', family: 4 }]
      return records as unknown as Awaited<ReturnType<typeof lookup>>
    })
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith('/start')) return fakeRedirectResponse(302, 'http://evil.example/steal')
      throw new Error('must not fetch the rebinding target')
    })
    await expect(fetchPublic('https://example.com/start')).rejects.toBeInstanceOf(SsrfBlockedError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects a redirect to a non-http(s) protocol', async () => {
    fetchMock.mockResolvedValue(fakeRedirectResponse(302, 'ftp://example.com/file'))
    await expect(fetchPublic('https://example.com/start')).rejects.toThrow(/unsupported protocol/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects a redirect without a Location header', async () => {
    fetchMock.mockResolvedValue(fakeRedirectResponse(301))
    await expect(fetchPublic('https://example.com/start')).rejects.toThrow(/without a Location header/)
  })

  it('stops after the redirect cap', async () => {
    fetchMock.mockImplementation(async () => fakeRedirectResponse(302, '/loop'))
    await expect(fetchPublic('https://example.com/start', { maxRedirects: 2 })).rejects.toThrow(/maximum of 2 redirects/)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    await expect(fetchPublic('https://example.com/start').catch((error: unknown) => error)).resolves.toMatchObject(
      { message: `exceeded the maximum of ${SSRF_MAX_REDIRECTS} redirects` },
    )
  })

  it('bypasses the guard entirely with allowPrivate', async () => {
    fetchMock.mockResolvedValue({ status: 200, ok: true, statusText: 'OK', headers: new Headers(), body: null, url: '' } as unknown as Response)
    const response = await fetchPublic('http://127.0.0.1:9/', { allowPrivate: true })
    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
