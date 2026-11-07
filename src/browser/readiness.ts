/**
 * Browser readiness probe (host convenience): reports whether the optional
 * playwright package and the Chromium browser binary are actually usable on
 * this host, with an actionable hint when they are not. The probe never
 * launches a browser and never downloads anything.
 * @module @agents-web-search/core/browser/readiness
 */

import { existsSync } from 'node:fs'

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

/**
 * Check the host for browser-module readiness: playwright importable AND the
 * Chromium executable present on disk. Fire-and-forget safe (no launch, no
 * network); designed for the host's `session_start`.
 */
export async function browserReadiness(): Promise<BrowserReadiness> {
  try {
    const pw = await loadPlaywright()
    const executable = pw.chromium.executablePath()
    const chromium = typeof executable === 'string' && executable.length > 0 && existsSync(executable)
    if (chromium) return { playwright: true, chromium: true }
    return {
      playwright: true,
      chromium: false,
      hint:
        'the playwright package is installed, but the Chromium browser is not downloaded — '
        + 'run `npx playwright install chromium` once (or the agents-web-search scripts/browser/install.sh), '
        + 'or disable the browser module (browser.enabled: false in the config)',
    }
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
