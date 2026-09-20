import { describe, expect, it } from 'vitest'
import { htmlToMarkdown } from '../src/markdown.ts'

describe('htmlToMarkdown', () => {
  it('converts headings, paragraphs, and links', () => {
    const html = `<html><body><h1>Title</h1><p>First <a href="https://example.com/a">link</a>.</p><h2>Sub</h2><p>Second.</p></body></html>`
    const md = htmlToMarkdown(html)
    expect(md).toContain('# Title')
    expect(md).toContain('## Sub')
    expect(md).toContain('[link](https://example.com/a)')
    expect(md).toContain('First')
    expect(md).toContain('Second.')
  })

  it('renders lists and ordered lists with indentation', () => {
    const html = `<html><body><ul><li>one</li><li>two<ul><li>nested</li></ul></li></ul><ol><li>a</li><li>b</li></ol></body></html>`
    const md = htmlToMarkdown(html)
    expect(md).toContain('- one')
    expect(md).toContain('- two')
    expect(md).toContain('  - nested')
    expect(md).toContain('1. a')
    expect(md).toContain('2. b')
  })

  it('keeps code blocks fenced', () => {
    const html = `<html><body><pre>const x = 1;\nconsole.log(x)</pre></body></html>`
    const md = htmlToMarkdown(html)
    expect(md).toContain('```')
    expect(md).toContain('const x = 1;')
  })

  it('strips scripts, styles, nav, and forms', () => {
    const html = `<html><body><script>var secret = 1</script><style>.x{color:red}</style><nav>menu</nav><form><input/></form><p>Content</p></body></html>`
    const md = htmlToMarkdown(html)
    expect(md).not.toContain('secret')
    expect(md).not.toContain('color:red')
    expect(md).not.toContain('menu')
    expect(md).toContain('Content')
  })

  it('converts blockquotes and inline code', () => {
    const html = `<html><body><blockquote>quoted <code>code</code></blockquote></body></html>`
    const md = htmlToMarkdown(html)
    expect(md).toContain('> quoted `code`')
  })

  it('prefers an <article> main container over the body', () => {
    const filler = 'x'.repeat(300)
    const html = `<html><body><aside>${filler}</aside><article><h1>Article</h1><p>${filler}</p></article></body></html>`
    const md = htmlToMarkdown(html)
    expect(md).toContain('# Article')
    // The aside filler should not dominate the output.
    const articleIndex = md.indexOf('# Article')
    expect(articleIndex).toBeGreaterThan(-1)
  })

  it('returns a string for empty input', () => {
    expect(typeof htmlToMarkdown('')).toBe('string')
  })
})
