/**
 * `WebStore`: a persistent SQLite store (node:sqlite) for web search
 * results, fetched pages, cache entries, and history. One file (default
 * `$DSH_HOME/web.db`) is shared by the search provider, the fetch provider,
 * and the history tools; WAL mode keeps concurrent readers from blocking.
 *
 * The store is type-agnostic: `sources` is stored as an opaque JSON array so
 * the package stays a pure utility with no dependency on the web seam.
 *
 * The database opens lazily on the first operation (the node:sqlite import is
 * deferred so Node 22 startup stays quiet, matching `session-query-sqlite`).
 *
 * @module @agents-web-search/core/store
 */
/** Store configuration. */
export interface WebStoreOptions {
    /** Path to the SQLite file, or `':memory:'` for an in-memory database. */
    path: string;
    /**
     * LRU eviction caps. When set, the store evicts the least-recently-accessed
     * entries beyond these caps after each write (a no-op when within the cap).
     * Keeps the store bounded so `web.db` does not grow unbounded over time.
     */
    evictLimits?: {
        maxSearches?: number;
        maxPages?: number;
    };
}
/** One stored search record (history + search cache). */
export interface StoredSearch {
    /** Row id. */
    id: number;
    /** Stable cache key computed by the caller. */
    cacheKey: string;
    /** The search query as issued. */
    query: string;
    /** Engine ids that produced the result (JSON array, decoded). */
    engines: string[];
    /** Epoch milliseconds when the search was recorded. */
    createdAt: number;
    /** Result sources as an opaque JSON array (decoded). */
    sources: unknown[];
    /** Whether the result was truncated. */
    truncated: boolean;
    /** Optional merged answer text. */
    content?: string;
}
/** One stored fetched page (history + page cache). */
export interface StoredPage {
    /** Row id. */
    id: number;
    /** The requested URL. */
    url: string;
    /** Normalized URL (cache key). */
    normalizedUrl: string;
    /** Epoch milliseconds when the page was fetched. */
    fetchedAt: number;
    /** `ETag` response header, when present. */
    etag?: string;
    /** `Last-Modified` response header, when present. */
    lastModified?: string;
    /** HTTP status code of the fetch. */
    statusCode: number;
    /** Decoded body kind. */
    bodyKind: 'html' | 'text';
    /** Decoded body content (capped by the caller). */
    body: string;
    /** Whether the body was truncated. */
    truncated: boolean;
}
/** Store statistics. */
export interface WebStoreStats {
    /** Number of stored search records. */
    searches: number;
    /** Number of stored page records. */
    pages: number;
    /** Total stored page body bytes. */
    pageBytes: number;
    /** Epoch milliseconds of the newest search, when any. */
    lastSearchAt?: number;
    /** Epoch milliseconds of the newest page, when any. */
    lastPageAt?: number;
}
/** Fields for {@link WebStore.recordSearch}. */
export interface SearchRecordInput {
    /** Stable cache key (unique). */
    cacheKey: string;
    /** The search query. */
    query: string;
    /** Engine ids that produced the result. */
    engines: readonly string[];
    /** Epoch milliseconds. */
    createdAt: number;
    /** Result sources (opaque; serialized as JSON). */
    sources: readonly unknown[];
    /** Whether the result was truncated. */
    truncated: boolean;
    /** Optional merged answer text. */
    content?: string;
}
/** Fields for {@link WebStore.recordPage}. */
export interface PageRecordInput {
    /** The requested URL. */
    url: string;
    /** Normalized URL (unique). */
    normalizedUrl: string;
    /** Epoch milliseconds. */
    fetchedAt: number;
    /** `ETag` response header, when present. */
    etag?: string;
    /** `Last-Modified` response header, when present. */
    lastModified?: string;
    /** HTTP status code. */
    statusCode: number;
    /** Decoded body kind. */
    bodyKind: 'html' | 'text';
    /** Decoded body content. */
    body: string;
    /** Whether the body was truncated. */
    truncated: boolean;
}
/**
 * The persistent web store. All operations are async (lazy open); the
 * underlying node:sqlite calls are synchronous once open.
 */
