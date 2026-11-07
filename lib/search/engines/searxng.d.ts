/**
 * `SearXNGEngine`: a self-hosted metasearch engine backed by a SearXNG
 * instance's JSON API. SearXNG aggregates multiple search engines (Google,
 * Bing, DuckDuckGo, etc.) behind a single local endpoint, so the plugin gets
 * multi-engine results without calling any external API or data broker.
 *
 * The JSON API must be enabled on the SearXNG instance (`search.formats:
 * [html, json]` in `settings.yml`). The engine queries
 * `{endpoint}/search?q=...&format=json` and maps the results to
 * `SearchSource`.
 *
 * Fast fail: a closed port fails on its own (ECONNREFUSED surfaces
 * immediately — the engine adds no retry or wait); for hosts that silently
 * drop connects the request carries a short connect-phase guard
 * (`connectTimeoutMs`) on top of the caller's deadline.
 * @module @agents-web-search/core/search/engines/searxng
 */
import type { EngineSearchResult, SearchEngine } from './types.ts';
/** Engine options. */
export interface SearXNGEngineOptions {
    /** SearXNG instance base URL (e.g., `http://localhost:8080`). */
    endpoint: string;
    /** `User-Agent` header sent on every request. */
    userAgent: string;
    /** Search-request rate limit (requests per second). */
    rateLimitPerSec: number;
    /** Hard cap on one response body (bytes). */
    maxSerpBytes: number;
    /** Domains (suffix match) excluded from results. */
    blockedDomains: readonly string[];
    /**
     * Connect-phase fast-fail guard (ms): abort the request when the response
     * headers have not arrived within this budget. Default 3s; 0 disables.
     */
    connectTimeoutMs?: number;
}
/** Default SearXNG endpoint (local instance). */
export declare const SEARXNG_DEFAULT_ENDPOINT = "http://localhost:8080";
/** Default connect-phase fast-fail guard (ms). */
export declare const SEARXNG_CONNECT_TIMEOUT_MS = 3000;
/** The self-hosted SearXNG metasearch engine. */
export declare class SearXNGEngine implements SearchEngine {
    private readonly options;
    readonly id = "searxng";
    private readonly http;
    constructor(options: SearXNGEngineOptions);
    /** Cheap local check: the endpoint must parse as an absolute URL. No network. */
    available(): boolean;
    /** Query the SearXNG JSON API and map the results. */
    search(query: string, maxResults: number, signal: AbortSignal): Promise<EngineSearchResult>;
    private endpoint;
    private searchUrl;
    /** Fetch and parse one SearXNG JSON response. */
    private fetchJson;
    /** Drop blocked domains and duplicate URLs (first occurrence wins). */
    private filterAndDedupe;
}
