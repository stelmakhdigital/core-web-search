/**
 * Bounded in-memory LRU front layer over the SQLite page cache: repeated
 * `web_fetch` / `get_search_content` hits within a session skip the store
 * round-trip entirely. Entries are keyed by the normalized URL and carry the
 * same shape as a stored page; freshness is the caller's concern (the fetch
 * provider compares `fetchedAt` with the page-cache TTL, exactly like it
 * does for store reads).
 * @module dsh-web-automation/fetch/memory-cache
 */
import type { StoredPage } from '../store/index.ts';
/** Bounded in-memory LRU of fetched pages. */
export declare class MemoryPageCache {
    readonly maxEntries: number;
    private readonly entries;
    constructor(maxEntries: number);
    /** One cached page, bumping it to the most-recently-used slot. */
    get(key: string): StoredPage | undefined;
    /** Put one page, evicting the least-recently-used entries over the cap. */
    set(key: string, page: StoredPage): void;
    /** Drop one entry (the caller re-reads from the store on the next hit). */
    delete(key: string): void;
    /** Drop everything (wired into `web_cache_clear`). */
    clear(): void;
    /** Current entry count (for stats and tests). */
    get size(): number;
}
