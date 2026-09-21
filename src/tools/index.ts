/**
 * The core's model-facing tools as host-agnostic `ToolSpec`s (ADR-002/006):
 * `web_search`, `web_fetch`, `web_platform_search`, `web_history`,
 * `web_search_stats`, `web_cache_clear`. Host adapters convert the JSON-Schema
 * parameters to their schema language and enforce host output caps on top of
 * the core caps.
 *
 * Tool outputs are never thrown: `CoreError`s surface as `isError` outputs
 * with a stable `[CODE]: message` shape (adapters may still map `isError`
 * outputs to host errors — e.g. DSH re-throws via `toHostError`).
 * @module @agents-web-search/core/tools
 */

import { CoreError, errorCodeOf } from '../errors.ts'
import { htmlToMarkdown } from '../markdown.ts'
import { normalizeUrl } from '../search/url.ts'
import type { WebStore } from '../store/index.ts'
import type { ResolvedCoreConfig } from '../config.ts'
import type { FetchResult, LlmClient, PlatformSearchResult, SearchRequest, SearchResult, ToolOutput, ToolSpec } from '../types.ts'

/** The stack surface the tools need (implemented by {@link WebStack}). */
export interface ToolHost {
  readonly config: ResolvedCoreConfig
  readonly store: WebStore
  /** One single-query search (routing, cache, enrichment). */
  search(request: SearchRequest, signal?: AbortSignal): Promise<SearchResult>
  /** One raw fetch (SSRF-guarded, cached). */
  fetch(request: { readonly url: string }, signal?: AbortSignal): Promise<FetchResult>
  /** One platform search. */
  platformSearch(request: { readonly platform: string; readonly query: string; readonly maxResults?: number }, signal?: AbortSignal): Promise<PlatformSearchResult>
  /** Host LLM client (optional) — powers `web_fetch` question mode (5.1). */
  readonly llm?: LlmClient
}

/** The tool execution context (matches `ToolSpec.execute`). */
export interface ToolExecuteCtx {
  readonly signal: AbortSignal
  readonly onUpdate?: (partial: ToolOutput) => void
}

