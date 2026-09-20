import { describe, expect, it } from 'vitest'

import { extractPdfToMarkdown } from '../src/fetch/pdf.ts'
import { makePdf } from './fixtures/pdf.ts'

const limits = { maxSizeBytes: 1_000_000, maxPages: 10 }

describe('extractPdfToMarkdown (5.1 local engine)', () => {
  it('extracts text pages into a markdown document', async () => {
    const pdf = makePdf(['Hello from page one', 'Second page body'])
    const result = await extractPdfToMarkdown(pdf, 'https://example.com/files/whitepaper.pdf', limits)
    expect(result.totalPages).toBe(2)
    expect(result.pages).toBe(2)
    expect(result.markdown).toContain('# whitepaper')
    expect(result.markdown).toContain('https://example.com/files/whitepaper.pdf (PDF, 2 pages)')
    expect(result.markdown).toContain('## Page 1')
    expect(result.markdown).toContain('Hello from page one')
    expect(result.markdown).toContain('## Page 2')
    expect(result.markdown).toContain('Second page body')
  })

  it('slices to the first maxPages pages and annotates the source line', async () => {
    const pdf = makePdf(['a', 'b', 'c', 'd'])
    const result = await extractPdfToMarkdown(pdf, 'https://example.com/x.pdf', { maxSizeBytes: 1_000_000, maxPages: 2 })
    expect(result.totalPages).toBe(4)
    expect(result.pages).toBe(2)
    expect(result.markdown).toContain('## Page 1')
    expect(result.markdown).toContain('## Page 2')
    expect(result.markdown).not.toContain('## Page 3')
    expect(result.markdown).toContain('4 pages; showing the first 2')
  })

  it('rejects an empty body with WEB_PARSE_ERROR', async () => {
    await expect(extractPdfToMarkdown(new Uint8Array(0), 'https://example.com/e.pdf', limits)).rejects.toMatchObject({
      code: 'WEB_PARSE_ERROR',
    })
  })

  it('rejects an oversized body with WEB_FETCH_TOO_LARGE', async () => {
    const pdf = makePdf(['x'.repeat(200)])
    await expect(extractPdfToMarkdown(pdf, 'https://example.com/big.pdf', { maxSizeBytes: 50, maxPages: 10 })).rejects.toMatchObject({
      code: 'WEB_FETCH_TOO_LARGE',
    })
  })

  it('rejects corrupt bytes with WEB_PARSE_ERROR', async () => {
    const junk = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x00, 0x01])
    await expect(extractPdfToMarkdown(junk, 'https://example.com/bad.pdf', limits)).rejects.toMatchObject({
      code: 'WEB_PARSE_ERROR',
    })
  })

  it('rejects a text-less PDF (empty pages) with WEB_PARSE_ERROR', async () => {
    const pdf = makePdf(['', ''])
    await expect(extractPdfToMarkdown(pdf, 'https://example.com/empty.pdf', limits)).rejects.toMatchObject({
      code: 'WEB_PARSE_ERROR',
    })
  })

  it('falls back to a generic title for URLs without a readable basename', async () => {
    const pdf = makePdf(['content'])
    const result = await extractPdfToMarkdown(pdf, 'https://example.com/', limits)
    expect(result.markdown).toContain('# document')
  })
})
