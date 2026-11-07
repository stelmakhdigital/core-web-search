/**
 * Embedding-based re-ranking for search results. Computes embeddings for the
 * query and each result snippet via a local embedding endpoint (e.g., a local
 * LLM server with an `/embeddings` route), then re-ranks by cosine similarity.
 *
 * The endpoint is configurable (default: off). When off, the plugin falls back
 * to BM25 (keyword-based) re-ranking. When on, the plugin calls the endpoint
 * to get embeddings and re-ranks by semantic similarity.
 * @module dsh-web-automation/search/embedding
 */
/** Embedding endpoint options. */
export interface EmbeddingOptions {
    /** The embedding endpoint base URL (e.g., `http://localhost:11434`). Empty = off. */
    endpoint: string;
    /** The embedding model name (e.g., `nomic-embed-text`). */
    model: string;
    /** `User-Agent` header sent on every request. */
    userAgent: string;
    /** Hard cap on one response body (bytes). */
    maxResponseBytes: number;
    /** Request timeout (ms). */
    timeoutMs: number;
}
/** A single embedding vector (float32). */
export type Embedding = number[];
/**
 * Compute the cosine similarity between two vectors.
 * @param a - the first vector.
 * @param b - the second vector.
 * @returns the cosine similarity in [-1, 1] (1 = identical direction).
 */
export declare function cosineSimilarity(a: Embedding, b: Embedding): number;
/**
 * Re-rank search results by embedding similarity to the query.
 * @param query - the search query.
 * @param snippets - the result snippets (one per source).
 * @param options - the embedding endpoint options.
 * @param signal - the abort signal.
 * @returns the re-ranked indices (highest similarity first).
 */
export declare function embeddingRerank(query: string, snippets: readonly string[], options: EmbeddingOptions, signal: AbortSignal): Promise<number[]>;