/** Wrap an execution body so CoreErrors become `isError` outputs. */
function guarded<A>(
  body: (args: A, ctx: ToolExecuteCtx) => Promise<ToolOutput>,
): (args: unknown, ctx: ToolExecuteCtx) => Promise<ToolOutput> {
  return async (args: unknown, ctx: ToolExecuteCtx): Promise<ToolOutput> => {
    try {
      return await body(args as A, ctx)
    } catch (error) {
      if (error instanceof CoreError) {
        return { text: `Error (${errorCodeOf(error)}): ${error.message}`, isError: true }
      }
      return {
        text: `Error (WEB_INTERNAL): ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      }
    }
  }
}

/** Minimal JSON-Schema validation for tool arguments (no schema library in core). */
function assertArray(args: unknown, field: string, min: number, max: number): unknown[] {
  if (!Array.isArray(args) || args.length < min || args.length > max || args.some((item) => typeof item !== 'string' || (item as string).length === 0)) {
    throw new CoreError(`${field} must be an array of ${min}-${max} non-empty strings`, 'WEB_BAD_REQUEST')
  }
  return args
}

function assertPositiveInt(args: unknown, field: string, max: number): number | undefined {
  if (args === undefined) return undefined
  if (typeof args !== 'number' || !Number.isInteger(args) || args < 1 || args > max) {
    throw new CoreError(`${field} must be an integer between 1 and ${max}`, 'WEB_BAD_REQUEST')
  }
  return args
}

function asRecord(args: unknown): Record<string, unknown> {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    throw new CoreError('tool arguments must be an object', 'WEB_BAD_REQUEST')
  }
  return args as Record<string, unknown>
}

/** Format one search result as model-facing text. */
function formatSearchResult(result: SearchResult, maxResults: number): string {
  const lines: string[] = []
  if (result.content !== undefined) {
    lines.push('Answer:')
    lines.push(result.content)
    lines.push('')
    lines.push('Sources:')
  }
  if (result.sources.length === 0) {
    lines.push('No results found.')
    return lines.join('\n')
  }
  result.sources.slice(0, maxResults).forEach((source, index) => {
    lines.push(`${index + 1}. ${source.title ?? source.url}`)
    lines.push(`   ${source.url}`)
    if (source.snippet !== undefined && source.snippet.length > 0) lines.push(`   ${source.snippet.slice(0, 300)}`)
  })
  if (result.truncated) lines.push(`(truncated to ${maxResults} sources)`)
  return lines.join('\n')
}

/** The `web_search` tool spec. */
export function buildSearchTool(host: ToolHost): ToolSpec {
  const defaultMax = 5
  return {
    name: 'web_search',
    description:
      'Search the web for current information. Accepts 1-4 queries (merged, deduplicated). ' +
      'Returns ranked sources with titles, URLs, snippets, and optionally a generated answer. ' +
      'For platform-specific search (github, reddit, youtube, bilibili, v2ex, rss) use web_platform_search.',
    parameters: {
      type: 'object',
      properties: {
        queries: {
          type: 'array',
          description: 'Search queries (1-4). Multiple queries are searched and merged (deduplicated).',
          items: { type: 'string' },
          minItems: 1,
          maxItems: 4,
        },
        max_results: { type: 'integer', description: 'Maximum number of sources to return (1-20).', minimum: 1, maximum: 20, default: 5 },
        recency: { type: 'string', enum: ['day', 'week', 'month', 'year'], description: 'Freshness hint (engines that support it honor it).' },
        domains: {
          type: 'array',
          description: 'Domain filters. Plain = include only; "-domain.com" = exclude.',
          items: { type: 'string' },
        },
        engine: { type: 'string', description: 'Force a specific engine id (e.g. "ddg", "bing", "exa"). Default: auto (configured engine list).' },
      },
      required: ['queries'],
      additionalProperties: false,
    },
    execute: guarded(async (args, { signal }): Promise<ToolOutput> => {
      const record = asRecord(args)
      const queries = assertArray(record['queries'], 'queries', 1, 4)
      const maxResults = assertPositiveInt(record['max_results'], 'max_results', 20) ?? defaultMax
      const domains = Array.isArray(record['domains']) && record['domains'].every((item) => typeof item === 'string')
        ? (record['domains'] as string[])
        : undefined
      const recency = typeof record['recency'] === 'string' ? (record['recency'] as 'day' | 'week' | 'month' | 'year') : undefined
      const engine = typeof record['engine'] === 'string' && record['engine'] !== 'auto' ? record['engine'] : undefined

      const merged: { url: string; title?: string; snippet?: string; publishedAt?: string }[] = []
      const seen = new Set<string>()
      const contents: string[] = []
      const enginesUsed = new Set<string>()
      const searchIds: number[] = []
      let anyTruncated = false
      let fromCache = false
      for (const query of queries) {
        const result = await host.search(
          {
            query: String(query),
            maxResults,
            ...(recency !== undefined ? { recency } : {}),
            ...(domains !== undefined ? { domains } : {}),
            ...(engine !== undefined ? { engine } : {}),
          },
          signal,
        )
        if (result.fromCache) fromCache = true
        if (result.searchId !== undefined) searchIds.push(result.searchId)
        if (result.truncated) anyTruncated = true
        for (const id of result.enginesUsed ?? []) enginesUsed.add(id)
        if (result.content !== undefined && result.content.length > 0) contents.push(result.content)
        for (const source of result.sources) {
          const key = normalizeUrl(source.url)
          if (seen.has(key)) continue
          seen.add(key)
          merged.push(source)
        }
      }
      const idsNote = searchIds.length > 0
        ? `\n\n[search id: ${searchIds.join(', ')} — full answer content via get_search_content {source: 'search', id: N}]`
        : ''
      const text = formatSearchResult(
        {
          sources: merged.slice(0, maxResults),
          ...contents.length > 0 ? { content: contents.join('\n\n').slice(0, 4000) } : {},
          truncated: anyTruncated || merged.length > maxResults,
        },
        maxResults,
      )
      return {
        text: text + idsNote,
        details: {
          queries,
          engines: [...enginesUsed],
          fromCache,
          sources: merged.slice(0, maxResults),
          ...searchIds.length > 0 ? { searchIds } : {},
        },
      }
    }),
  }
}

/** The `web_fetch` tool spec. */
export function buildFetchTool(host: ToolHost): ToolSpec {
  return {
    name: 'web_fetch',
    description:
      'Fetch a URL and return its readable content (HTML is converted to Markdown; PDFs are extracted locally). ' +
      'Use after web_search to read a specific page in full. ' +
      'With `question`, the host LLM answers the question from the fetched document (PDF/HTML).',
    maxOutputChars: host.config.fetch.maxOutputChars,
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Absolute http(s) URL to fetch.' },
        mode: {
          type: 'string',
          enum: ['readable', 'raw'],
          description: "'readable' (default): readable content as Markdown. 'raw': the decoded body as-is.",
        },
        question: {
          type: 'string',
          description:
            'Optional: a question about the fetched document (page or PDF). The host LLM answers it ' +
            'from the fetched content (requires the host LLM client; `question` is ignored in `raw` mode).',
        },
      },
      required: ['url'],
      additionalProperties: false,
    },
    execute: guarded(async (args, { signal }): Promise<ToolOutput> => {
      const record = asRecord(args)
      const url = typeof record['url'] === 'string' ? record['url'] : ''
      if (url.length === 0) throw new CoreError('url is required', 'WEB_BAD_REQUEST')
      const mode = record['mode'] === 'raw' ? 'raw' : 'readable'
      const question = typeof record['question'] === 'string' && record['question'].trim() !== '' ? record['question'].trim() : undefined
      const result = await host.fetch({ url }, signal)
      const raw = result.body.content
      let content: string
      if (mode === 'raw' || result.body.kind === 'text') {
        content = raw
      } else {
        content = htmlToMarkdown(raw)
      }
      const maxChars = host.config.fetch.maxOutputChars
      const truncated = result.truncated || content.length > maxChars
      if (content.length > maxChars) content = `${content.slice(0, maxChars)}\n[...truncated...]`
      const header = `Fetched ${result.url} (HTTP ${result.statusCode}, ${result.body.kind}${result.fromCache ? ', cache' : ''}, ${content.length} chars${truncated ? ', truncated' : ''})` +
        (result.pageId !== undefined ? ` [page id: ${result.pageId} — full document via get_search_content {source: 'page', id: ${result.pageId}}]` : '')
      if (question !== undefined && mode !== 'raw') {
        return answerFromLlm(host, question, content, result, header, signal)
      }
      return {
        text: `${header}\n${content}`,
        details: {
          url: result.url,
          statusCode: result.statusCode,
          kind: result.body.kind,
          fromCache: result.fromCache ?? false,
          truncated,
        },
      }
    }),
  }
}

/** get_search_content window (5.5): default/max chars and findText shape. */
const GET_CONTENT_DEFAULT_LIMIT = 20_000
const GET_CONTENT_MAX_LIMIT = 100_000
const GET_CONTENT_MAX_MATCHES = 3
const GET_CONTENT_MATCH_CONTEXT = 400

/**
 * The `get_search_content` tool (5.5): read the full content of a cached
 * search answer or fetched page by web store record id (the ids are printed
 * in the web_search / web_fetch output). `findText` searches the stored
 * content case-insensitively and returns context windows around the first
 * matches; otherwise an `offset`/`limit` character window is returned.
 */
export function buildGetSearchContentTool(host: ToolHost): ToolSpec {
  return {
    name: 'get_search_content',
    description:
      'Read the full cached content of a previous web_search answer or web_fetch document. ' +
      'Use the record id printed in the web_search / web_fetch output. ' +
      'Without findText returns a character window (offset/limit); with findText returns context windows around the first matches.',
    maxOutputChars: GET_CONTENT_MAX_LIMIT,
    parameters: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          enum: ['search', 'page'],
          description: "Which store: 'search' (a web_search answer) or 'page' (a fetched document).",
        },
        id: { type: 'integer', description: 'The web store record id printed by web_search / web_fetch.' },
        findText: {
          type: 'string',
          description: 'Optional case-insensitive substring to locate in the content (up to 3 matches, context windows around each).',
        },
        offset: {
          type: 'integer',
          description: 'Character offset for the window (ignored when findText is set). Default 0.',
          minimum: 0,
        },
        limit: {
          type: 'integer',
          description: 'Maximum characters to return (1-100000). Default 20000.',
          minimum: 1,
          maximum: GET_CONTENT_MAX_LIMIT,
        },
      },
      required: ['source', 'id'],
      additionalProperties: false,
    },
    execute: guarded(async (args): Promise<ToolOutput> => {
      const record = asRecord(args)
      const source = record['source'] === 'search' || record['source'] === 'page' ? record['source'] : undefined
      if (source === undefined) {
        throw new CoreError("source must be 'search' or 'page'", 'WEB_BAD_REQUEST')
      }
      const id =
        typeof record['id'] === 'number' && Number.isInteger(record['id']) && (record['id'] as number) >= 1
          ? (record['id'] as number)
          : (() => { throw new CoreError('id must be a positive integer', 'WEB_BAD_REQUEST') })()
      const findText = typeof record['findText'] === 'string' && (record['findText'] as string).length > 0
        ? (record['findText'] as string)
        : undefined
      const offset =
        record['offset'] === undefined
          ? 0
          : typeof record['offset'] === 'number' && Number.isInteger(record['offset']) && record['offset'] >= 0
            ? (record['offset'] as number)
            : (() => { throw new CoreError('offset must be a non-negative integer', 'WEB_BAD_REQUEST') })()
      const limit =
        record['limit'] === undefined
          ? GET_CONTENT_DEFAULT_LIMIT
          : typeof record['limit'] === 'number' && Number.isInteger(record['limit']) && record['limit'] >= 1 && record['limit'] <= GET_CONTENT_MAX_LIMIT
            ? (record['limit'] as number)
            : (() => {
                throw new CoreError(`limit must be an integer between 1 and ${GET_CONTENT_MAX_LIMIT}`, 'WEB_BAD_REQUEST')
              })()

      let content: string
      let title: string
      let truncated: boolean
      if (source === 'search') {
        const stored = await host.store.getSearch(id)
        if (stored === undefined) {
          throw new CoreError(`no search record with id ${id} in the web store`, 'WEB_BAD_REQUEST')
        }
        content = stored.content ?? ''
        title = `"${stored.query}"`
        truncated = stored.truncated
      } else {
        const stored = await host.store.getPage(id)
        if (stored === undefined) {
          throw new CoreError(`no page record with id ${id} in the web store`, 'WEB_BAD_REQUEST')
        }
        content = stored.body
        title = stored.url
        truncated = stored.truncated
      }
      const total = content.length
      const header =
        `${source === 'search' ? 'Search' : 'Page'} #${id} ${title} — ${total} chars stored` +
        `${truncated ? ' (truncated at fetch time)' : ''}`

      if (total === 0) {
        return { text: `${header}\n(no stored content for this record)` }
      }

      if (findText !== undefined) {
        const haystack = content.toLowerCase()
        const needle = findText.toLowerCase()
        if (needle.length === 0) throw new CoreError('findText must be non-empty', 'WEB_BAD_REQUEST')
        const matches: number[] = []
        let cursor = 0
        while (matches.length < GET_CONTENT_MAX_MATCHES) {
          const at = haystack.indexOf(needle, cursor)
          if (at === -1) break
          matches.push(at)
          cursor = at + needle.length
        }
        if (matches.length === 0) {
          return { text: `${header}\nno occurrences of "${findText}" in the stored content` }
        }
        const windows = matches.map((at, index) => {
          const start = Math.max(0, at - GET_CONTENT_MATCH_CONTEXT)
          const end = Math.min(total, at + findText.length + GET_CONTENT_MATCH_CONTEXT)
          const prefix = start > 0 ? '…' : ''
          const suffix = end < total ? '…' : ''
          return `[match ${index + 1}/${matches.length} at char ${at}]\n${prefix}${content.slice(start, end)}${suffix}`
        })
        const more = matches.length === GET_CONTENT_MAX_MATCHES && haystack.indexOf(needle, matches[matches.length - 1]! + needle.length) !== -1
          ? `\n[more matches exist; only the first ${GET_CONTENT_MAX_MATCHES} are shown]`
          : ''
        const text = `${header}\nmatches for "${findText}" (${matches.length} shown):\n\n${windows.join('\n\n')}${more}`
        const capped = text.length > GET_CONTENT_MAX_LIMIT ? `${text.slice(0, GET_CONTENT_MAX_LIMIT)}\n[...truncated...]` : text
        return { text: capped }
      }

      const clampedOffset = Math.min(offset, total)
      const windowText = content.slice(clampedOffset, clampedOffset + limit)
      const remainder = total - clampedOffset - windowText.length
      const tail = remainder > 0 ? `\n[...${remainder} more chars — continue with offset ${clampedOffset + windowText.length}]` : ''
      const text = `${header}\nwindow ${clampedOffset}-${clampedOffset + windowText.length}:\n${windowText}${tail}`
      return { text, details: { source, id, total, offset: clampedOffset, returned: windowText.length } }
    }),
  }
}

