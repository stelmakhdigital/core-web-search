import { describe, expect, it } from 'vitest'
import { browserReadiness, lddMissingLibs } from '../src/browser/readiness.ts'

// Real environment (playwright is a dev/optional dependency). The Chromium
// binary may or may not be downloaded, and its system libraries may be
// missing (a bare Linux host) — the tests assert the invariants for whatever
// state this machine is actually in.
describe('browserReadiness (real environment)', () => {
  it('invariants hold for this machine state', async () => {
    const readiness = await browserReadiness()
    expect(readiness.playwright).toBe(true)
    if (!readiness.chromium) expect(readiness.hint).toContain('playwright install chromium')
    if (readiness.hint === undefined) expect(readiness.chromium).toBe(true)
    if (readiness.chromium && readiness.hint !== undefined) {
      // binary present but not launchable: the hint must name the deeper fix
      expect(readiness.hint).toContain('--with-deps')
    }
  })

  it('returns exactly the documented shape (no extras)', async () => {
    const readiness = await browserReadiness()
    const keys = Object.keys(readiness).sort()
    expect(keys).toEqual(readiness.hint === undefined
      ? ['chromium', 'playwright']
      : ['chromium', 'hint', 'playwright'])
  })
})

describe('browserReadiness (seams)', () => {
  it('linux + missing system libraries: chromium true, hint names the libs and --with-deps', async () => {
    const readiness = await browserReadiness({
      platform: 'linux',
      missingLibs: async () => ['libnspr4.so', 'libnss3.so'],
    })
    if (!readiness.chromium) return // binary not downloaded here — the not-downloaded branch wins by design
    expect(readiness.hint).toContain('libnspr4.so')
    expect(readiness.hint).toContain('libnss3.so')
    expect(readiness.hint).toContain('--with-deps')
  })

  it('linux + all libraries present: ready', async () => {
    const readiness = await browserReadiness({ platform: 'linux', missingLibs: async () => [] })
    if (!readiness.chromium) return // binary missing on this machine — nothing to probe
    expect(readiness.hint).toBeUndefined()
  })

  it('non-linux platform: no library probe is run', async () => {
    let probed = false
    const readiness = await browserReadiness({
      platform: 'darwin',
      missingLibs: async () => {
        probed = true
        return []
      },
    })
    expect(probed).toBe(false)
    expect(readiness.playwright).toBe(true)
  })
})

describe('lddMissingLibs (real ldd)', () => {
  it('a healthy system binary: no missing libs (undefined only when ldd itself fails)', async () => {
    const missing = await lddMissingLibs('/bin/ls')
    // CI (ubuntu) and dev Linux resolve ldd; where ldd is absent the probe
    // declines with undefined — both are acceptable, garbage is not.
    if (missing !== undefined) expect(missing).toEqual([])
  })

  it('unreadable binary: probe declines (undefined), never throws', async () => {
    expect(await lddMissingLibs('/nonexistent/chromium-binary-here')).toBeUndefined()
  })
})
