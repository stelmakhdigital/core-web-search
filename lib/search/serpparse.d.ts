/**
 * DuckDuckGo HTML SERP parsing — the pure, network-free half of the provider.
 * The HTML endpoint (`html.duckduckgo.com/html/`) returns server-rendered
 * results without JavaScript, so a static parse is sufficient.
 * @module @agents-web-search/core/search/serpparse
 */
/** One parsed search-engine result. */
export interface SerpResult {
    /** The decoded result URL. */
    url: string;
    /** The result title (may be empty for malformed results). */
    title: string;
    /** The engine-provided snippet (may be empty). */
    snippet: string;
}
/**
 * Parse a DuckDuckGo HTML SERP page into results, in engine rank order.
 * Malformed entries (no usable URL) are skipped, never fatal.
 * @param html - the raw SERP document.
 * @returns the parsed results.
 */
export declare function parseDuckDuckGoSerp(html: string): SerpResult[];
/**
 * Decode a result link. DuckDuckGo wraps result URLs in its own redirect
 * (`//duckduckgo.com/l/?uddg=<urlencoded>&rut=…`); the `uddg` parameter carries
 * the real target. Plain absolute and protocol-relative URLs pass through.
 * @param href - the raw `href` attribute value.
 * @returns the decoded URL, or `''` when no usable target can be recovered.
 */
export declare function decodeDuckDuckGoHref(href: string): string;
/** True for an absolute http(s) URL (the only scheme results may carry). */
export declare function isHttpUrl(url: string): boolean;
/**
 * Heuristic bot-block detection for a SERP document: a 200 response that is
 * actually a CAPTCHA/anomaly challenge page. Zero results WITHOUT these
 * markers is a legitimate empty result set, not a block.
 * @param html - the raw SERP document.
 * @returns true when the document looks like a bot challenge.
 */
export declare function isBlockedSerp(html: string): boolean;
