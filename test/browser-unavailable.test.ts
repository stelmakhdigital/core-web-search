import { describe, expect, it, vi } from 'vitest'
import { CoreError, errorCodeOf } from '../src/errors.ts'
import { PlaywrightProvider } from '../src/browser/playwright.ts'

/**
 * Simulates a host where the optional `playwright` package is not installed:
 * the dynamic import rejects, and the core must degrade gracefully
 * (BROWSER_UNAVAILABLE with an actionable message — ADR-005 §4).
 */
vi.mock('playwright', () => {
  throw new Error("Cannot find package 'playwright'")
})

describe('PlaywrightProvider without playwright installed', () => {
  it('open() fails with BROWSER_UNAVAILABLE and an actionable message', async () => {
    const provider = new PlaywrightProvider()
    const error = await provider.open({}, undefined).catch((value: unknown) => value)
    expect(error).toBeInstanceOf(CoreError)
    expect(errorCodeOf(error)).toBe('BROWSER_UNAVAILABLE')
    expect((error as CoreError).message).toContain('optional dependency')
    expect((error as CoreError).message).toContain('playwright')
  })

  it('available() turns false once the load failure is known', async () => {
    const provider = new PlaywrightProvider()
    // Let the cached load promise settle (it rejects).
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(provider.available()).toBe(false)
  })

  it('available() is never true after a failed load (no launch attempts)', async () => {
    const provider = new PlaywrightProvider()
    await Promise.resolve()
    await Promise.resolve()
    expect(provider.available()).toBe(false)
  })
})