export declare class WebStore {
    private readonly options;
    private db;
    private opening;
    private closed;
    constructor(options: WebStoreOptions);
    /** Open the database (idempotent) and return the handle. */
    private ensureOpen;
    private open;
    /**
     * Apply pending schema migrations. Reads the stored version; if it is older
     * than {@link WEB_STORE_SCHEMA_VERSION}, runs each migration in order and
     * records the new version. A missing version is resolved by probing the
     * actual shape: a missing `web_searches` table means a brand-new file (the
     * DDL will create the current shape, so only the version is stamped), while
     * an existing table without the LRU column means a pre-versioning file,
     * upgraded via the ALTER-based migrations. Must run BEFORE the full schema
     * DDL, whose index statements reference columns older files lack.
     * @param db - the open database handle (web_meta already created).
     */
    private migrate;
    /** Insert or replace one search record. Returns the row id. */
    recordSearch(entry: SearchRecordInput): Promise<number>;
    /**
     * Read one search record by cache key (and mark it accessed for LRU).
     *
     * The LRU touch is a synchronous `UPDATE` on the read path — a deliberate
     * cost of LRU semantics (a cache hit must count as an access or hot entries
     * would be evicted). WAL mode keeps this cheap and non-blocking for other
     * connections; at this plugin's scale (a handful of reads per search) it is
     * not a concern.
     */
    readSearch(cacheKey: string): Promise<StoredSearch | undefined>;
    /** Recent search history, newest first. */
    recentSearches(limit: number): Promise<StoredSearch[]>;
    /** Delete all search records. Returns the number of rows deleted. */
    clearSearches(): Promise<number>;
    /** Delete one search record by id (curator discard). Returns true when a row was deleted. */
    deleteSearch(id: number): Promise<boolean>;
    /** Insert or update one page record by normalized URL. Returns the row id. */
    recordPage(entry: PageRecordInput): Promise<number>;
    /** Read one search record by id (5.5, get_search_content). */
    getSearch(id: number): Promise<StoredSearch | undefined>;
    /** Read one page record by id (5.5, get_search_content). */
    getPage(id: number): Promise<StoredPage | undefined>;
    /** Read one page record by normalized URL (and mark it accessed for LRU). */
    readPage(normalizedUrl: string): Promise<StoredPage | undefined>;
    /** Recent page history, newest first. */
    recentPages(limit: number): Promise<StoredPage[]>;
    /** Refresh a page's freshness metadata after a 304 revalidation. */
    refreshPage(normalizedUrl: string, fetchedAt: number, etag?: string, lastModified?: string): Promise<void>;
    /** Delete all page records. Returns the number of rows deleted. */
    clearPages(): Promise<number>;
    /** Delete one page record by id (curator discard). Returns true when a row was deleted. */
    deletePage(id: number): Promise<boolean>;
    /** Store statistics. */
    stats(): Promise<WebStoreStats>;
    /**
     * Evict the least-recently-accessed entries beyond the given caps. Keeps at
     * most `maxSearches` search records and `maxPages` page records, deleting
     * the oldest (by `last_accessed_at`, then `id`) beyond each cap. A cap of 0
     * deletes everything; an undefined cap leaves that table untouched. Returns
     * the number of rows evicted per table.
     * @param limits - the per-table entry caps.
     */
    evict(limits: {
        maxSearches?: number;
        maxPages?: number;
    }): Promise<{
        searches: number;
        pages: number;
    }>;
    /**
     * Merge eviction caps into the store's current caps. A store shared by the
     * search and fetch modules starts cap-less; each module merges its own
     * resolved cap (search → `maxSearches`, fetch → `maxPages`) after resolving
     * its config, so the shared store accumulates both.
     * @param limits - the caps to merge in (undefined fields are preserved).
     */
    setEvictLimits(limits: {
        maxSearches?: number;
        maxPages?: number;
    }): void;
    /**
     * Evict the least-recently-accessed entries beyond the configured caps (a
     * no-op when no caps are set or the store is within the cap). Called after
     * each write to keep the store bounded.
     */
    private maybeEvict;
    /** Close the database. Subsequent operations throw. */
    close(): Promise<void>;
}
