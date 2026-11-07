/**
 * PDF → markdown extraction (extended fetch, roadmap 5.1).
 *
 * The LOCAL engine is `unpdf` (pdfjs-dist under the hood, pure JS, zero
 * native deps) — no API key, no remote service, no host imports (Q9).
 * The module is imported lazily (dynamic `import` with a cached promise,
 * the same pattern as `browser/playwright.ts`) so PDF support costs nothing
 * until a PDF is actually fetched.
 *
 * Remote engines (Datalab/Gemini document understanding) are a v0.1 known
 * limitation — not wired; the local engine covers text-based PDFs, which is
 * the overwhelming majority of agent-relevant documents.
 *
 * Limits (config `fetch.pdf`): `maxSizeBytes` (the whole PDF body) and
 * `maxPages` (extraction is sliced to the first N pages; extraction itself
 * is bounded by the size cap). Errors reuse the existing core vocabulary
 * (ADR-002 §3: hosts route by code): `WEB_FETCH_TOO_LARGE`, `WEB_PARSE_ERROR`.
 *
 * @module @agents-web-search/core/fetch/pdf
 */
/** Resolved PDF extraction limits (core defaults after config resolution). */
export interface PdfLimits {
    /** Extract `application/pdf` responses instead of failing with WEB_UNSUPPORTED_CONTENT_TYPE. */
    readonly enabled: boolean;
    /** Maximum PDF body size in bytes (default 20 MB). */
    readonly maxSizeBytes: number;
    /** Maximum pages extracted (head-biased; default 50). */
    readonly maxPages: number;
}
/** The extraction result. */
export interface PdfExtraction {
    /** Markdown: a title header, a source line, and one `## Page N` section per page. */
    readonly markdown: string;
    /** Pages included in the markdown (≤ `maxPages`). */
    readonly pages: number;
    /** Total pages in the document. */
    readonly totalPages: number;
}
/**
 * Extract the PDF body into markdown.
 * @param bytes - the raw PDF bytes (`application/pdf` response body).
 * @param url - the source URL (title + the source line in the markdown).
 * @param limits - the resolved limits (`maxSizeBytes`, `maxPages`).
 * @returns the markdown plus page accounting.
 * @throws {CoreError} `WEB_FETCH_TOO_LARGE` when the body exceeds `maxSizeBytes`;
 *   `WEB_PARSE_ERROR` when the body is not a parseable text-bearing PDF
 *   (corrupt, encrypted, or no extractable text); `WEB_NOT_AVAILABLE` when
 *   the engine cannot be loaded.
 */
export declare function extractPdfToMarkdown(bytes: Uint8Array, url: string, limits: Pick<PdfLimits, 'maxSizeBytes' | 'maxPages'>): Promise<PdfExtraction>;
