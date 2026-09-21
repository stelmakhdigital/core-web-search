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
      const text = formatSearchResult(
        {
          sources: merged.slice(0, maxResults),
          ...contents.length > 0 ? { content: contents.join('\n\n').slice(0, 4000) } : {},
          truncated: anyTruncated || merged.length > maxResults,
        },
        maxResults,
      )
      return {
        text,
        details: {
          queries,
          engines: [...enginesUsed],
          fromCache,
          sources: merged.slice(0, maxResults),
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
      const header = `Fetched ${result.url} (HTTP ${result.statusCode}, ${result.body.kind}${result.fromCache ? ', cache' : ''}, ${content.length} chars${truncated ? ', truncated' : ''})`
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
      return { text: lines.join('\n') }
    }),
  }
}

/** Build all v1.0 tool specs for the host. */
export function buildCoreTools(host: ToolHost): ToolSpec[] {
  const tools: ToolSpec[] = [
    buildSearchTool(host),
    buildFetchTool(host),
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
