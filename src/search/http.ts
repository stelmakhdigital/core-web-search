/**
 * Shared HTTP helpers for the search engines and enrichment: error
 * classification against a deadline signal and capped body reads.
 * @module @agents-web-search/core/search/http
 */

import { CoreError } from '../errors.ts'
import { timeoutOf } from '../timeout.ts'
import { RateLimiter } from './rate-limit.ts'
import { normalizeUrl } from './url.ts'
import type { SearchSource } from '../types.ts'

/**
 * Translate a thrown fetch error into a `CoreError`, classified by the
 * deadline signal: our backstop timeout wins (`WEB_SEARCH_TIMEOUT`), any
 * other abort is `WEB_ABORTED`, and a throw with the signal not aborted is a
 * network failure (`WEB_PROVIDER_ERROR`).
 * @param error - the thrown value.
 * @param signal - the deadline signal the request ran under.
 * @param context - a human-readable failure context (engine name, phase).
 * @returns the classified `CoreError`.
 */
export function classifyWebError(error: unknown, signal: AbortSignal, context: string): CoreError {
  const timeout = timeoutOf(signal, 'WEB_SEARCH_TIMEOUT')
  if (timeout !== undefined) return new CoreError('web search timed out', 'WEB_SEARCH_TIMEOUT', { cause: timeout })
  if (signal.aborted) return new CoreError('web search aborted', 'WEB_ABORTED', { cause: error })
  return new CoreError(`${context}: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
}

/**
 * Read a response body as UTF-8 text up to a byte cap. A declared
 * `Content-Length` over the cap rejects immediately; a stream that grows past
 * the cap is cut short.
 * @param response - the response to read.
 * @param maxBytes - the byte cap.
 * @returns the decoded text.
 */
export async function readCappedText(response: Response, maxBytes: number): Promise<string> {
  const declared = response.headers.get('content-length')
  if (declared !== null) {
    const length = Number(declared)
    if (Number.isFinite(length) && length > maxBytes) throw new Error(`body exceeds ${maxBytes} bytes`)
  }
  /* v8 ignore next -- a 2xx Response from fetch always exposes a body stream; the null guard is defensive. */
  if (response.body === null) return ''
  const chunks: Uint8Array[] = []
  let total = 0
  const reader = response.body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const remaining = maxBytes - total
      if (value.byteLength > remaining) {
        chunks.push(value.subarray(0, Math.max(0, remaining)))
        total += Math.max(0, remaining)
        break
      }
      chunks.push(value)
      total += value.byteLength
    }
  } finally {
    /* v8 ignore next 4 -- cancel() after a completed/broken read settles without rejecting; unobserved best-effort cleanup. */
    await reader.cancel().catch(() => {
      /* best-effort cleanup after a completed or broken read */
    })
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder('utf-8').decode(bytes)
}

/**
 * A default status → error mapping for the keyless SERP engines: a
 * block/challenge status is a provider failure with a slow-down hint; any
 * other non-OK status is a generic provider failure.
 * @param engineLabel - human-readable engine name for the messages.
 * @returns the mapping used by `HttpSearchClient.fetchText`.
 */
export function serpStatusErrors(engineLabel: string): (status: number) => CoreError {
  return (status: number) => {
    if (status === 403 || status === 429 || status === 503) {
      return new CoreError(
        `${engineLabel} blocked the search request (HTTP ${status}); slow down or try again later`,
        'WEB_PROVIDER_ERROR',
      )
    }
    return new CoreError(`${engineLabel} search request failed (HTTP ${status})`, 'WEB_PROVIDER_ERROR')
  }
}

/**
 * A default status → error mapping for the API (keyed) engines: auth
 * failures are `WEB_AUTH`, quota/rate-limit failures are `WEB_QUOTA`, and
 * anything else is a generic provider failure.
 * @param engineLabel - human-readable engine name for the messages.
 * @param quotaStatuses - extra statuses treated as quota (e.g. Jina's 402).
 * @returns the mapping used by `HttpSearchClient.fetchText`.
 */
export function apiStatusErrors(engineLabel: string, quotaStatuses: readonly number[] = []): (status: number) => CoreError {
  return (status: number) => {
    if (status === 401 || status === 403) {
      return new CoreError(`${engineLabel} rejected the API key (HTTP ${status})`, 'WEB_AUTH')
    }
    if (status === 429 || quotaStatuses.includes(status)) {
      return new CoreError(`${engineLabel} rate limit exceeded (HTTP ${status})`, 'WEB_QUOTA')
    }
    return new CoreError(`${engineLabel} search request failed (HTTP ${status})`, 'WEB_PROVIDER_ERROR')
  }
}

/**
 * True when the URL's hostname matches a blocked domain (suffix match,
 * leading dots tolerated). An unparseable URL counts as blocked.
 */
export function isBlockedDomain(url: string, blockedDomains: readonly string[]): boolean {
  if (blockedDomains.length === 0) return false
  let hostname: string
  try {
    hostname = new URL(url).hostname.toLowerCase()
  } catch {
    return true
  }
  return blockedDomains.some((domain) => {
    const normalized = domain.toLowerCase().replace(/^\./, '')
    return hostname === normalized || hostname.endsWith(`.${normalized}`)
  })
}

/** One raw engine result row (pre-`SearchSource`). */
export interface RawSearchResult {
  url?: string
  title?: string
  snippet?: string
}

/**
 * Drop blocked domains and duplicate URLs (first occurrence wins), and map
 * the raw rows to `SearchSource` (empty titles/snippets omitted).
 */
export function dedupeSources(results: readonly RawSearchResult[], blockedDomains: readonly string[]): SearchSource[] {
  const seen = new Set<string>()
  const sources: SearchSource[] = []
  for (const result of results) {
    if (result.url === undefined || result.url.length === 0) continue
    const key = normalizeUrl(result.url)
    if (seen.has(key)) continue
    if (isBlockedDomain(result.url, blockedDomains)) continue
    seen.add(key)
    sources.push({
      url: result.url,
      ...result.title !== undefined && result.title.length > 0 ? { title: result.title } : {},
      ...result.snippet !== undefined && result.snippet.length > 0 ? { snippet: result.snippet } : {},
    })
  }
  return sources
}

/** One HTTP text request run by `HttpSearchClient`. */
export interface HttpTextRequest {
  /** Absolute request URL. */
  url: string
  /** HTTP method (default GET). */
  method?: 'GET' | 'POST'
  /** Extra headers; `user-agent` is merged in from the client options. */
  headers?: Record<string, string>
  /** Request body (POST). */
  body?: string
  /** The caller's deadline signal (classification backstop). */
  signal: AbortSignal
  /** Hard cap on the response body (bytes). */
  maxBytes: number
  /** Human-readable failure context, e.g. `SearXNG search request`. */
  context: string
  /**
   * Fast-fail guard for the connect phase: if the response headers have not
   * arrived within this many milliseconds, the request is aborted. A closed
   * port fails on its own (ECONNREFUSED is immediate); this covers hosts
   * that silently drop connects. The timer is cleared once the headers
   * arrive, so a slow body is never cut by it — only the caller's deadline
   * signal applies from there.
   */
  connectTimeoutMs?: number
  /** Status → error mapping for non-OK responses. */
  mapStatus?: (status: number) => CoreError
}

/** Options for the shared HTTP search client. */
export interface HttpSearchClientOptions {
  /** `User-Agent` header sent on every request. */
  userAgent: string
  /**
   * Search-request rate limit (requests per second). Omit for the keyed API
   * engines (no local politeness delay; the provider enforces its own
   * quota).
   */
  rateLimitPerSec?: number
}

/**
 * The shared HTTP layer of the search engines: rate limiting, the
 * fetch + classify + capped-read boilerplate, and status mapping. One
 * instance per engine (the limiter is per-engine state).
 */
export class HttpSearchClient {
  private readonly limiter: RateLimiter | undefined

  constructor(private readonly options: HttpSearchClientOptions) {
    this.limiter = options.rateLimitPerSec !== undefined
      ? new RateLimiter({ perSec: options.rateLimitPerSec })
      : undefined
  }

  /**
   * Run one request to a text (SERP HTML / JSON API) response.
   * Transport and status failures surface as `CoreError`; the returned text
   * is capped at `maxBytes`.
   */
  async fetchText(request: HttpTextRequest): Promise<string> {
    if (this.limiter !== undefined) await this.limiter.acquire(request.signal)
    // Forward the caller's aborts into the private controller (it carries the
    // connect timer too); the listener stays attached until the body is read,
    // so the deadline signal keeps applying to the body stream.
    const controller = new AbortController()
    const onAbort = () => controller.abort()
    request.signal.addEventListener('abort', onAbort, { once: true })
    const connectTimer = request.connectTimeoutMs !== undefined
      ? setTimeout(
          () => controller.abort(new DOMException(`${request.context}: connect timed out`, 'TimeoutError')),
          request.connectTimeoutMs,
        )
      : undefined
    let response: Response
    try {
      response = await fetch(request.url, {
        method: request.method ?? 'GET',
        redirect: 'follow',
        headers: { 'user-agent': this.options.userAgent, ...request.headers },
        ...(request.body !== undefined ? { body: request.body } : {}),
        signal: controller.signal,
      })
    } catch (error: unknown) {
      throw classifyWebError(error, request.signal, `${request.context} failed`)
    } finally {
      if (connectTimer !== undefined) clearTimeout(connectTimer)
    }
    if (!response.ok) {
      await response.body?.cancel()
      const mapped = request.mapStatus?.(response.status)
      if (mapped !== undefined) throw mapped
      throw new CoreError(`${request.context} failed (HTTP ${response.status})`, 'WEB_PROVIDER_ERROR')
    }
    try {
      return await readCappedText(response, request.maxBytes)
    } catch (error: unknown) {
      throw classifyWebError(error, request.signal, `${request.context} body read failed`)
    } finally {
      request.signal.removeEventListener('abort', onAbort)
    }
  }
}

/** True for a positive whole number (config sanity). */
export function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

/** True for a positive finite number (config sanity). */
export function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0
}