/** Document excerpt budget for the LLM question prompt (chars). */
const QUESTION_EXCERPT_CHARS = 60_000

/**
 * Question mode (5.1): answer `question` from the fetched document via the
 * host LLM client. Fails with `WEB_NOT_AVAILABLE` when the host provides no
 * `llm` member (fail-closed: a silently ignored `question` would be worse).
 * The fetched content is excerpted to `QUESTION_EXCERPT_CHARS` (the fetch
 * cache still holds the full document for a follow-up `web_fetch`).
 */
async function answerFromLlm(
  host: ToolHost,
  question: string,
  content: string,
  result: FetchResult,
  header: string,
  signal: AbortSignal,
): Promise<ToolOutput> {
  const llm = host.llm
  if (llm === undefined) {
    throw new CoreError(
      'web_fetch question mode requires the host LLM client (HostAdapter.llm), which this host does not provide',
      'WEB_NOT_AVAILABLE',
    )
  }
  const excerpt = content.length > QUESTION_EXCERPT_CHARS ? content.slice(0, QUESTION_EXCERPT_CHARS) + '\n[...document excerpt ends...]' : content
  const prompt =
    'You are answering a question strictly from the document provided below. ' +
    'If the document does not contain the answer, say so explicitly. Be concise; quote the document when it supports the answer.\n\n' +
    `Document (${result.url}):\n---\n${excerpt}\n---\n\nQuestion: ${question}`
  const completion = await llm.complete({ prompt, maxTokens: 1024, signal })
  const answer = completion.text.trim()
  const truncated = answer.length > host.config.fetch.maxOutputChars
  const text = truncated ? `${answer.slice(0, host.config.fetch.maxOutputChars)}\n[...truncated...]` : answer
  return {
    text: `${header}\n\nAnswer to "${question}"${completion.model !== undefined ? ` (model: ${completion.model})` : ''}:\n${text}`,
    details: {
      url: result.url,
      statusCode: result.statusCode,
      kind: result.body.kind,
      fromCache: result.fromCache ?? false,
      question,
      model: completion.model ?? null,
    },
  }
}

