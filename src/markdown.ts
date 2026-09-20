/**
 * `htmlToMarkdown`: practical HTML → Markdown conversion for the readable
 * fetch mode (pi-web-access style: readable extraction, not a full converter).
 * Strategy: pick the main content container (`<article>` / `<main>` /
 * `[role=main]` / content-classed div), strip non-content elements, walk the
 * DOM producing headings/links/lists/quotes/code/paragraphs.
 * @module @agents-web-search/core/markdown
 */

import * as cheerio from 'cheerio'
import type { AnyNode, Element, Text } from 'domhandler'

/** Type guard: a text node (carries `.data`). */
function isTextNode(node: AnyNode): node is Text {
  return node.type === 'text'
}

/** Type guard: a tag node (element). */
function isTagNode(node: AnyNode): node is Element {
  return node.type === 'tag'
}

/** Candidate selectors for the main content container (first hit wins). */
const MAIN_SELECTORS = [
  'article',
  'main',
  '[role="main"]',
  'div[class*="content"]',
  'div[class*="article"]',
  'div[class*="post"]',
  'div[class*="entry"]',
] as const

/** Elements that never contribute to readable content. */
const STRIPPED_TAGS = new Set([
  'script', 'style', 'noscript', 'template', 'svg', 'canvas', 'iframe',
  'object', 'embed', 'video', 'audio', 'source', 'track', 'map', 'link',
  'meta', 'form', 'button', 'input', 'select', 'textarea', 'nav', 'aside',
  'footer', 'header', 'figure', 'figcaption', 'dialog', 'menu', 'datalist',
])

/**
 * Convert an HTML document to readable Markdown.
 * Returns the full body when no main container is found.
 */
export function htmlToMarkdown(html: string): string {
  const $ = cheerio.load(html)
  $('head').remove()
  for (const tag of STRIPPED_TAGS) $(tag).remove()
  const $root = pickMainRoot($)
  const lines: string[] = []
  walk($, $root, lines)
  return collapse(lines).trim()
}

/** Pick the deepest main-content container (or body as the fallback). */
function pickMainRoot($: cheerio.CheerioAPI): cheerio.Cheerio<Element> {
  for (const selector of MAIN_SELECTORS) {
    const matches = $(selector)
    if (matches.length > 0) {
      // Prefer the match with the most text (guards against decorative
      // containers that merely reuse a content-like class).
      let best: cheerio.Cheerio<Element> | null = null
      let bestText = 0
      for (const el of matches) {
        const text = $.root().find(el).text().length
        if (text > bestText) {
          bestText = text
          best = $(el)
        }
      }
      if (best !== null && bestText >= 200) return best
    }
  }
  return $('body').length > 0 ? $('body') : $('html')
}

interface WalkState {
  /** List nesting depth (2-space indent per level). */
  depth: number
}

/** Plain text of a subtree (no markup): text nodes concatenated. */
function plainText(node: AnyNode): string {
  if (isTextNode(node)) return node.data
  if (!isTagNode(node)) return ''
  return node.children.map((child) => plainText(child)).join('')
}

/** Recursively append the markdown representation of `node` to `lines`. */
function walk($: cheerio.CheerioAPI, node: cheerio.Cheerio<Element>, lines: string[]): void {
  const state: WalkState = { depth: 0 }
  for (const child of node.children()) {
    walkNode($, child, state, lines)
  }
}

