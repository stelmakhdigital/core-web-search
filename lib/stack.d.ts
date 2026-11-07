/**
 * `createWebStack`: the core's top-level factory (ADR-003). Wires the
 * resolved host config into the full web stack — search (14 engines,
 * router, cache, enrichment), fetch (SSRF-guarded cached HTTP), platform
 * search (registry + rule packs), the shared web store — and exposes the
 * model-facing tools as `ToolSpec`s.
 *
 * The host adapter (ADR-002) is the only host dependency: config, state
 * paths, credential resolution, tool registration, error mapping.
 * @module @agents-web-search/core/stack
 */
import { type ResolvedCoreConfig } from './config.ts';
import { MULTI_SEARCH_PROVIDER_ID, searchCacheKey } from './search/provider.ts';
import { WebStore } from './store/index.ts';
import { type BrowserManager } from './browser/manager.ts';
import type { FetchRequest, FetchResult, HostAdapter, PlatformSearchRequest, SearchRequest, SearchResult, ToolSpec } from './types.ts';
import type { PlatformSearchResult } from './platforms/types.ts';
import type { SearchEngine } from './search/engines/types.ts';
/** The assembled core web stack. */
export interface WebStack {
    /** The host adapter the stack was built for. */
    readonly host: HostAdapter;
    /** The resolved configuration. */
    readonly config: ResolvedCoreConfig;
    /** The shared web store (search cache, page cache, history). */
    readonly store: WebStore;
    /** Product user-agent (host identity included). */
    readonly userAgent: string;
    /** Built engine map (diagnostics). */
    readonly engines: ReadonlyMap<string, SearchEngine>;
    /**
     * Run one search (single query). Multi-query merging is a tool-layer
     * concern; adapters may issue several searches.
     */
    search(request: SearchRequest, signal?: AbortSignal): Promise<SearchResult>;
    /** Fetch one URL (SSRF-guarded, cached, markdown-ready). */
    fetch(request: FetchRequest, signal?: AbortSignal): Promise<FetchResult>;
    /** Run one platform search. */
    platformSearch(request: PlatformSearchRequest, signal?: AbortSignal): Promise<PlatformSearchResult>;
    /**
     * The browser module manager (undefined when `browser.enabled` is false,
     * the default — ADR-005 §4, Q8).
     */
    readonly browser?: BrowserManager;
    /** Build the model-facing tool specs (host registration contract). */
    tools(): ToolSpec[];
    /** Release host resources (browser sessions, store close, host.dispose()). */
    dispose(): Promise<void>;
}
/** Build the full web stack for one host. */
export declare function createWebStack(host: HostAdapter): WebStack;
/** Re-export for adapters that build cache keys. */
export { searchCacheKey, MULTI_SEARCH_PROVIDER_ID };
