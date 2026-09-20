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

import { CoreError } from '../errors.ts'

/** Resolved PDF extraction limits (core defaults after config resolution). */
export interface PdfLimits {
  /** Extract `application/pdf` responses instead of failing with WEB_UNSUPPORTED_CONTENT_TYPE. */
  readonly enabled: boolean
  /** Maximum PDF body size in bytes (default 20 MB). */
  readonly maxSizeBytes: number
  /** Maximum pages extracted (head-biased; default 50). */
  readonly maxPages: number
}

/** The extraction result. */
export interface PdfExtraction {
  /** Markdown: a title header, a source line, and one `## Page N` section per page. */
  readonly markdown: string
  /** Pages included in the markdown (≤ `maxPages`). */
  readonly pages: number
  /** Total pages in the document. */
  readonly totalPages: number
}

/** Cached dynamic import of the local PDF engine (unpdf). */
let unpdfImport: Promise<typeof import('unpdf')> | undefined

function loadUnpdf(): Promise<typeof import('unpdf')> {
  unpdfImport ??= import('unpdf')
  return unpdfImport
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
export async function extractPdfToMarkdown(bytes: Uint8Array, url: string, limits: Pick<PdfLimits, 'maxSizeBytes' | 'maxPages'>): Promise<PdfExtraction> {
  if (bytes.byteLength === 0) {
    throw new CoreError('empty PDF body', 'WEB_PARSE_ERROR')
  }
  if (bytes.byteLength > limits.maxSizeBytes) {
    throw new CoreError(`PDF exceeds the maximum size of ${limits.maxSizeBytes} bytes`, 'WEB_FETCH_TOO_LARGE')
  }

  let extractText: (data: Uint8Array, options: { mergePages: false }) => Promise<{ totalPages: number; text: string[] }>
  try {
    extractText = (await loadUnpdf()).extractText
  } catch (error: unknown) {
    throw new CoreError(
      `PDF extraction is unavailable (the "unpdf" engine could not be loaded): ${errorMessage(error)}`,
      'WEB_NOT_AVAILABLE',
      { cause: error },
    )
  }

  let parsed: { totalPages: number; text: string[] }
  try {
    parsed = await extractText(bytes, { mergePages: false })
  } catch (error: unknown) {
    throw new CoreError(`cannot parse PDF: ${errorMessage(error)}`, 'WEB_PARSE_ERROR', { cause: error })
  }

  const pages = parsed.text.slice(0, limits.maxPages)
  const nonEmpty = pages.filter((page) => page.trim().length > 0)
  if (nonEmpty.length === 0) {
    throw new CoreError('PDF contains no extractable text (scanned images, or the first pages are empty)', 'WEB_PARSE_ERROR')
  }

  const truncatedPages = parsed.totalPages > limits.maxPages
  const body = pages
    .map((page, index) => `## Page ${index + 1}\n\n${page.trim()}`)
    .join('\n\n')
  const markdown =
    `# ${titleFromUrl(url)}\n\n` +
    `_Source: ${url} (PDF, ${parsed.totalPages} page${parsed.totalPages === 1 ? '' : 's'}${
      truncatedPages ? `; showing the first ${limits.maxPages}` : ''
    })_\n\n${body}`

  return { markdown, pages: pages.length, totalPages: parsed.totalPages }
}

/** A display title for the markdown header (the URL basename without extension). */
function titleFromUrl(url: string): string {
  try {
    const { pathname } = new URL(url)
    const base = pathname.split('/').filter(Boolean).pop() ?? 'document'
    return base.includes('.') ? base.slice(0, base.lastIndexOf('.')) : base
  } catch {
    return 'document'
  }
}

/** A compact one-line error message (no secrets; unpdf/pdfjs messages are safe). */
function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
