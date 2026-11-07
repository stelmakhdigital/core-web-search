/**
 * Enrichment: fetch the top candidate pages, extract readable text, and
 * re-rank with local BM25. One failed page never fails the search: that
 * source keeps its engine snippet and its (possibly lower) score.
 *
 * Page bodies are cached in the shared web store (the same `web_pages` table
 * the fetch provider writes), so a page fetched for enrichment is reused by
 * `web_fetch` and vice versa.
 *
 * Enrichment fetches go through the SSRF guard (`fetchPublic`): candidate
 * URLs come from third-party SERPs, so private/reserved targets (loopback,
 * LAN, link-local, cloud metadata) are never fetched — a blocked page simply
 * keeps its engine snippet. Set `allowPrivateNetworks: true` to disable the
 * guard in a trusted, network-isolated environment.
 * @module @agents-web-search/core/search/enrich
 */
import type { SearchSource } from '../types.ts';
import type { WebStore } from '../store/index.ts';
import { type EmbeddingOptions } from './embedding.ts';
/** Enrichment options. */
export interface EnrichOptions {
    /** The shared web store (page cache). */
    store: WebStore;
    /** Per-page fetch timeout (ms). */
    pageTimeoutMs: number;
    /** Page cache TTL (ms). */
    pageCacheTtlMs: number;
    /** Hard cap on one page body (bytes). */
    maxPageBytes: number;
    /** Hard cap on one stored page body (chars). */
    maxBodyChars: number;
    /** Snippet window size (chars). */
    snippetChars: number;
    /** `User-Agent` header sent on page fetches. */
    userAgent: string;
    /** Concurrent page fetches. */
    concurrency: number;
    /**
     * Allow enrichment page fetches to private/reserved network targets
     * (loopback, LAN, link-local). Defaults to false: the SSRF guard blocks
     * these. Enable only in a trusted, network-isolated environment.
     */
    allowPrivateNetworks: boolean;
    /** Optional embedding endpoint for semantic re-ranking (falls back to BM25 when off/fails). */
    embedding?: EmbeddingOptions;
}
/**
 * Enrich sources: fetch the candidate pages, extract text, re-rank with BM25,
 * and replace snippets with query-focused windows.
 * @param query - the search query.
 * @param sources - the candidate sources (already sliced to the fetch limit).
 * @param keep - how many enriched sources to keep.
 * @param options - the enrichment options.
 * @param signal - the provider deadline signal.
 * @returns the re-ranked, snippet-replaced sources.
 */
export declare function enrichSources(query: string, sources: readonly SearchSource[], keep: number, options: EnrichOptions, signal: AbortSignal): Promise<SearchSource[]>;
