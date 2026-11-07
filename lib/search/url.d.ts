/**
 * URL normalization for cache keys and result de-duplication.
 * @module @agents-web-search/core/search/url
 */
/**
 * Normalize a URL for cache keys and de-duplication: strip the fragment,
 * common tracking parameters, and a non-root trailing slash (so URLs that
 * differ only by `/?utm_…` or a trailing slash map to one key). The scheme
 * and host are kept as-is (the URL parser already lower-cases the host).
 * Unparseable input is returned unchanged — a cache key only needs to be
 * stable, not canonical.
 * @param url - the URL to normalize.
 * @returns the normalized URL string.
 */
export declare function normalizeUrl(url: string): string;
