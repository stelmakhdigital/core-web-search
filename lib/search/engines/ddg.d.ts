/**
 * `DuckDuckGoEngine`: a keyless search engine backed by the DuckDuckGo HTML
 * endpoint. It parses the server-rendered SERP, decodes the `uddg` redirect
 * wrapper, and filters blocked domains. No credentials, no cloud account.
 * @module @agents-web-search/core/search/engines/ddg
 */
import type { EngineSearchResult, SearchEngine } from './types.ts';
/** Engine options. */
export interface DuckDuckGoEngineOptions {
    /** SERP endpoint (absolute URL). */
    endpoint: string;
    /** Region hint (`kl` parameter); empty allowed. */
    region: string;
    /** `User-Agent` header sent on every request. */
    userAgent: string;
    /** Search-request rate limit (requests per second). */
    rateLimitPerSec: number;
    /** Hard cap on one SERP body (bytes). */
    maxSerpBytes: number;
    /** Domains (suffix match) excluded from results. */
    blockedDomains: readonly string[];
}
/** Default DuckDuckGo HTML SERP endpoint. */
export declare const DUCKDUCKGO_DEFAULT_ENDPOINT = "https://html.duckduckgo.com/html/";
/** The keyless DuckDuckGo HTML search engine. */
export declare class DuckDuckGoEngine implements SearchEngine {
    private readonly options;
    readonly id = "ddg";
    private readonly http;
    constructor(options: DuckDuckGoEngineOptions);
    /** Cheap local check: the endpoint must parse as an absolute URL. No network. */
    available(): boolean;
    /** Fetch and parse one SERP. */
    search(query: string, maxResults: number, signal: AbortSignal): Promise<EngineSearchResult>;
    private endpoint;
    private serpUrl;
    /** Fetch the SERP document; block-like failures surface as `CoreError`. */
    private fetchSerp;
    /** Drop blocked domains and duplicate URLs (first occurrence wins). */
    private filterAndDedupe;
}