/** The `web_platform_search` tool spec. */
export function buildPlatformSearchTool(host: ToolHost): ToolSpec {
  return {
    name: 'web_platform_search',
    description:
      'Search a specific platform (github, reddit, youtube, bilibili, v2ex, rss, plus configured platforms). ' +
      'For the rss platform the query is a feed URL.',
    parameters: {
      type: 'object',
      properties: {
        platform: { type: 'string', description: 'Platform id (e.g. "github", "reddit", "rss").' },
        query: { type: 'string', description: 'The search query; for rss, the feed URL.' },
        max_results: { type: 'integer', description: 'Maximum number of results (1-20).', minimum: 1, maximum: 20 },
      },
      required: ['platform', 'query'],
      additionalProperties: false,
    },
    execute: guarded(async (args, { signal }): Promise<ToolOutput> => {
      const record = asRecord(args)
      const platform = typeof record['platform'] === 'string' ? record['platform'] : ''
      const query = typeof record['query'] === 'string' ? record['query'] : ''
      if (platform.length === 0 || query.length === 0) throw new CoreError('platform and query are required', 'WEB_BAD_REQUEST')
      const maxResults = assertPositiveInt(record['max_results'], 'max_results', 20)
      const result = await host.platformSearch({ platform, query, ...(maxResults !== undefined ? { maxResults } : {}) }, signal)
      const lines: string[] = [`Platform search: ${result.platform} — ${result.query} (${result.sources.length} results)`]
      for (const [index, source] of result.sources.entries()) {
        lines.push(`${index + 1}. ${source.title ?? source.url}`)
        lines.push(`   ${source.url}`)
        if (source.snippet !== undefined && source.snippet.length > 0) lines.push(`   ${source.snippet.slice(0, 300)}`)
      }
      if (result.truncated) lines.push('(truncated)')
      return { text: lines.join('\n'), details: { platform: result.platform, sources: result.sources } }
    }),
  }
}

