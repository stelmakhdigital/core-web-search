/**
 * HTML result extraction for `html` platforms. Each result item is selected by
 * a CSS selector; the link, title, and snippet are resolved relative to the
 * item. Relative hrefs are resolved against the search URL. Malformed items
 * (no usable URL) are skipped, never fatal.
 * @module @agents-web-search/core/platforms/parse-html
 */
import type { HtmlSelectors, PlatformSource } from './types.ts';
/**
 * Parse an HTML document into platform sources using the configured selectors.
 * @param html - the raw HTML document.
 * @param selectors - the platform's {@link HtmlSelectors}.
 * @param baseUrl - the search URL, used to resolve relative hrefs.
 * @returns the parsed sources, in document order (deduplicated by URL).
 */
export declare function parseHtmlResults(html: string, selectors: HtmlSelectors, baseUrl: string): PlatformSource[];