function walkNode($: cheerio.CheerioAPI, node: AnyNode, state: WalkState, lines: string[]): void {
  if (isTextNode(node)) {
    const text = node.data
    if (text.length > 0) lines.push(text)
    return
  }
  if (!isTagNode(node)) return
  const tag = node.tagName.toLowerCase()
  if (STRIPPED_TAGS.has(tag)) return

  const $self = $(node)
  const inline = isInlineTag(tag)
  const parts: string[] = []
  if (inline) {
    // Inline elements collect their own text representation.
    if (tag === 'a') {
      const href = $self.attr('href') ?? ''
      const text = plainText(node).trim()
      if (href.length > 0 && /^https?:/i.test(href) && text.length > 0) parts.push(`[${text}](${href})`)
      else if (text.length > 0) parts.push(text)
      return
    }
    if (tag === 'code') {
      const text = plainText(node).trim()
      if (text.length > 0) parts.push(`\`${text}\``)
      return
    }
    if (tag === 'img') {
      const src = $self.attr('src') ?? ''
      if (src.length > 0) parts.push(`![image](${src})`)
      return
    }
    if (tag === 'br') {
      parts.push('\n')
      return
    }
    // generic inline: strong/em/span/... — recurse, keep text
    for (const child of node.children) walkInline($, child, parts)
    return
  }

  // Block-level element.
  switch (tag) {
    case 'pre': {
      const code = $self.text()
      if (code.trim().length > 0) {
        lines.push('```')
        lines.push(code.trimEnd())
        lines.push('```')
      }
      return
    }
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
      const level = Number(tag[1])
      const text = collectInlineText($, node).trim()
      if (text.length > 0) lines.push(`${'#'.repeat(level)} ${text}`)
      return
    }
    case 'p': case 'div': case 'section': case 'article': case 'main': {
      const inner = collectInlineText($, node).trim()
      if (tag === 'p' && inner.length > 0) {
        lines.push(inner)
        return
      }
      // div/section: recurse for nested block content
      for (const child of node.children) walkNode($, child, state, lines)
      return
    }
    case 'ul': case 'ol': {
      let index = 1
      const indent = '  '.repeat(state.depth)
      for (const child of node.children) {
        if (!isTagNode(child) || child.tagName.toLowerCase() !== 'li') continue
        const bullet = tag === 'ol' ? `${index++}.` : '-'
        // Direct inline content only (nested lists are processed below).
        const directParts: string[] = []
        for (const liChild of child.children) {
          if (isTagNode(liChild) && (liChild.tagName.toLowerCase() === 'ul' || liChild.tagName.toLowerCase() === 'ol')) continue
          directParts.push(collectInlineText($, liChild))
        }
        const liText = directParts.join('').trim()
        if (liText.length > 0) {
          lines.push(`${indent}${bullet} ${liText}`)
        }
        // Nested lists inside the li, indented one level deeper.
        for (const grand of child.children) {
          if (isTagNode(grand) && (grand.tagName.toLowerCase() === 'ul' || grand.tagName.toLowerCase() === 'ol')) {
            state.depth += 1
            walkNode($, grand, state, lines)
            state.depth -= 1
          }
        }
      }
      return
    }
    case 'blockquote': {
      const inner = collectInlineText($, node).trim()
      if (inner.length > 0) lines.push(inner.split('\n').map((line) => `> ${line}`).join('\n'))
      return
    }
    case 'hr': {
      lines.push('---')
      return
    }
    case 'table': {
      // Tables: render as plain text rows (rows of tab-joined cells).
      const rows: string[] = []
      $self.find('tr').each((_i, tr) => {
        const cells = $(tr).find('th, td').map((_j, cell) => $(cell).text().trim()).get()
        const row = cells.filter((cell) => cell.length > 0).join('\t')
        if (row.length > 0) rows.push(row)
      })
      if (rows.length > 0) lines.push(rows.join('\n'))
      return
    }
    default:
      for (const child of node.children) walkNode($, child, state, lines)
      return
  }
}

/** True for tags that render as inline (text-level) content. */
function isInlineTag(tag: string): boolean {
  return ['a', 'code', 'strong', 'b', 'em', 'i', 'u', 's', 'small', 'span', 'sub', 'sup', 'abbr', 'cite', 'q', 'img', 'br'].includes(tag)
}

/** Collect the inline text of a node's subtree (links as [t](u), code as `c`). */
function collectInlineText($: cheerio.CheerioAPI, node: AnyNode): string {
  const parts: string[] = []
  walkInline($, node, parts)
  return parts.join('')
}

function walkInline($: cheerio.CheerioAPI, node: AnyNode, parts: string[]): void {
  if (isTextNode(node)) {
    const text = node.data
    if (text.length > 0) parts.push(collapseWhitespace(text))
    return
  }
  if (!isTagNode(node)) return
  const tag = node.tagName.toLowerCase()
  if (STRIPPED_TAGS.has(tag)) return
  const $self = $(node)
  if (tag === 'a') {
    const href = $self.attr('href') ?? ''
    const text = plainText(node).trim()
    if (href.length > 0 && /^https?:/i.test(href) && text.length > 0) parts.push(`[${text}](${href})`)
    else if (text.length > 0) parts.push(text)
    return
  }
  if (tag === 'code') {
    const text = plainText(node).trim()
    if (text.length > 0) parts.push(`\`${text}\``)
    return
  }
  if (tag === 'img') {
    const src = $self.attr('src') ?? ''
    if (src.length > 0) parts.push(`![image](${src})`)
    return
  }
  if (tag === 'br') {
    parts.push(' ')
    return
  }
  for (const child of node.children) walkInline($, child, parts)
}

/** Collapse a string of whitespace runs to single spaces. */
function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ')
}

/**
 * Join accumulated markdown lines: paragraphs are separated by blank lines,
 * run-on lines are de-duplicated. `lines` entries are pre-trimmed fragments;
 * this function groups them into paragraphs by block boundaries.
 */
function collapse(lines: string[]): string {
  const out: string[] = []
  let buffer: string[] = []
  const flush = (): void => {
    if (buffer.length === 0) return
    const paragraph = buffer.join('\n')
    out.push(paragraph)
    buffer = []
  }
  for (const line of lines) {
    const match = line.match(/^(\s*)([\s\S]*)$/)
    const indent = match?.[1] ?? ''
    const body = (match?.[2] ?? '').replace(/\s+/g, ' ').trim()
    if (body.length === 0) {
      flush()
      continue
    }
    const isBlock =
      body.startsWith('#') ||
      body.startsWith('```') ||
      body.startsWith('- ') ||
      /^\d+\. /.test(body) ||
      body.startsWith('>') ||
      body.startsWith('---') ||
      body.startsWith('![') ||
      body.includes('\t')
    if (isBlock) {
      flush()
      out.push(`${indent}${body}`)
    } else {
      buffer.push(`${indent}${body}`)
    }
  }
  flush()
  // Blank-line separation between blocks; paragraphs stay internally tight.
  const result: string[] = []
  for (const block of out) {
    if (result.length > 0) result.push('')
    result.push(block)
  }
  return result.join('\n')
}
