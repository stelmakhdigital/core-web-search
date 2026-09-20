/**
 * The browser automation module (ADR-005 §4, Q8): Playwright-backed sessions,
 * the per-stack {@link BrowserManager}, and the model-facing `browser_*`
 * tools. Enabled via `config.browser.enabled` (default false).
 * @module @agents-web-search/core/browser
 */

export {
  type BrowserElement,
  type BrowserNavigateResult,
  type BrowserOpenOptions,
  type BrowserScreenshot,
  type BrowserScreenshotOptions,
  type BrowserSession,
  type BrowserSnapshot,
  type BrowserSnapshotOptions,
  type BrowserTarget,
  BROWSER_CODES,
  type BrowserCode,
} from './types.ts'
export {
  assertPublicNavigation,
  loadPlaywright,
  PlaywrightProvider,
  type CoreBrowserProvider,
  type PlaywrightProviderConfig,
} from './playwright.ts'
export { ANON_KEY, createBrowserManager, type BrowserManager, type BrowserManagerOptions } from './manager.ts'
export { buildBrowserTools, type BrowserToolDeps } from './tools.ts'
export { writeScreenshot } from './screenshot.ts'
