/**
 * `CoreError`: the single error type of the web-search core. Codes are stable
 * product-level identifiers; host adapters map them to host error semantics
 * (DSH: `CoreError` codes — names are deliberately aligned; Pi: thrown `Error`
 * with `isError` tool results).
 *
 * The core NEVER puts secrets into error messages (see ADR-005 §5).
 * @module @agents-web-search/core/errors
 */

/** Stable error codes (superset of the DSH web seam vocabulary for 1:1 mapping). */
export type CoreErrorCode =
  /** SSRF guard blocked the target (loopback/private/link-local/reserved). */
  | 'WEB_SSRF_BLOCKED'
  /** A deadline (backstop timeout) elapsed; carries {@link import('./timeout.ts').TimeoutReason}. */
  | 'WEB_SEARCH_TIMEOUT'
  | 'WEB_FETCH_TIMEOUT'
  /** A page-level deadline elapsed (enrichment/page load). */
  | 'WEB_PAGE_TIMEOUT'
  /** The caller aborted the operation. */
  | 'WEB_ABORTED'
  /** Transport failure (DNS, connection reset, TLS, ...). */
  | 'WEB_PROVIDER_ERROR'
  /** Transport failure classified at the network layer (unreachable host, ECONNREFUSED, ...). */
  | 'WEB_NETWORK'
  /** An HTTP response indicated a provider-side block or failure. */
  | 'WEB_HTTP_ERROR'
  /** Bad arguments or bad configuration. */
  | 'WEB_BAD_REQUEST'
  /** The request URL is invalid (not http(s), too long, unparseable). */
  | 'WEB_INVALID_URL'
  /** A URL was blocked by policy (non-fetchable scheme, scheme mismatch). */
  | 'WEB_BLOCKED_URL'
  /** A response could not be parsed into results. */
  | 'WEB_PARSE_ERROR'
  /** Missing or rejected credentials (401/403). */
  | 'WEB_AUTH'
  /** Quota/rate limit exhausted (402/429). */
  | 'WEB_QUOTA'
  /** The endpoint or feature is not supported by this provider (404/405/501 on search paths). */
  | 'WEB_UNSUPPORTED'
  /** An engine is blocked/cooling down or returned a bot challenge. */
  | 'WEB_BLOCKED'
  /** No engine is available for the request. */
  | 'WEB_NO_ENGINE'
  /** The engine is enabled but not usable (missing key/endpoint/package). */
  | 'WEB_ENGINE_UNAVAILABLE'
  /** The engine is not available (host has not provided what it needs). */
  | 'WEB_NOT_AVAILABLE'
  /** A sensitive operation was denied (no host approval, or user declined). */
  | 'WEB_APPROVAL_DENIED'
  /** Redirect policy violation (cap exceeded, cross-origin, invalid Location). */
  | 'WEB_REDIRECT_BLOCKED'
  /** The response body exceeded the configured byte cap. */
  | 'WEB_FETCH_TOO_LARGE'
  /** The content type is not representable (unsupported). */
  | 'WEB_UNSUPPORTED_CONTENT_TYPE'

  /** Browser family: the browser module or its backend is unavailable (playwright missing, no executable). */
  | 'BROWSER_UNAVAILABLE'
  /** The browser session is closed (action on a closed session). */
  | 'BROWSER_NOT_OPEN'
  /** A session already exists for the key (or the tab cap is reached). */
  | 'BROWSER_ALREADY_OPEN'
  /** The navigation URL is invalid (not http(s), unparseable). */
  | 'BROWSER_INVALID_URL'
  /** A browser action failed in the backend. */
  | 'BROWSER_ACTION_FAILED'
  /** A browser action exceeded its deadline. */
  | 'BROWSER_TIMEOUT'
  /** A browser action was aborted by the caller. */
  | 'BROWSER_ABORTED'
  /** A sensitive browser action was denied by the approver (or no approver exists — fail-closed). */
  | 'BROWSER_APPROVAL_DENIED'
  /** A sensitive browser action requires approval but the host provides none (fail-closed). */
  | 'BROWSER_APPROVAL_UNAVAILABLE'
  /** The requested auth profile is not configured. */
  | 'BROWSER_AUTH_MISSING'
  /** The SSRF guard blocked a navigation target (literal or post-redirect). */
  | 'BROWSER_SSRF_BLOCKED'

  /** An internal, unclassified failure. */
  | 'WEB_INTERNAL'

/** The single core error type. */
export class CoreError extends Error {
  /** The stable code (host adapters key off this, not the message). */
  readonly code: CoreErrorCode
  /** The original cause (when this error translates another error). */
  override readonly cause?: unknown

  constructor(message: string, code: CoreErrorCode, options?: { cause?: unknown }) {
    super(message, { cause: options?.cause })
    this.name = 'CoreError'
    this.code = code
    this.cause = options?.cause
  }
}

/** True when the value is a {@link CoreError}. */
export function isCoreError(error: unknown): error is CoreError {
  return error instanceof CoreError
}

/**
 * Translate any thrown value into a {@link CoreError}. A `CoreError` passes
 * through unchanged; anything else becomes the given code with the original
 * value as `cause`.
 */
export function toCoreError(error: unknown, message: string, code: CoreErrorCode): CoreError {
  if (isCoreError(error)) return error
  return new CoreError(message, code, { cause: error })
}

/** A short human-readable message for a thrown value (logs/diagnostics only). */
export function errorMessage(error: unknown): string {
  if (isCoreError(error)) return error.message
  return String(error)
}

/** Extract the code of any thrown value (`WEB_INTERNAL` for unknowns). */
export function errorCodeOf(error: unknown): CoreErrorCode {
  return isCoreError(error) ? error.code : 'WEB_INTERNAL'
}
