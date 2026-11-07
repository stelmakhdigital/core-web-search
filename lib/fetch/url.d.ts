/**
 * URL normalization for cache keys. Intentionally parallel to the module in
 * `@deepseek-ai/dsh-web-search-multi` (each package owns its dependencies);
 * the two MUST evolve together.
 * @module @agents-web-search/core/fetch/url
 */
/**
 * Normalize a URL for cache keys: strip the fragment and common tracking
 * parameters. Unparseable input is returned unchanged — a cache key only
 * needs to be stable, not canonical.
 * @param url - the URL to normalize.
 * @returns the normalized URL string.
 */
export declare function normalizeUrl(url: string): string;
