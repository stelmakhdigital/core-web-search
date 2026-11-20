/**
 * Stealth-hardening units: UA derivation, default launch args, and the
 * config plumbing for the new browser fields (pure — no browser launches).
 */
import { describe, expect, it } from 'vitest'

import { contextUserAgent, STEALTH_ARGS } from '../src/browser/playwright.ts'
import { resolveCoreConfig } from '../src/config.ts'

const cfg = (extra?: Record<string, unknown>) => resolveCoreConfig(extra as never, '/tmp/aws-stealth-test')

describe('contextUserAgent', () => {
  it('strips the HeadlessChrome token and pins major.0.0.0 (Linux host)', () => {
    expect(contextUserAgent('HeadlessChrome/159.0.8154.6', undefined, 'linux'))
      .toBe('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/159.0.0.0 Safari/537.36')
  })

  it('maps the platform token (macOS/Windows)', () => {
    expect(contextUserAgent('Chrome/131.0.1', undefined, 'darwin')).toContain('Macintosh; Intel Mac OS X 10_15_7')
    expect(contextUserAgent('Chrome/131.0.1', undefined, 'win32')).toContain('Windows NT 10.0; Win64; x64')
  })

  it('maps a bare playwright version string (Browser.version() reality)', () => {
    expect(contextUserAgent('159.0.8154.6', undefined, 'linux'))
      .toBe('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/159.0.0.0 Safari/537.36')
  })

  it('explicit override wins untouched', () => {
    expect(contextUserAgent('HeadlessChrome/159', 'MyAgent/2.0', 'linux')).toBe('MyAgent/2.0')
  })

  it('no Chrome token (or no version): undefined — the browser default UA stays', () => {
    expect(contextUserAgent(undefined, undefined, 'linux')).toBeUndefined()
    expect(contextUserAgent('Firefox/130.0', undefined, 'linux')).toBeUndefined()
  })
})

describe('launch hardening defaults', () => {
  it('stealth args remove the automation marker by default', () => {
    expect(STEALTH_ARGS).toContain('--disable-blink-features=AutomationControlled')
  })

  it('resolved browser config: headlessMode chrome, launchArgs [], userAgent undefined by default', () => {
    const resolved = cfg()
    expect(resolved.browser.headlessMode).toBe('chrome')
    expect(resolved.browser.launchArgs).toEqual([])
    expect(resolved.browser.userAgent).toBeUndefined()
  })

  it('user-supplied browser hardening fields pass through; bad headlessMode rejected', () => {
    const resolved = cfg({ browser: { enabled: true, headlessMode: 'shell', userAgent: 'UA/1', launchArgs: ['--no-sandbox'] } })
    expect(resolved.browser.headlessMode).toBe('shell')
    expect(resolved.browser.userAgent).toBe('UA/1')
    expect(resolved.browser.launchArgs).toEqual(['--no-sandbox'])
    expect(() => cfg({ browser: { headlessMode: 'firefox' } })).toThrow(/headlessMode/)
  })
})
