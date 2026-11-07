/**
 * Pure-TypeScript BM25 ranking for local re-ranking of enriched search
 * candidates. No model, no network: token frequencies and corpus statistics
 * only. Deterministic for identical inputs.
 * @module @agents-web-search/core/search/bm25
 */
/**
 * Tokenize text into lower-cased runs of letters and digits. Unicode-aware
 * (`\p{L}\p{N}`), so Cyrillic and other scripts tokenize identically to Latin.
 * @param text - the text to tokenize.
 * @returns the tokens in order of appearance (duplicates kept).
 */
export declare function tokenize(text: string): string[];
/**
 * Score `documents` against `query` with BM25.
 *
 * Uses the non-negative idf variant `ln(1 + (N - df + 0.5) / (df + 0.5))`, so a
 * term present in every document scores zero instead of negative. Documents
 * with no query-term overlap score zero.
 *
 * @param query - the search query.
 * @param documents - the candidate documents, in engine rank order.
 * @param k1 - term-frequency saturation parameter (default 1.2).
 * @param b - length-normalization parameter (default 0.75).
 * @returns one score per document, same order as `documents`.
 */
export declare function bm25Rank(query: string, documents: readonly string[], k1?: number, b?: number): number[];
