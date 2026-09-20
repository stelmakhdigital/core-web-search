/**
 * Minimal valid PDF generator for tests (pdfjs-parseable, correct xref).
 * One Helvetica text line per page — enough for extraction tests without
 * shipping binary fixtures.
 */

export interface MakePdfOptions {
  /** Optional title-like text appended to every page. */
  marker?: string
}

/** Escape a string for a PDF literal string `(...)`. */
function escapePdf(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

/**
 * Build a small PDF with one text line per page.
 * @param pages - the text of each page.
 * @param options - optional extras.
 * @returns the PDF bytes.
 */
export function makePdf(pages: string[], options: MakePdfOptions = {}): Uint8Array {
  const n = pages.length
  if (n === 0) throw new Error('makePdf: at least one page is required')
  const fontObj = 3 + 2 * n
  const objects: string[] = []
  objects[1] = '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'
  const kids = Array.from({ length: n }, (_, i) => `${3 + 2 * i} 0 R`).join(' ')
  objects[2] = `2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${n} >>\nendobj\n`
  for (let i = 0; i < n; i++) {
    const pageNum = 3 + 2 * i
    const contentNum = pageNum + 1
    const text = escapePdf(`${pages[i] ?? ''}${options.marker !== undefined ? ` ${options.marker}` : ''}`)
    const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`
    objects[pageNum] =
      `${pageNum} 0 obj\n` +
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObj} 0 R >> >> /Contents ${contentNum} 0 R >>\n` +
      'endobj\n'
    objects[contentNum] = `${contentNum} 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`
  }
  objects[fontObj] = `${fontObj} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`

  let body = '%PDF-1.4\n'
  const offsets: number[] = [0]
  for (let i = 1; i <= fontObj; i++) {
    offsets[i] = body.length
    body += objects[i] ?? ''
  }
  const xrefPos = body.length
  const rows = offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('')
  body += `xref\n0 ${fontObj + 1}\n0000000000 65535 f \n${rows}`
  body += `trailer\n<< /Size ${fontObj + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`
  return new TextEncoder().encode(body)
}
