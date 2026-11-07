/**
 * `JinaEngine`: a search engine backed by the Jina search API
 * (`https://s.jina.ai/{query}`). Requires a Jina API key, resolved from the
 * config override or the launch environment at plugin `apply` time and
 * re-resolved per search when a resolver is set (the credentials domain, so
 * a key written there takes effect without a restart).
 *
 * `available()` reports *potentially* available: true when a static key is
 * present OR a resolver is set (the resolver may yield a key at search time).
 * A search issued without any key fails with a provider error, which the
 * router's cooldown handles — the engine is not silently skipped.
 * @module @agents-web-search/core/search/engines/jina
 */
import type { EngineSearchResult, SearchEngine, SearchEngineDeps } from './types.ts';
/** Engine options. */
export interface JinaEngineOptions extends SearchEngineDeps {
    /** Resolved Jina API key (empty is fine when the resolver may yield one). */
    readonly apiKey?: string;
    /** Endpoint base; the query path is appended. */
    readonly baseURL?: string;
    /** Hard cap on one response body (bytes). */
    readonly maxResponseBytes: number;
}
/** Default Jina search endpoint base. */
export declare const JINA_DEFAULT_BASE_URL = "https://s.jina.ai";
/** The Jina API search engine. */
export declare class JinaEngine implements SearchEngine {
    private readonly options;
    readonly id = "jina";
    private readonly http;
    constructor(options: JinaEngineOptions);
    /** Available when a key is present (static, or a resolver that may yield one). */
    available(): boolean;
    /** Run one search against the Jina API. */
    search(query: string, maxResults: number, signal: AbortSignal): Promise<EngineSearchResult>;
}
