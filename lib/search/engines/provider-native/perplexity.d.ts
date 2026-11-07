/**
 * `PerplexityEngine`: Perplexity search as a synthesis engine (provider-native
 * family: returns a generated answer + citations; ADR-004). Client-side
 * 10-requests/minute guard (parity with pi-web-access policy).
 * @module @agents-web-search/core/search/engines/provider-native/perplexity
 */
import type { EngineSearchResult, SearchEngine, SearchEngineDeps } from '../types.ts';
/** Default Perplexity endpoint base. */
export declare const PERPLEXITY_DEFAULT_BASE_URL = "https://api.perplexity.ai";
/** Default model. */
export declare const PERPLEXITY_DEFAULT_MODEL = "sonar";
/** Engine options. */
export interface PerplexityEngineOptions extends SearchEngineDeps {
    readonly apiKey?: string;
    readonly baseUrl?: string;
    readonly model?: string;
}
/** The Perplexity synthesis search engine. */
export declare class PerplexityEngine implements SearchEngine {
    readonly id = "perplexity";
    private readonly options;
    private cachedKey;
    /** Timestamps of the last requests (10/min guard). */
    private readonly recentRequests;
    constructor(options: PerplexityEngineOptions);
    available(): boolean;
    /** Enforce the 10-requests/minute client-side budget. */
    private guardRateLimit;
    search(query: string, maxResults: number, signal: AbortSignal): Promise<EngineSearchResult>;
}
