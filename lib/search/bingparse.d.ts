/**
 * Parser for the Bing HTML SERP. Bing serves a server-rendered page to a
 * plain GET with a product user agent; organic results sit in
 * `<li class="b_algo">` items with an `h2 > a` title link and a
 * `.b_caption` snippet.
 * @module @agents-web-search/core/search/bingparse
 */
/** One parsed Bing organic result. */
export interface BingSerpResult {
    /** Absolute result URL. */
    url: string;
    /** Result title. */
    title: string;
    /** Result snippet (may be empty). */
    snippet: string;
}
/**
 * Parse a Bing SERP document into organic results.
 * @param html - the SERP document.
 * @returns the parsed results in page order.
 */
export declare function parseBingSerp(html: string): BingSerpResult[];
/**
 * Detect a Bing consent/challenge page (zero organic results plus a marker).
 * @param html - the fetched document.
 * @returns true when the document is not a usable SERP.
 */
export declare function isBlockedBingSerp(html: string): boolean;
