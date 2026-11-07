/**
 * `OllamaEngine`: web search through a local Ollama instance
 * (`POST /api/experimental/web_search`). A configured local endpoint is
 * trusted by definition (same semantics as the SearXNG self-hosted engine:
 * the user chose the endpoint, so the SSRF guard does not apply).
 * @module @agents-web-search/core/search/engines/ollama
 */
import type { EngineSearchResult, SearchEngine, SearchEngineDeps } from './types.ts';
/** Default local Ollama host. */
export declare const OLLAMA_DEFAULT_ENDPOINT = "http://localhost:11434";
/** Engine options. */
export interface OllamaEngineOptions extends SearchEngineDeps {
    /** Local Ollama base endpoint. */
    readonly endpoint?: string;
}
/** The local Ollama web-search engine. */
export declare class OllamaEngine implements SearchEngine {
    readonly id = "ollama";
    private readonly options;
    private readonly http;
    constructor(options: OllamaEngineOptions);
    private endpoint;
    /** Cheap local check: the endpoint must parse as an absolute http(s) URL. */
    available(): boolean;
    search(query: string, maxResults: number, signal: AbortSignal): Promise<EngineSearchResult>;
}