/** The `web_history` tool spec. */
export function buildHistoryTool(host: ToolHost): ToolSpec {
  return {
    name: 'web_history',
    description: 'Show recent web search/fetch history from the local store (no network).',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['search', 'fetch', 'all'], description: 'History kind. Default: all.' },
        query: { type: 'string', description: 'Optional substring filter.' },
        limit: { type: 'integer', description: 'Maximum entries (1-100). Default 20.', minimum: 1, maximum: 100 },
      },
    },
    execute: guarded(async (args): Promise<ToolOutput> => {
      const record = asRecord(args)
      const kind = record['kind'] === 'search' || record['kind'] === 'fetch' || record['kind'] === 'all' ? record['kind'] : 'all'
      const filter = typeof record['query'] === 'string' ? record['query'].toLowerCase() : ''
      const limit = Math.min(Math.max(Math.trunc((record['limit'] as number | undefined) ?? 20), 1), 100)
      const lines: string[] = []
      if (kind === 'search' || kind === 'all') {
        const searches = await host.store.recentSearches(limit)
        for (const row of searches) {
          if (filter.length > 0 && !row.query.toLowerCase().includes(filter)) continue
          const sources = row.sources as readonly { url?: unknown }[]
          lines.push(`[${new Date(row.createdAt).toISOString()}] search: ${row.query} → ${sources.length} sources (engines: ${row.engines.join(',')})`)
        }
      }
      if (kind === 'fetch' || kind === 'all') {
        const pages = await host.store.recentPages(limit)
        for (const row of pages) {
          if (filter.length > 0 && !row.url.toLowerCase().includes(filter)) continue
          lines.push(`[${new Date(row.fetchedAt).toISOString()}] fetch: ${row.url} → HTTP ${row.statusCode} (${row.bodyKind}, ${row.body.length} chars${row.truncated ? ', truncated' : ''})`)
        }
      }
      if (lines.length === 0) return { text: 'No matching history entries.' }
      return { text: lines.join('\n') }
    }),
  }
}

