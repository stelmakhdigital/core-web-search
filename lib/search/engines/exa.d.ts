/**
 * `ExaEngine`: the Exa search API as a core engine (native HTTP client —
 * the core must not depend on host packages, ADR-002/Q9). The API key is
 * resolved per search through the engine's secret resolver, so a key written
 * to the host credentials domain takes effect without a restart.
 *
 * `available()` reports *potentially* available: true when a static key is
 * present OR a resolver is set (the resolver may yield a key at search time).
 * A search issued without any key fails with `WEB_AUTH`, which the router's
 * cooldown handles — the engine is not silently skipped.
 * @module @agents-web-search/core/search/engines/exa
 */
import type { EngineSearchResult, SearchEngine, SearchEngineDeps } from './types.ts';
/** Default Exa API base ( `/search` is appended). */
export declare const EXA_DEFAULT_BASE_URL = "https://api.exa.ai";
/** Engine options. */
export interface ExaEngineOptions extends SearchEngineDeps {
    /** Explicit API key (lowest precedence; the resolver wins when it yields a value). */
    readonly apiKey?: string;
    /** Endpoint base; `/search` is appended. */
    readonly baseUrl?: string;
    /** Retrieval mode sent as Exa's `type`. */
    readonly searchType?: 'auto' | 'keyword' | 'neural';
    /** Highlight sentences requested per result. */
    readonly highlightsPerResult?: number;
}
/** The Exa API search engine. */
export declare class ExaEngine implements SearchEngine {
    readonly id = "exa";
    private readonly options;
    private readonly http;
    private cachedKey;
    constructor(options: ExaEngineOptions);
    /** Available when a key is present (static, or a resolver that may yield one). */
    available(): boolean;
    /** Run one Exa search (key resolved per search when a resolver is set). */
    search(query: string, maxResults: number, signal: AbortSignal): Promise<EngineSearchResult>;
    /** Drop entries without a usable URL and duplicate URLs (first occurrence wins). */
    private filterAndDedupe;
}
