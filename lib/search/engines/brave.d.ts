/**
 * `BraveEngine`: the Brave Web Search API as a core engine (free tier for
 * personal keys; the router treats quota failures as cooldowns).
 * @module @agents-web-search/core/search/engines/brave
 */
import type { EngineSearchResult, SearchEngine, SearchEngineDeps } from './types.ts';
/** Default Brave Search API base. */
export declare const BRAVE_DEFAULT_BASE_URL = "https://api.search.brave.com";
/** Engine options. */
export interface BraveEngineOptions extends SearchEngineDeps {
    readonly apiKey?: string;
    readonly baseUrl?: string;
    readonly country?: string;
    readonly freshness?: string;
}
/** Map the core freshness hint to Brave's `freshness` parameter. */
export declare function braveFreshness(freshness: string): string;
/** The Brave Web Search API engine. */
export declare class BraveEngine implements SearchEngine {
    readonly id = "brave";
    private readonly options;
    private readonly http;
    private cachedKey;
    constructor(options: BraveEngineOptions);
    available(): boolean;
    search(query: string, maxResults: number, signal: AbortSignal): Promise<EngineSearchResult>;
    private filterAndDedupe;
}