/** The `web_search_stats` tool spec. */
export function buildStatsTool(host: ToolHost): ToolSpec {
  return {
    name: 'web_search_stats',
    description: 'Show web store statistics (stored searches, pages, bytes). No network requests.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    execute: guarded(async (): Promise<ToolOutput> => {
      const stats = await host.store.stats()
      const lines = [
        `Stored searches: ${stats.searches}${stats.lastSearchAt !== undefined ? ` (last: ${new Date(stats.lastSearchAt).toISOString()})` : ''}`,
        `Stored pages: ${stats.pages}${stats.lastPageAt !== undefined ? ` (last: ${new Date(stats.lastPageAt).toISOString()})` : ''}`,
        `Page bytes: ${stats.pageBytes}`,
        `Store: ${host.config.store.path}`,
      ]
      return { text: lines.join('\n'), details: stats }
    }),
  }
}

/** The `web_cache_clear` tool spec. */
export function buildCacheClearTool(host: ToolHost): ToolSpec {
  return {
    name: 'web_cache_clear',
    description: 'Clear the local web search/page cache. No network requests.',
    parameters: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['search', 'pages', 'all'], description: 'What to clear. Default: all.' },
      },
    },
    execute: guarded(async (args): Promise<ToolOutput> => {
      const record = asRecord(args)
      const scope = record['scope'] === 'search' || record['scope'] === 'pages' || record['scope'] === 'all' ? record['scope'] : 'all'
      const lines: string[] = []
      if (scope === 'search' || scope === 'all') lines.push(`Cleared ${await host.store.clearSearches()} search records.`)
      if (scope === 'pages' || scope === 'all') lines.push(`Cleared ${await host.store.clearPages()} page records.`)
      return { text: lines.join(' ') }
    }),
  }
}

