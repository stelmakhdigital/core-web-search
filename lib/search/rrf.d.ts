/**
 * Reciprocal rank fusion (RRF): merge per-engine ranked lists into one.
 * Each document's score is the sum over engines of `1 / (k + rank)` (rank is
 * 1-based); `k` (default 60) dampens the weight of top-rank differences.
 * Documents appearing in several engines accumulate score, which is the
 * multi-engine consensus signal.
 * @module @agents-web-search/core/search/rrf
 */
import type { SearchSource } from '../types.ts';
/**
 * Fuse ranked lists with reciprocal rank fusion.
 * @param lists - per-engine ranked source lists (list order = engine priority).
 * @param k - the RRF constant (default 60).
 * @returns the fused, deduplicated, score-descending source list.
 */
export declare function reciprocalRankFuse(lists: readonly (readonly SearchSource[])[], k?: number): SearchSource[];
