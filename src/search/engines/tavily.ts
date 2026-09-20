/**
 * `TavilyEngine`: the Tavily search API as a core engine. The API key is
 * resolved per search through the engine's secret resolver (host credentials
 * domain / env fallback; ADR-002 §6).
 * @module @agents-web-search/core/search/engines/tavily
 */

import { CoreError } from '../../errors.ts'
import { classifyWebError, readCappedText } from '../http.ts'
import { normalizeUrl } from '../url.ts'
import type { SearchSource } from '../../types.ts'
import type { EngineSearchResult, SearchEngine, SearchEngineDeps } from './types.ts'

/** Default Tavily API base. */
export const TAVILY_DEFAULT_BASE_URL = 'https://api.tavily.com'

/** Engine options. */
export interface TavilyEngineOptions extends SearchEngineDeps {
  readonly apiKey?: string
  readonly baseUrl?: string
  /** Search depth. */
  readonly depth?: 'basic' | 'advanced'
}

interface TavilyResult {
  readonly url?: unknown
  readonly title?: unknown
  readonly content?: unknown
  readonly published_date?: unknown
}

interface TavilyResponse {
  readonly results?: readonly TavilyResult[]
  readonly answer?: unknown
}

/** The Tavily API search engine. */
export class TavilyEngine implements SearchEngine {
  readonly id = 'tavily'
  private readonly options: TavilyEngineOptions
  private cachedKey = ''

  constructor(options: TavilyEngineOptions) {
    this.options = options
    this.cachedKey = options.apiKey ?? ''
  }

  available(): boolean {
    return this.cachedKey.length > 0 || this.options.resolveSecret !== undefined
  }

  async search(query: string, maxResults: number, signal: AbortSignal): Promise<EngineSearchResult> {
    if (this.options.resolveSecret !== undefined) {
      const resolved = await this.options.resolveSecret({
        name: 'websearch:tavily',
        explicit: this.options.apiKey,
        env: 'TAVILY_API_KEY',
      }) ?? ''
      if (resolved !== this.cachedKey) this.cachedKey = resolved
    }
    if (this.cachedKey.length === 0) {
      throw new CoreError('the tavily engine is enabled, but no API key is available (config, credentials, or TAVILY_API_KEY)', 'WEB_AUTH')
    }
    const base = (this.options.baseUrl ?? TAVILY_DEFAULT_BASE_URL).replace(/\/+$/, '')
    const body = {
      query,
      max_results: maxResults,
      search_depth: this.options.depth ?? 'basic',
      include_answer: true,
    }
    let response: Response
    try {
      response = await fetch(`${base}/search`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'authorization': `Bearer ${this.cachedKey}`, 'user-agent': this.options.userAgent },
        body: JSON.stringify(body),
        signal,
      })
    } catch (error) {
      throw classifyWebError(error, signal, 'Tavily search request failed')
    }
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel()
      throw new CoreError(`Tavily rejected the API key (HTTP ${response.status})`, 'WEB_AUTH', { cause: response })
    }
    if (response.status === 429) {
      await response.body?.cancel()
      throw new CoreError('Tavily rate limit exceeded (HTTP 429)', 'WEB_QUOTA', { cause: response })
    }
    if (!response.ok) {
      await response.body?.cancel()
      throw new CoreError(`Tavily search request failed (HTTP ${response.status})`, 'WEB_PROVIDER_ERROR', { cause: response })
    }
    let text: string
    try {
      text = await readCappedText(response, 1_048_576)
    } catch (error) {
      throw classifyWebError(error, signal, 'Tavily search body read failed')
    }
    let parsed: TavilyResponse
    try {
      parsed = JSON.parse(text) as TavilyResponse
    } catch (error) {
      throw new CoreError('Tavily returned a non-JSON response', 'WEB_PARSE_ERROR', { cause: error })
    }
    const sources = this.filterAndDedupe(parsed.results ?? [])
    const content = typeof parsed.answer === 'string' && parsed.answer.length > 0 ? parsed.answer : undefined
    return { sources, ...content !== undefined ? { content } : {} }
  }

  private filterAndDedupe(results: readonly TavilyResult[]): SearchSource[] {
    const seen = new Set<string>()
    const sources: SearchSource[] = []
    for (const result of results) {
      if (typeof result.url !== 'string' || result.url.length === 0) continue
      const key = normalizeUrl(result.url)
      if (seen.has(key)) continue
      seen.add(key)
      sources.push({
        url: result.url,
        ...(typeof result.title === 'string' && result.title.length > 0 ? { title: result.title } : {}),
        ...(typeof result.content === 'string' && result.content.length > 0
          ? { snippet: result.content.slice(0, 300) }
          : {}),
      })
    }
    return sources
  }
}