/** The `web_curator` tool spec (roadmap 5.4): start/status/stop the local
 * curator UI server. The running server is kept per host (WeakMap). */
export function buildCuratorTool(host: ToolHost): ToolSpec {
  const servers = new WeakMap<object, import('../curator/index.ts').CuratorHandle>()
  return {
    name: 'web_curator',
    description:
      'Manage the local curator UI: a token-protected 127.0.0.1 web page where a human can review recent ' +
      'web searches and fetched pages, generate LLM summaries, and discard entries. ' +
      "action 'start' returns the URL (with token) to open in a browser; 'status' reports the running server; " +
      "'stop' closes it.",
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['start', 'status', 'stop'],
          description: "start | status | stop the curator server.",
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
    execute: guarded(async (args: { action?: unknown }, _ctx) => {
      const action = typeof args.action === 'string' ? args.action : undefined
      if (action !== 'start' && action !== 'status' && action !== 'stop') {
        throw new CoreError('action must be "start", "status", or "stop"', 'WEB_BAD_REQUEST')
      }
      const running = servers.get(host)
      if (action === 'status') {
        if (running === undefined) return { text: 'No curator server is running. Use action "start" first.' }
        return { text: `Curator running at ${running.url}` }
      }
      if (action === 'stop') {
        if (running === undefined) return { text: 'No curator server is running.' }
        servers.delete(host)
        await running.close()
        return { text: `Curator server stopped (port ${running.port}).` }
      }
      if (running !== undefined) return { text: `Curator already running at ${running.url}` }
      const { startCuratorServer } = await import('../curator/index.ts')
      const handle = await startCuratorServer({
        store: host.store,
        llm: host.llm,
        bind: host.config.extended.curator.bind,
        maxEntries: 50,
      })
      servers.set(host, handle)
      const lines = [
        `Curator started at ${handle.url}`,
        'Open the URL in a browser to review searches/pages (Summarize needs a host LLM client; it fails closed without one).',
        `Stop it later with action "stop".`,
      ]
      if (host.config.extended.curator.remote) {
        lines.push(
          'NOTE: remote curator access is configured but deferred in v0.1 — the server is bound to ' +
          'loopback only (127.0.0.1) and speaks plain HTTP with no TLS; keep it local and do not ' +
          'port-forward the token URL.',
        )
      }
      return { text: lines.join('\n') }
    }),
  }
}

/** Build all v1.0 tool specs for the host. */
export function buildCoreTools(host: ToolHost): ToolSpec[] {
  const tools: ToolSpec[] = [
    buildSearchTool(host),
    buildFetchTool(host),
    buildGetSearchContentTool(host),
    buildPlatformSearchTool(host),
    buildHistoryTool(host),
    buildStatsTool(host),
    buildCacheClearTool(host),
  ]
  if (host.config.extended.curator.enabled) tools.push(buildCuratorTool(host))
  return host.config.platforms.enabled === false
    ? tools.filter((tool) => tool.name !== 'web_platform_search')
    : tools
}
