/**
 * Vocabulary for the browser automation capability. A browser is a
 * long-lived, stateful session (unlike the stateless search/fetch layers), so
 * the core exposes a {@link BrowserSession} owned by a {@link BrowserManager}
 * (one manager per stack; sessions keyed by an arbitrary agent key).
 *
 * Errors are `CoreError`s with the `BROWSER_*` code family (ADR-005 §3:
 * sensitive actions are gated by the host approver, fail-closed).
 * @module @agents-web-search/core/browser/types
 */

/** Machine-routable browser error codes (part of the `CoreError` vocabulary). */
export const BROWSER_CODES = {
  UNAVAILABLE: 'BROWSER_UNAVAILABLE',
  NOT_OPEN: 'BROWSER_NOT_OPEN',
  ALREADY_OPEN: 'BROWSER_ALREADY_OPEN',
  INVALID_URL: 'BROWSER_INVALID_URL',
  ACTION_FAILED: 'BROWSER_ACTION_FAILED',
  TIMEOUT: 'BROWSER_TIMEOUT',
  ABORTED: 'BROWSER_ABORTED',
  APPROVAL_DENIED: 'BROWSER_APPROVAL_DENIED',
  APPROVAL_UNAVAILABLE: 'BROWSER_APPROVAL_UNAVAILABLE',
  AUTH_MISSING: 'BROWSER_AUTH_MISSING',
  SSRF_BLOCKED: 'BROWSER_SSRF_BLOCKED',
} as const

export type BrowserCode = (typeof BROWSER_CODES)[keyof typeof BROWSER_CODES]

/** Options for opening a browser session. */
export interface BrowserOpenOptions {
  /** Run the browser headless (no visible window). Default: provider config. */
  readonly headless?: boolean
  /** Name of a configured auth profile (storage state) to restore. */
  readonly authProfile?: string
}

/** The outcome of a navigation. */
export interface BrowserNavigateResult {
  /** The final URL after redirects. */
  readonly url: string
  /** The document title, when the page exposes one. */
  readonly title?: string
}

/** Options for a page snapshot. */
export interface BrowserSnapshotOptions {
  /** Upper bound on the visible-text length; the provider truncates and flags it. */
  readonly maxTextLength?: number
  /** Upper bound on the number of interactive elements returned. */
  readonly maxElements?: number
}

/** One interactive element surfaced in a snapshot, addressable by its `ref`. */
export interface BrowserElement {
  /** Stable per-snapshot handle (e.g. `@e1`) for click/type. */
  readonly ref: string
  /** The ARIA role (link, button, textbox, checkbox, ...). */
  readonly role: string
  /** The accessible name (link text, button label, input placeholder/label). */
  readonly name: string
  /** The lower-cased tag name (a, button, input, ...). */
  readonly tag: string
  /** The href, for links. */
  readonly href?: string
  /** The URL of the child frame containing the element (omitted for the main frame). */
  readonly frame?: string
}

/** A normalized view of the current page for a model to reason over. */
export interface BrowserSnapshot {
  /** The current page URL. */
  readonly url: string
  /** The document title. */
  readonly title: string
  /** Interactive elements (main frame first, then child frames in DOM order). */
  readonly elements: readonly BrowserElement[]
  /** The visible page text, truncated to `maxTextLength`. */
  readonly text: string
  /** True when the provider cut `text` or `elements` to honor the bounds. */
  readonly truncated: boolean
}

/** Where a click/type targets. Exactly one of `ref` or `selector` is set. */
export type BrowserTarget =
  | { readonly kind: 'ref'; readonly ref: string }
  | { readonly kind: 'selector'; readonly selector: string }

/** Options for a screenshot. */
export interface BrowserScreenshotOptions {
  /** Capture the full scrollable page, not just the viewport. */
  readonly fullPage?: boolean
  /** Capture a single element (CSS selector) instead of the page. */
  readonly selector?: string
}

/** A captured screenshot (PNG bytes). */
export interface BrowserScreenshot {
  readonly buffer: Buffer
  readonly mimeType: 'image/png'
}

/**
 * A live browser session (single-page: one page is active at a time).
 * Every method honors `signal` for cancellation (except `close`).
 */
export interface BrowserSession {
  /** The provider that opened this session. */
  readonly providerId: string
  /** The current page URL (`about:blank` before the first navigation). */
  url(): string
  /** Navigate the active page to `url` and wait for load (SSRF-checked, incl. final URL). */
  navigate(url: string, signal?: AbortSignal): Promise<BrowserNavigateResult>
  /** Capture a normalized snapshot of the current page. */
  snapshot(options?: BrowserSnapshotOptions, signal?: AbortSignal): Promise<BrowserSnapshot>
  /** Click the element addressed by `target`. */
  click(target: BrowserTarget, signal?: AbortSignal): Promise<void>
  /** Type `text` into the element addressed by `target` (replacing its value). */
  type(target: BrowserTarget, text: string, signal?: AbortSignal): Promise<void>
  /** Evaluate JavaScript in the page context and return the JSON-serializable result. */
  evaluate(expression: string, signal?: AbortSignal): Promise<unknown>
  /** Capture a PNG screenshot of the page (or one element). */
  screenshot(options?: BrowserScreenshotOptions, signal?: AbortSignal): Promise<BrowserScreenshot>
  /** Close the session and release the browser. Idempotent. */
  close(): Promise<void>
}
