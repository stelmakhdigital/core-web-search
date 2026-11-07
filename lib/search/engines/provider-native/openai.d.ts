/**
 * Provider-native engines over the OpenAI-compatible Responses API
 * (hosted `web_search` tool): presets for OpenAI and xAI (ADR-004).
 * One LLM call per search (cost guard); sources come from `url_citation`
 * annotations, the answer text from output message items.
 * @module @agents-web-search/core/search/engines/provider-native/openai
 */
import type { EngineSearchResult, SearchEngine, SearchEngineDeps } from '../types.ts';
/** Default endpoint bases. */
export declare const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";
export declare const XAI_DEFAULT_BASE_URL = "https://api.x.ai/v1";
/** Default models (may age — configure explicitly in production). */
export declare const OPENAI_DEFAULT_MODEL = "gpt-5.1";
export declare const XAI_DEFAULT_MODEL = "grok-4.5";
/** Engine options (shared by the openai and xai presets). */
export interface ResponsesEngineOptions extends SearchEngineDeps {
    readonly id: 'openai' | 'xai';
    readonly apiKey?: string;
    readonly baseUrl?: string;
    readonly model?: string;
    /** Default max search results the provider may return per call. */
    readonly maxUses?: number;
    /** Per-request timeout hint (the router deadline still applies). */
    readonly timeoutMs?: number;
}
/** The OpenAI-compatible Responses API engine (openai + xai presets). */
export declare class ResponsesSearchEngine implements SearchEngine {
    readonly id: 'openai' | 'xai';
    private readonly options;
    private readonly preset;
    private cachedKey;
    constructor(options: ResponsesEngineOptions);
    available(): boolean;
    search(query: string, maxResults: number, signal: AbortSignal): Promise<EngineSearchResult>;
}
/** Build the `openai` engine instance. */
export declare function createOpenaiEngine(deps: SearchEngineDeps, config?: {
    baseUrl?: string;
    model?: string;
    apiKey?: string;
    maxUses?: number;
}): ResponsesSearchEngine;
/** Build the `xai` engine instance. */
export declare function createXaiEngine(deps: SearchEngineDeps, config?: {
    baseUrl?: string;
    model?: string;
    apiKey?: string;
    maxUses?: number;
}): ResponsesSearchEngine;
