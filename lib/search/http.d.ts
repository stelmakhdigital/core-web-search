/**
 * Shared HTTP helpers for the search engines and enrichment: error
 * classification against a deadline signal and capped body reads.
 * @module @agents-web-search/core/search/http
 */
import { CoreError } from '../errors.ts';
import type { SearchSource } from '../types.ts';
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
export declare function classifyWebError(error: unknown, signal: AbortSignal, context: string): CoreError;
/**
 * Read a response body as UTF-8 text up to a byte cap. A declared
 * `Content-Length` over the cap rejects immediately; a stream that grows past
 * the cap is cut short.
 * @param response - the response to read.
 * @param maxBytes - the byte cap.
 * @returns the decoded text.
 */
export declare function readCappedText(response: Response, maxBytes: number): Promise<string>;
/**
 * A default status → error mapping for the keyless SERP engines: a
 * block/challenge status is a provider failure with a slow-down hint; any
 * other non-OK status is a generic provider failure.
 * @param engineLabel - human-readable engine name for the messages.
 * @returns the mapping used by `HttpSearchClient.fetchText`.
 */
export declare function serpStatusErrors(engineLabel: string): (status: number) => CoreError;
/**
 * A default status → error mapping for the API (keyed) engines: auth
 * failures are `WEB_AUTH`, quota/rate-limit failures are `WEB_QUOTA`, and
 * anything else is a generic provider failure.
 * @param engineLabel - human-readable engine name for the messages.
 * @param quotaStatuses - extra statuses treated as quota (e.g. Jina's 402).
 * @returns the mapping used by `HttpSearchClient.fetchText`.
 */
export declare function apiStatusErrors(engineLabel: string, quotaStatuses?: readonly number[]): (status: number) => CoreError;
/**
 * True when the URL's hostname matches a blocked domain (suffix match,
 * leading dots tolerated). An unparseable URL counts as blocked.
 */
export declare function isBlockedDomain(url: string, blockedDomains: readonly string[]): boolean;
/** One raw engine result row (pre-`SearchSource`). */
export interface RawSearchResult {
    url?: string;
    title?: string;
    snippet?: string;
}
/**
 * Drop blocked domains and duplicate URLs (first occurrence wins), and map
 * the raw rows to `SearchSource` (empty titles/snippets omitted).
 */
export declare function dedupeSources(results: readonly RawSearchResult[], blockedDomains: readonly string[]): SearchSource[];
/** One HTTP text request run by `HttpSearchClient`. */
export interface HttpTextRequest {
    /** Absolute request URL. */
    url: string;
    /** HTTP method (default GET). */
    method?: 'GET' | 'POST';
    /** Extra headers; `user-agent` is merged in from the client options. */
    headers?: Record<string, string>;
    /** Request body (POST). */
    body?: string;
    /** The caller's deadline signal (classification backstop). */
    signal: AbortSignal;
    /** Hard cap on the response body (bytes). */
    maxBytes: number;
    /** Human-readable failure context, e.g. `SearXNG search request`. */
    context: string;
    /**
     * Fast-fail guard for the connect phase: if the response headers have not
     * arrived within this many milliseconds, the request is aborted. A closed
     * port fails on its own (ECONNREFUSED is immediate); this covers hosts
     * that silently drop connects. The timer is cleared once the headers
     * arrive, so a slow body is never cut by it — only the caller's deadline
     * signal applies from there.
     */
    connectTimeoutMs?: number;
    /** Status → error mapping for non-OK responses. */
    mapStatus?: (status: number) => CoreError;
}
/** Options for the shared HTTP search client. */
export interface HttpSearchClientOptions {
    /** `User-Agent` header sent on every request. */
    userAgent: string;
    /**
     * Search-request rate limit (requests per second). Omit for the keyed API
     * engines (no local politeness delay; the provider enforces its own
     * quota).
     */
    rateLimitPerSec?: number;
}
/**
 * The shared HTTP layer of the search engines: rate limiting, the
 * fetch + classify + capped-read boilerplate, and status mapping. One
 * instance per engine (the limiter is per-engine state).
 */
export declare class HttpSearchClient {
    private readonly options;
    private readonly limiter;
    constructor(options: HttpSearchClientOptions);
    /**
     * Run one request to a text (SERP HTML / JSON API) response.
     * Transport and status failures surface as `CoreError`; the returned text
     * is capped at `maxBytes`.
     */
    fetchText(request: HttpTextRequest): Promise<string>;
}
/** True for a positive whole number (config sanity). */
export declare function isPositiveInteger(value: number): boolean;
/** True for a positive finite number (config sanity). */
export declare function isPositiveFinite(value: number): boolean;
