/**
 * Reciprocal rank fusion (RRF): merge per-engine ranked lists into one.
 * Each document's score is the sum over engines of `1 / (k + rank)` (rank is
 * 1-based); `k` (default 60) dampens the weight of top-rank differences.
 * Documents appearing in several engines accumulate score, which is the
 * multi-engine consensus signal.
 * @module @agents-web-search/core/search/rrf
 */

import type { SearchSource } from '../types.ts'
import { normalizeUrl } from './url.ts'

/** Mutable working copy of a source (the seam's `SearchSource` is readonly). */
interface MutableSource {
  url: string
  title?: string
  snippet?: string
  publishedAt?: string
}

/**
 * Fuse ranked lists with reciprocal rank fusion.
 * @param lists - per-engine ranked source lists (list order = engine priority).
 * @param k - the RRF constant (default 60).
 * @returns the fused, deduplicated, score-descending source list.
 */
export function reciprocalRankFuse(lists: readonly (readonly SearchSource[])[], k = 60): SearchSource[] {
  const fused = new Map<string, { score: number; source: MutableSource }>()
  for (const list of lists) {
    list.forEach((source, index) => {
      const key = normalizeUrl(source.url)
      const contribution = 1 / (k + index + 1)
      const existing = fused.get(key)
      if (existing === undefined) {
        fused.set(key, { score: contribution, source: { ...source } })
        return
      }
      existing.score += contribution
      mergeSourceFields(existing.source, source)
    })
  }
  return [...fused.values()]
    .sort((a, b) => b.score - a.score)
    .map(entry => entry.source)
}

/** Fill missing optional fields on the representative source from another list's copy. */
function mergeSourceFields(target: MutableSource, other: SearchSource): void {
  if (target.title === undefined && other.title !== undefined) target.title = other.title
  if (target.snippet === undefined && other.snippet !== undefined) target.snippet = other.snippet
  if (target.publishedAt === undefined && other.publishedAt !== undefined) target.publishedAt = other.publishedAt
}
