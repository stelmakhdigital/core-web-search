/**
 * URL normalization for cache keys and result de-duplication.
 * @module @agents-web-search/core/search/url
 */

/** Tracking-parameter prefixes stripped during normalization. */
const TRACKING_PARAM = /^(utm_|fbclid|gclid|mc_(eid|cid)|ref|source)/i

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
export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    for (const key of [...parsed.searchParams.keys()]) {
      if (TRACKING_PARAM.test(key)) parsed.searchParams.delete(key)
    }
    // Canonical trailing slash: `new URL('https://a/b/?q')` keeps the pathname
    // as '/b/' while 'https://a/b' is '/b' — collapse them so such URLs
    // de-duplicate and share one cache key.
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) parsed.pathname = parsed.pathname.slice(0, -1)
    return parsed.toString()
  } catch {
    return url
  }
}
