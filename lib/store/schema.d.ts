/**
 * SQL schema for the web store. `CREATE IF NOT EXISTS` keeps opening an
 * existing file idempotent; the schema version is tracked in `web_meta` so a
 * migration can detect and upgrade older files.
 * @module dsh-web-automation/store/schema
 */
/** Current schema version; bump and add a migration when the shape changes. */
export declare const WEB_STORE_SCHEMA_VERSION = 2;
/**
 * The full schema DDL. Applied on every open (idempotent). WAL journal mode is
 * set separately so concurrent readers (search provider, fetch provider,
 * history tools) do not block each other. `last_accessed_at` drives LRU
 * eviction (updated on every read/write; oldest entries are evicted first).
 */
export declare const WEB_STORE_SCHEMA = "\nCREATE TABLE IF NOT EXISTS web_meta (\n  key TEXT PRIMARY KEY,\n  value TEXT NOT NULL\n);\nCREATE TABLE IF NOT EXISTS web_searches (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  cache_key TEXT NOT NULL UNIQUE,\n  query TEXT NOT NULL,\n  engines TEXT NOT NULL,\n  created_at INTEGER NOT NULL,\n  last_accessed_at INTEGER NOT NULL DEFAULT 0,\n  sources TEXT NOT NULL,\n  truncated INTEGER NOT NULL DEFAULT 0,\n  content TEXT\n);\nCREATE TABLE IF NOT EXISTS web_pages (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  url TEXT NOT NULL,\n  normalized_url TEXT NOT NULL UNIQUE,\n  fetched_at INTEGER NOT NULL,\n  last_accessed_at INTEGER NOT NULL DEFAULT 0,\n  etag TEXT,\n  last_modified TEXT,\n  status_code INTEGER NOT NULL,\n  body_kind TEXT NOT NULL,\n  body TEXT NOT NULL,\n  truncated INTEGER NOT NULL DEFAULT 0\n);\nCREATE INDEX IF NOT EXISTS idx_web_searches_created_at ON web_searches (created_at DESC);\nCREATE INDEX IF NOT EXISTS idx_web_searches_last_accessed_at ON web_searches (last_accessed_at ASC);\nCREATE INDEX IF NOT EXISTS idx_web_pages_fetched_at ON web_pages (fetched_at DESC);\nCREATE INDEX IF NOT EXISTS idx_web_pages_last_accessed_at ON web_pages (last_accessed_at ASC);\n";
/**
 * Migrations from older schema versions to {@link WEB_STORE_SCHEMA_VERSION}.
 * Each entry upgrades from `from` to `from + 1`; they are applied in order on
 * open when the stored version is older than the current one.
 */
export declare const WEB_STORE_MIGRATIONS: Array<{
    from: number;
    up: string;
}>;
