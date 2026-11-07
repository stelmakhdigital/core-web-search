/**
 * `htmlToMarkdown`: practical HTML → Markdown conversion for the readable
 * fetch mode (pi-web-access style: readable extraction, not a full converter).
 * Strategy: pick the main content container (`<article>` / `<main>` /
 * `[role=main]` / content-classed div), strip non-content elements, walk the
 * DOM producing headings/links/lists/quotes/code/paragraphs.
 * @module @agents-web-search/core/markdown
 */
/**
 * Convert an HTML document to readable Markdown.
 * Returns the full body when no main container is found.
 */
export declare function htmlToMarkdown(html: string): string;
