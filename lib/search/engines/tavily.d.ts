/**
 * `TavilyEngine`: the Tavily search API as a core engine. The API key is
 * resolved per search through the engine's secret resolver (host credentials
 * domain / env fallback; ADR-002 §6).
 * @module @agents-web-search/core/search/engines/tavily
 */
import type { EngineSearchResult, SearchEngine, SearchEngineDeps } from './types.ts';
/** Default Tavily API base. */
export declare const TAVILY_DEFAULT_BASE_URL = "https://api.tavily.com";
/** Engine options. */
export interface TavilyEngineOptions extends SearchEngineDeps {
    readonly apiKey?: string;
    readonly baseUrl?: string;
    /** Search depth. */
    readonly depth?: 'basic' | 'advanced';
}
/** The Tavily API search engine. */
export declare class TavilyEngine implements SearchEngine {
    readonly id = "tavily";
    private readonly options;
    private readonly http;
    private cachedKey;
    constructor(options: TavilyEngineOptions);
    available(): boolean;
    search(query: string, maxResults: number, signal: AbortSignal): Promise<EngineSearchResult>;
    private filterAndDedupe;
}
