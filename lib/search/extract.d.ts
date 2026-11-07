/**
 * Readable-text extraction from an HTML document — a deliberately
 * conservative heuristic: strip non-content elements, prefer the main article
 * container, collapse whitespace. Pages with unusual structure degrade to
 * body text rather than failing. No readability dependency: the output feeds
 * BM25 re-ranking and snippet windows, not a reader view.
 * @module @agents-web-search/core/search/extract
 */
/**
 * Extract readable text from an HTML document.
 * @param html - the raw document.
 * @returns the collapsed text, or `''` when nothing readable remains.
 */
export declare function extractReadableText(html: string): string;
/**
 * Take a snippet window from extracted page text: the region around the first
 * query-term occurrence, or the text head when no term occurs. Ellipses mark
 * elided context on either side.
 * @param query - the search query (its terms locate the window).
 * @param text - the extracted page text.
 * @param maxChars - the window length budget.
 * @returns the windowed snippet.
 */
export declare function snippetWindow(query: string, text: string, maxChars: number): string;
