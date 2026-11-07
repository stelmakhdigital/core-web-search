/**
 * `GeminiEngine`: Google Gemini generateContent with the `google_search`
 * grounding tool (provider-native search; ADR-004). Sources come from
 * grounding metadata (grounding chunks / part citations); the answer text
 * from candidate parts.
 * @module @agents-web-search/core/search/engines/provider-native/gemini
 */
import type { EngineSearchResult, SearchEngine, SearchEngineDeps } from '../types.ts';
/** Default Gemini endpoint base. */
export declare const GEMINI_DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com";
/** Default model (may age — configure explicitly in production). */
export declare const GEMINI_DEFAULT_MODEL = "gemini-2.5-flash";
/** Engine options. */
export interface GeminiEngineOptions extends SearchEngineDeps {
    readonly apiKey?: string;
    readonly baseUrl?: string;
    readonly model?: string;
}
/** The Gemini (google_search grounding) engine. */
export declare class GeminiEngine implements SearchEngine {
    readonly id = "gemini";
    private readonly options;
    private cachedKey;
    constructor(options: GeminiEngineOptions);
    available(): boolean;
    search(query: string, maxResults: number, signal: AbortSignal): Promise<EngineSearchResult>;
}
