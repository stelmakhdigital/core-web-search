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
  it('linux + missing system libraries (executable override): hint names the libs and --with-deps', async () => {
    const readiness = await browserReadiness({
      platform: 'linux',
      executable: '/bin/ls', // any existing binary on any runner
      missingLibs: async () => ['libnspr4.so', 'libnss3.so'],
    })
    expect(readiness.chromium).toBe(true)
    expect(readiness.hint).toContain('libnspr4.so')
    expect(readiness.hint).toContain('libnss3.so')
    expect(readiness.hint).toContain('--with-deps')
  })

  it('distro seam: per-family direct install command appears in the hint', async () => {
    const base = { platform: 'linux' as const, executable: '/bin/ls', missingLibs: async () => ['libnspr4.so'] }
    const fedora = await browserReadiness({ ...base, distro: 'fedora' })
    expect(fedora.hint).toContain('dnf install -y nspr nss alsa-lib')
    const arch = await browserReadiness({ ...base, distro: 'arch' })
    expect(arch.hint).toContain('pacman -S nspr nss alsa-lib')
    const alpine = await browserReadiness({ ...base, distro: 'alpine' })
    expect(alpine.hint).toContain('apk add nspr nss alsa-lib')
    const debian = await browserReadiness({ ...base, distro: 'debian' })
    expect(debian.hint).toContain('apt-get install -y libnspr4 libnss3 libasound2t64')
    // Unknown distro: only the generic --with-deps form, no invented packages.
    const unknown = await browserReadiness({ ...base, distro: 'plan9' })
    expect(unknown.hint).toContain('--with-deps')
    expect(unknown.hint).not.toContain('apt-get')
    expect(unknown.hint).not.toContain('dnf')
  })

  it('detectDistroFamily reads /etc/os-release on Linux (real env invariant)', async () => {
    if (process.platform !== 'linux') return // no /etc/os-release contract elsewhere
    const { existsSync, readFileSync } = await import('node:fs')
    const { detectDistroFamily } = await import('../src/browser/readiness.ts')
    if (!existsSync('/etc/os-release')) return
    const family = detectDistroFamily()
    // The file exists → either a mapped family or undefined for genuinely
    // exotic distros; on CI (ubuntu) it must be 'debian'.
    const like = readFileSync('/etc/os-release', 'utf8')
    if (/ubuntu|debian/.test(like)) expect(family).toBe('debian')
    else expect(['fedora', 'arch', 'alpine', undefined]).toContain(family)
  })

  it('linux + all libraries present (executable override): ready', async () => {
    const readiness = await browserReadiness({ platform: 'linux', executable: '/bin/ls', missingLibs: async () => [] })
    expect(readiness.chromium).toBe(true)
    expect(readiness.hint).toBeUndefined()
  })

  it('linux + ldd unavailable (probe declines): ready without guessing', async () => {
    const readiness = await browserReadiness({ platform: 'linux', executable: '/bin/ls', missingLibs: async () => undefined })
    expect(readiness.hint).toBeUndefined()
  })

  it('executable override absent: not-downloaded branch wins regardless of libs', async () => {
    const readiness = await browserReadiness({
      platform: 'linux',
      executable: '/nonexistent/chromium-binary-here',
      missingLibs: async () => ['libnspr4.so'],
    })
    expect(readiness.chromium).toBe(false)
    expect(readiness.hint).toContain('playwright install chromium')
  })

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
