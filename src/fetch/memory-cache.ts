/**
 * Bounded in-memory LRU front layer over the SQLite page cache: repeated
 * `web_fetch` / `get_search_content` hits within a session skip the store
 * round-trip entirely. Entries are keyed by the normalized URL and carry the
 * same shape as a stored page; freshness is the caller's concern (the fetch
 * provider compares `fetchedAt` with the page-cache TTL, exactly like it
 * does for store reads).
 * @module dsh-web-automation/fetch/memory-cache
 */

import type { StoredPage } from '../store/index.ts'

/** Bounded in-memory LRU of fetched pages. */
export class MemoryPageCache {
  private readonly entries = new Map<string, StoredPage>()

  constructor(readonly maxEntries: number) {
    if (!Number.isInteger(maxEntries) || maxEntries < 0) {
      throw new Error(`memoryCache.maxEntries must be a non-negative integer, got ${maxEntries}`)
    }
  }

  /** One cached page, bumping it to the most-recently-used slot. */
  get(key: string): StoredPage | undefined {
    const page = this.entries.get(key)
    if (page === undefined) return undefined
    this.entries.delete(key)
    this.entries.set(key, page)
    return page
  }

  /** Put one page, evicting the least-recently-used entries over the cap. */
  set(key: string, page: StoredPage): void {
    this.entries.delete(key)
    this.entries.set(key, page)
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) break
      this.entries.delete(oldest)
    }
  }

  /** Drop one entry (the caller re-reads from the store on the next hit). */
  delete(key: string): void {
    this.entries.delete(key)
  }

  /** Drop everything (wired into `web_cache_clear`). */
  clear(): void {
    this.entries.clear()
  }

  /** Current entry count (for stats and tests). */
  get size(): number {
    return this.entries.size
  }
}
