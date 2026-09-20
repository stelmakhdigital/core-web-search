import { describe, expect, it, vi } from 'vitest'
import { reciprocalRankFuse } from '../src/search/rrf.ts'
import { EngineCooldown } from '../src/search/cooldown.ts'
import { RateLimiter } from '../src/search/rate-limit.ts'
import { normalizeUrl } from '../src/search/url.ts'

describe('reciprocalRankFuse (RRF)', () => {
  it('ranks consensus documents above single-engine ones', () => {
    const a = [{ url: 'https://one.example/', title: 'One' }, { url: 'https://two.example/' }]
    const b = [{ url: 'https://two.example/' }, { url: 'https://three.example/' }]
    const fused = reciprocalRankFuse([a, b])
    // 'two' appears in both lists → highest score.
    expect(fused[0]?.url).toBe('https://two.example/')
    expect(fused).toHaveLength(3)
  })

  it('deduplicates by normalized url and merges missing fields', () => {
    const a = [{ url: 'https://one.example/' }]
    const b = [{ url: 'https://one.example/?utm_source=x', title: 'T', snippet: 'S', publishedAt: '2026-01-01' }]
    const fused = reciprocalRankFuse([a, b])
    expect(fused).toHaveLength(1)
    expect(fused[0]).toEqual({ url: 'https://one.example/', title: 'T', snippet: 'S', publishedAt: '2026-01-01' })
  })

  it('keeps existing fields (first list wins) and honors k', () => {
    const a = [{ url: 'https://one.example/', title: 'First' }]
    const b = [{ url: 'https://one.example/', title: 'Second' }]
    const fused = reciprocalRankFuse([a, b])
    expect(fused[0]?.title).toBe('First')
    // Smaller k → stronger rank sensitivity: top rank beats deep ranks more.
    const deep = reciprocalRankFuse([[{ url: 'https://x.example/' }, { url: 'https://y.example/' }]], 1)
    expect(deep[0]?.url).toBe('https://x.example/')
  })

  it('returns [] for empty input', () => {
    expect(reciprocalRankFuse([])).toEqual([])
    expect(reciprocalRankFuse([[], []])).toEqual([])
  })
})

describe('EngineCooldown (exponential backoff)', () => {
  it('cooling down after a failure, doubling each time, capped at max', () => {
    let t = 0
    const cd = new EngineCooldown({ baseMs: 100, maxMs: 400, now: () => t })
    expect(cd.isCoolingDown('ddg')).toBe(false)
    cd.recordFailure('ddg')
    expect(cd.isCoolingDown('ddg')).toBe(true)
    expect(cd.remainingMs('ddg')).toBe(100)
    t = 100
    expect(cd.isCoolingDown('ddg')).toBe(false) // exactly at the boundary is not cooling
    cd.recordFailure('ddg')
    expect(cd.remainingMs('ddg')).toBe(200)
    cd.recordFailure('ddg') // 3rd failure → 400 (100*4) capped at 400
    expect(cd.remainingMs('ddg')).toBe(400)
    cd.recordFailure('ddg') // 4th → would be 800, capped at 400
    expect(cd.remainingMs('ddg')).toBe(400)
  })

  it('success clears the cooldown', () => {
    let t = 0
    const cd = new EngineCooldown({ baseMs: 100, maxMs: 400, now: () => t })
    cd.recordFailure('bing')
    cd.recordSuccess('bing')
    expect(cd.isCoolingDown('bing')).toBe(false)
    expect(cd.remainingMs('bing')).toBe(0)
  })

  it('remainingMs is 0 once the window has passed', () => {
    let t = 0
    const cd = new EngineCooldown({ baseMs: 100, maxMs: 400, now: () => t })
    cd.recordFailure('x')
    t = 1000
    expect(cd.remainingMs('x')).toBe(0)
    expect(cd.isCoolingDown('x')).toBe(false)
  })
})

describe('RateLimiter (token bucket)', () => {
  it('rejects a non-positive rate', () => {
    expect(() => new RateLimiter({ perSec: 0 })).toThrow()
  })

  it('serves a burst immediately, then waits (sleep advances the clock)', async () => {
    let t = 0
    const sleeps: number[] = []
    const limiter = new RateLimiter({
      perSec: 2,
      burst: 2,
      jitterMs: 0,
      now: () => t,
      sleep: async (ms) => {
        sleeps.push(ms)
        t += ms // simulated time passes during the wait → one token refills
      },
    })
    await limiter.acquire()
    await limiter.acquire()
    // Third acquire: no tokens → must sleep once, then be served.
    await limiter.acquire()
    expect(sleeps).toHaveLength(1)
    expect(sleeps[0]).toBeGreaterThanOrEqual(500)
    expect(sleeps[0]).toBeLessThan(505) // deficit 1 / (2/1000) ≈ 500ms
  })

  it('refills tokens over elapsed time', async () => {
    let t = 0
    const limiter = new RateLimiter({
      perSec: 10,
      burst: 1,
      jitterMs: 0,
      now: () => t,
      sleep: async () => {
        t += 1000 // one second passes → full refill
      },
    })
    await limiter.acquire()
    t += 1000 // wait a second so the next acquire refills a token
    await limiter.acquire()
  })

  it('aborts a pending wait with an AbortError', async () => {
    const controller = new AbortController()
    let sleepMs = 0
    const limiter = new RateLimiter({
      perSec: 1,
      jitterMs: 0,
      now: () => 0,
      sleep: (ms, signal) => {
        sleepMs = ms
        return new Promise<void>((resolve, reject) => {
          const id = setTimeout(resolve, 50)
          signal?.addEventListener('abort', () => {
            clearTimeout(id)
            reject(new DOMException('rate limit wait aborted', 'AbortError'))
          }, { once: true })
        })
      },
    })
    // Consume the single token, then abort the second wait mid-flight.
    await limiter.acquire()
    const pending = limiter.acquire(controller.signal).catch((e: unknown) => e)
    controller.abort()
    const error = await pending
    expect((error as DOMException).name).toBe('AbortError')
    expect(sleepMs).toBe(1000) // deficit 1 / (1/1000)
  })

  it('rejects immediately when the signal is already aborted', async () => {
    const limiter = new RateLimiter({ perSec: 1, jitterMs: 0, now: () => 0 })
    const controller = new AbortController()
    controller.abort()
    const error = await limiter.acquire(controller.signal).catch((e: unknown) => e)
    expect((error as DOMException).name).toBe('AbortError')
  })
})

describe('normalizeUrl (edge cases)', () => {
  it('returns unparseable input unchanged', () => {
    expect(normalizeUrl('not a url')).toBe('not a url')
    expect(normalizeUrl('')).toBe('')
  })

  it('lowercases the host, strips hash and all tracking prefixes', () => {
    expect(normalizeUrl('HTTPS://Example.COM/a?FBCLID=z&gclid=g&mc_cid=c&mc_eid=e&ref=r&source=s&utm_campaign=x#h'))
      .toBe('https://example.com/a')
  })
})
