/**
 * Browser readiness probe (host convenience): reports whether the optional
 * playwright package and the Chromium browser binary are actually usable on
 * this host, with an actionable hint when they are not. The probe never
 * launches a browser and never downloads anything; the only side effect is
 * an optional `ldd <binary>` parse on Linux (a static dependency read — it
 * detects the common "binary downloaded but system libraries missing" state,
 * which a plain existence check would report as ready).
 * @module @agents-web-search/core/browser/readiness
 */

import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

import { loadPlaywright } from './playwright.ts'

/** One readiness report (`browserReadiness()`). */
export interface BrowserReadiness {
  /** The `playwright` package resolves. */
  readonly playwright: boolean
  /** The Chromium binary is downloaded (`playwright install chromium`). */
  readonly chromium: boolean
  /** Actionable fix when something is missing; undefined when ready. */
  readonly hint?: string
}

/** Test seam: platform + `ldd` runner + executable override (all overridable
 * in tests so the launchability branch is exercised on any runner). */
export interface ReadinessDeps {
  readonly platform?: NodeJS.Platform
  /** Missing shared-library names for one executable, or undefined when the
   * probe does not apply (non-Linux, no ldd) — never rejects. */
  readonly missingLibs?: (executable: string) => Promise<readonly string[] | undefined>
  /** Override the Chromium executable path (tests; default is playwright's). */
  readonly executable?: string
  /** Package-family override for the missing-libraries hint (tests;
   * default is detected from /etc/os-release on Linux). */
  readonly distro?: string | undefined
}

/** Package family for install hints: 'debian' | 'fedora' | 'arch' | 'alpine'
 * (from /etc/os-release ID/ID_LIKE); undefined when unrecognized. */
export function detectDistroFamily(): string | undefined {
  let text: string
  try {
    text = readFileSync('/etc/os-release', 'utf8')
  } catch {
    return undefined
  }
  // /etc/os-release values appear quoted (VERSION_ID="24.04") or bare
  // (ID=ubuntu) depending on the distro — accept both.
  const field = (name: string): string => {
    const m = new RegExp(`(?:^|\\n)${name}="([^"\n]*)"|(?:^|\\n)${name}=([^"\n]*)`).exec(text)
    return m?.[1] ?? m?.[2] ?? ''
  }
  const ids = `${field('ID')} ${field('ID_LIKE')}`.toLowerCase()
  if (/debian|ubuntu/.test(ids)) return 'debian'
  if (/fedora|rhel|centos/.test(ids)) return 'fedora'
  if (/arch/.test(ids)) return 'arch'
  if (/alpine/.test(ids)) return 'alpine'
  return undefined
}

/** Direct library-install command per package family (undefined = none known;
 * the generic `--with-deps` form stays the primary suggestion everywhere). */
function libInstallCommand(family: string | undefined): string | undefined {
  switch (family) {
    case 'debian':
      return 'sudo apt-get install -y libnspr4 libnss3 libasound2t64'
    case 'fedora':
      return 'sudo dnf install -y nspr nss alsa-lib'
    case 'arch':
      return 'sudo pacman -S nspr nss alsa-lib'
    case 'alpine':
      return 'sudo apk add nspr nss alsa-lib'
    default:
      return undefined
  }
}

/** `ldd <executable>` → the `=> not found` library names (Linux only). */
export async function lddMissingLibs(executable: string): Promise<readonly string[] | undefined> {
  return await new Promise((resolve) => {
    execFile('ldd', [executable], { timeout: 2_000 }, (error, stdout) => {
      if (error !== null) {
        resolve(undefined) // no ldd / unreadable binary: probe not applicable
        return
      }
      const missing = stdout
        .split('\n')
        .map((line) => /^\s*(\S+)\s+=>\s+not found/.exec(line)?.[1])
        .filter((name): name is string => name !== undefined)
      resolve(missing)
    })
  })
}

/**
 * Check the host for browser-module readiness: playwright importable AND the
 * Chromium executable present on disk AND (on Linux) its system libraries
 * resolvable. Fire-and-forget safe (no launch, no network); designed for the
 * host's `session_start`.
 */
export async function browserReadiness(deps: ReadinessDeps = {}): Promise<BrowserReadiness> {
  const platform = deps.platform ?? process.platform
  const missingLibs = deps.missingLibs ?? lddMissingLibs
  try {
    const pw = await loadPlaywright()
    const executable = deps.executable ?? pw.chromium.executablePath()
    const chromium = typeof executable === 'string' && executable.length > 0 && existsSync(executable)
    if (!chromium) {
      return {
        playwright: true,
        chromium: false,
        hint:
          'the playwright package is installed, but the Chromium browser is not downloaded — '
          + 'run `npx playwright install chromium` once (or the agents-web-search scripts/browser/install.sh), '
          + 'or disable the browser module (browser.enabled: false in the config)',
      }
    }
    // Binary present: on Linux, verify the shared libraries resolve — a bare
    // host without libnss3/libnspr4/libasound fails launch with a raw
    // loader error the user cannot act on from the session_start notice.
    if (platform === 'linux') {
      const missing = await missingLibs(executable)
      if (missing !== undefined && missing.length > 0) {
        const distro = deps.distro ?? detectDistroFamily()
        const direct = libInstallCommand(distro)
        return {
          playwright: true,
          chromium: true,
          hint:
            `the Chromium binary is present, but system libraries are missing (${missing.join(', ')}) — `
            + 'run `npx playwright install --with-deps chromium` (needs sudo)' + (direct === undefined ? '' : `, or ${direct}`) + ', '
            + 'or disable the browser module (browser.enabled: false in the config)',
        }
      }
    }
    return { playwright: true, chromium: true }
  } catch {
    return {
      playwright: false,
      chromium: false,
      hint:
        'playwright is not installed where the core runs — install it (`npm install playwright`) '
        + 'and download Chromium (`npx playwright install chromium`), '
        + 'or disable the browser module (browser.enabled: false in the config)',
    }
  }
}
