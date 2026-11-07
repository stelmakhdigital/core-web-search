/**
 * RSS / Atom feed parsing for `rss` platforms. The query argument is the feed
 * URL; the feed's entries are returned as sources (title, link, description,
 * publication date). Both RSS 2.0 (`<item>`) and Atom (`<entry>`) are supported.
 * @module @agents-web-search/core/platforms/parse-rss
 */
import type { PlatformSource } from './types.ts';
/**
 * Parse an RSS or Atom feed into platform sources.
 * @param xml - the raw feed document.
 * @param feedUrl - the feed URL, used to resolve relative links.
 * @returns the parsed entries, in feed order (deduplicated by URL).
 */
export declare function parseRssResults(xml: string, feedUrl: string): PlatformSource[];
