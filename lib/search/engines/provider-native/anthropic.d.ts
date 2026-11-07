/**
 * Provider-native engines over the Anthropic-compatible Messages API with the
 * hosted `web_search_20250305` server tool: presets for Anthropic and DeepSeek
 * (DeepSeek's search endpoint is Anthropic-compatible — verified against the
 * DSH built-in web-search-deepseek provider; ADR-004).
 * @module @agents-web-search/core/search/engines/provider-native/anthropic
 */
import type { EngineSearchResult, SearchEngine, SearchEngineDeps } from '../types.ts';
/** Default endpoint bases (`/v1` included in each; `/messages` is appended). */
export declare const ANTHROPIC_DEFAULT_BASE_URL = "https://api.anthropic.com/v1";
export declare const DEEPSEEK_DEFAULT_BASE_URL = "https://api.deepseek.com/anthropic/v1";
/** Default models (may age — configure explicitly in production). */
export declare const ANTHROPIC_DEFAULT_MODEL = "claude-sonnet-4-5";
export declare const DEEPSEEK_DEFAULT_MODEL = "deepseek-v4-flash";
/** Default `anthropic-version` header value. */
export declare const ANTHROPIC_DEFAULT_API_VERSION = "2023-06-01";
/** Engine options (shared by the anthropic and deepseek presets). */
export interface MessagesEngineOptions extends SearchEngineDeps {
    readonly id: 'anthropic' | 'deepseek';
    readonly apiKey?: string;
    readonly baseUrl?: string;
    readonly model?: string;
    /** Max `web_search` server-tool uses per request. */
    readonly maxUses?: number;
}
/** The Anthropic-compatible Messages API engine (anthropic + deepseek presets). */
export declare class MessagesSearchEngine implements SearchEngine {
    readonly id: 'anthropic' | 'deepseek';
    private readonly options;
    private readonly preset;
    private cachedKey;
    constructor(options: MessagesEngineOptions);
    available(): boolean;
    search(query: string, maxResults: number, signal: AbortSignal): Promise<EngineSearchResult>;
}
/** Build the `anthropic` engine instance. */
export declare function createAnthropicEngine(deps: SearchEngineDeps, config?: {
    baseUrl?: string;
    model?: string;
    apiKey?: string;
    maxUses?: number;
}): MessagesSearchEngine;
/** Build the `deepseek` engine instance (Anthropic-compatible endpoint). */
export declare function createDeepseekEngine(deps: SearchEngineDeps, config?: {
    baseUrl?: string;
    model?: string;
    apiKey?: string;
    maxUses?: number;
}): MessagesSearchEngine;
