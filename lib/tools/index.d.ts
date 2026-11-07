/**
 * The core's model-facing tools as host-agnostic `ToolSpec`s (ADR-002/006):
 * `web_search`, `web_fetch`, `web_platform_search`, `web_history`,
 * `web_search_stats`, `web_cache_clear`. Host adapters convert the JSON-Schema
 * parameters to their schema language and enforce host output caps on top of
 * the core caps.
 *
 * Tool outputs are never thrown: `CoreError`s surface as `isError` outputs
 * with a stable `[CODE]: message` shape (adapters may still map `isError`
 * outputs to host errors — e.g. DSH re-throws via `toHostError`).
 * @module @agents-web-search/core/tools
 */
import type { WebStore } from '../store/index.ts';
import type { ResolvedCoreConfig } from '../config.ts';
import type { FetchResult, LlmClient, PlatformSearchResult, SearchRequest, SearchResult, ToolOutput, ToolSpec } from '../types.ts';
/** The stack surface the tools need (implemented by {@link WebStack}). */
export interface ToolHost {
    readonly config: ResolvedCoreConfig;
    readonly store: WebStore;
    /** One single-query search (routing, cache, enrichment). */
    search(request: SearchRequest, signal?: AbortSignal): Promise<SearchResult>;
    /** One raw fetch (SSRF-guarded, cached). */
    fetch(request: {
        readonly url: string;
    }, signal?: AbortSignal): Promise<FetchResult>;
    /** One platform search. */
    platformSearch(request: {
        readonly platform: string;
        readonly query: string;
        readonly maxResults?: number;
    }, signal?: AbortSignal): Promise<PlatformSearchResult>;
    /** Per-engine routing diagnostics (cooldowns, availability); optional. */
    readonly searchDiagnostics?: () => readonly import('../search/provider.ts').EngineDiagnostics[];
    /** Drop the in-memory page-cache layer (the store is cleared separately); optional. */
    readonly clearMemoryCache?: () => void;
    /** Host LLM client (optional) — powers `web_fetch` question mode (5.1). */
    readonly llm?: LlmClient;
}
/** The tool execution context (matches `ToolSpec.execute`). */
export interface ToolExecuteCtx {
    readonly signal: AbortSignal;
    readonly onUpdate?: (partial: ToolOutput) => void;
}
/** The `web_search` tool spec. */
export declare function buildSearchTool(host: ToolHost): ToolSpec;
/** The `web_fetch` tool spec. */
export declare function buildFetchTool(host: ToolHost): ToolSpec;
/**
 * The `get_search_content` tool (5.5): read the full content of a cached
 * search answer or fetched page by web store record id (the ids are printed
 * in the web_search / web_fetch output). `findText` searches the stored
 * content case-insensitively and returns context windows around the first
 * matches; otherwise an `offset`/`limit` character window is returned.
 */
export declare function buildGetSearchContentTool(host: ToolHost): ToolSpec;
/** The `web_platform_search` tool spec. */
export declare function buildPlatformSearchTool(host: ToolHost): ToolSpec;
/** The `web_history` tool spec. */
export declare function buildHistoryTool(host: ToolHost): ToolSpec;
/** The `web_search_stats` tool spec. */
export declare function buildStatsTool(host: ToolHost): ToolSpec;
/** The `web_cache_clear` tool spec. */
export declare function buildCacheClearTool(host: ToolHost): ToolSpec;
/** The `web_curator` tool spec (roadmap 5.4): start/status/stop the local
 * curator UI server. The running server is kept per host (WeakMap). */
export declare function buildCuratorTool(host: ToolHost): ToolSpec;
/** Build all v1.0 tool specs for the host. */
export declare function buildCoreTools(host: ToolHost): ToolSpec[];
