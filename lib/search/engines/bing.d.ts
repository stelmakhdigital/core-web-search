/**
 * `BingEngine`: a keyless search engine backed by the Bing HTML SERP.
 * Server-rendered results parsed with cheerio; a consent/challenge page is a
 * provider failure (the router cools the engine down and falls through).
 * @module @agents-web-search/core/search/engines/bing
 */
import type { EngineSearchResult, SearchEngine } from './types.ts';
/** Engine options. */
export interface BingEngineOptions {
    /** SERP endpoint (absolute URL). */
    endpoint: string;
    /** Region/market hint (`setmkt` parameter, e.g. `en-US`); empty allowed. */
    market: string;
    /** `User-Agent` header sent on every request. */
    userAgent: string;
    /** Search-request rate limit (requests per second). */
    rateLimitPerSec: number;
    /** Hard cap on one SERP body (bytes). */
    maxSerpBytes: number;
    /** Domains (suffix match) excluded from results. */
    blockedDomains: readonly string[];
    /**
     * Freshness filter (news mode). Maps to Bing's `qft` parameter:
     * `24h` → past day, `week` → past week, `month` → past month, `year` → past year.
     * Empty string disables the filter.
     */
    freshness?: string;
}
/** Default Bing SERP endpoint. */
export declare const BING_DEFAULT_ENDPOINT = "https://www.bing.com/search";
/** The keyless Bing HTML search engine. */
export declare class BingEngine implements SearchEngine {
    private readonly options;
    readonly id = "bing";
    private readonly http;
    constructor(options: BingEngineOptions);
    /** Cheap local check: the endpoint must parse as an absolute URL. No network. */
    available(): boolean;
    /** Fetch and parse one SERP. */
    search(query: string, maxResults: number, signal: AbortSignal): Promise<EngineSearchResult>;
    private serpUrl;
    /** Map the freshness setting to Bing's `qft` filter value. */
    private freshnessQft;
    /** Fetch the SERP document; block-like failures surface as `CoreError`. */
    private fetchSerp;
    /** Drop blocked domains and duplicate URLs (first occurrence wins). */
    private filterAndDedupe;
}
