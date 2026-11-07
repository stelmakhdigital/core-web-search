/**
 * `MultiSearchProvider`: a `SearchProviderLike` that routes one search across
 * multiple engines (keyless HTML engines, API engines) with fallback or
 * RRF-fusion semantics, per-engine failure cooldowns, a persistent search
 * cache (web store), and local BM25 enrichment of the top candidates.
 *
 * The model-facing surface stays the standard `web_search` tool: the engine
 * mix, order, and mode are deployment/user configuration, not model choices.
 * @module @agents-web-search/core/search/provider
 */
import type { SearchRequest, SearchResult, SearchSource } from '../types.ts';
import type { WebStore } from '../store/index.ts';
import { type EnrichOptions } from './enrich.ts';
import type { SearchEngine } from './engines/types.ts';
/** Stable id this provider registers under. */
export declare const MULTI_SEARCH_PROVIDER_ID = "multi";
/** Provider options (built by the plugin's `apply`). */
export interface MultiSearchProviderOptions {
    /** Ordered engine ids to consider (already filtered to built engines). */
    engines: readonly string[];
    /** Forced single engine id; an error when unavailable. */
    forcedEngine?: string;
    /** 'fallback' = first success wins; 'fuse' = parallel + RRF merge. */
    mode: 'fallback' | 'fuse';
    /** Default result count when a request carries none. */
    defaultMaxResults: number;
    /** The shared web store (search cache + history + page cache). */
    store: WebStore;
    /** Engine instances keyed by id. */
    engineById: ReadonlyMap<string, SearchEngine>;
    /** Enrich top results with fetched page text + BM25 re-rank. */
    enrich: boolean;
    /** How many top candidates to fetch for enrichment. */
    enrichFetchLimit: number;
    /** How many enriched sources to keep. */
    enrichKeep: number;
    /** Search cache TTL (ms). */
    searchCacheTtlMs: number;
    /** Page cache TTL (ms). */
    pageCacheTtlMs: number;
    /** Overall search timeout (ms). */
    timeoutMs: number;
    /** Cooldown base (ms). */
    cooldownBaseMs: number;
    /** Cooldown cap (ms). */
    cooldownMaxMs: number;
    /** Enrichment options (page fetches). */
    enrichOptions: Omit<EnrichOptions, 'store'>;
    /** Optional structured logger (observability). When set, search operations are logged. */
    logger?: {
        info: (message: string, ...meta: unknown[]) => void;
    };
}
/** The multi-engine search provider. */
export declare class MultiSearchProvider {
    private readonly options;
    readonly id = "multi";
    private readonly cooldown;
    constructor(options: MultiSearchProviderOptions);
    /** At least one built engine must be available. */
    available(): boolean;
    /** Run one search: cache check, routing, enrichment, history. */
    search(request: SearchRequest, signal?: AbortSignal): Promise<SearchResult>;
    /** Resolve the engine list: forced engine, or ordered list minus unavailable/cooldown. */
    private selectEngines;
    /** Per-engine routing diagnostics (config chain first, then extra built engines). */
    diagnostics(): readonly EngineDiagnostics[];
    /** Sequential fallback: the first engine returning results wins. */
    private fallback;
    /** Parallel fuse: all engines run; successes merge via RRF. */
    private fuse;
}
/** One engine's routing diagnostics (for `web_search_stats` and hosts). */
export interface EngineDiagnostics {
    /** Stable engine id. */
    readonly id: string;
    /** Cheap local availability (`SearchEngine.available()`). */
    readonly available: boolean;
    /** In the routing list (config `search.engines`). */
    readonly inChain: boolean;
    /** Currently cooling down after failures. */
    readonly coolingDown: boolean;
    /** Remaining cooldown (ms; 0 when idle). */
    readonly remainingMs: number;
    /** Consecutive failures (0 after a success). */
    readonly consecutiveFailures: number;
}
/**
 * Build the search cache key from the normalized query, engine list, and
 * mode. @param query - the trimmed query.
 * @param engines - the ordered engine list.
 * @param mode - the routing mode.
 * @returns the cache key.
 */
export declare function searchCacheKey(query: string, engines: readonly string[], mode: string): string;
/** Drop duplicate URLs across the merged list (first occurrence wins). */
export declare function filterAndDedupe(sources: readonly SearchSource[]): SearchSource[];
