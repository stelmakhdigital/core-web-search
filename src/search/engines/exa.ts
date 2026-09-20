/**
 * `ExaEngine`: the Exa search API as a core engine (native HTTP client —
 * the core must not depend on host packages, ADR-002/Q9). The API key is
 * resolved per search through the engine's secret resolver, so a key written
 * to the host credentials domain takes effect without a restart.
 *
 * `available()` reports *potentially* available: true when a static key is
 * present OR a resolver is set (the resolver may yield a key at search time).
 * A search issued without any key fails with `WEB_AUTH`, which the router's
 * cooldown handles — the engine is not silently skipped.
 * @module @agents-web-search/core/search/engines/exa
 */

import { CoreError } from '../../errors.ts'
import { classifyWebError, readCappedText } from '../http.ts'
import { normalizeUrl } from '../url.ts'
import type { SearchSource } from '../../types.ts'
import type { EngineSearchResult, SearchEngine, SearchEngineDeps } from './types.ts'

/** Default Exa API base ( `/search` is appended). */
export const EXA_DEFAULT_BASE_URL = 'https://api.exa.ai'

/** Engine options. */
export interface ExaEngineOptions extends SearchEngineDeps {
  /** Explicit API key (lowest precedence; the resolver wins when it yields a value). */
  readonly apiKey?: string
  /** Endpoint base; `/search` is appended. */
  readonly baseUrl?: string
  /** Retrieval mode sent as Exa's `type`. */
  readonly searchType?: 'auto' | 'keyword' | 'neural'
  /** Highlight sentences requested per result. */
  readonly highlightsPerResult?: number
}

interface ExaApiResponseResult {
  readonly url?: unknown
  readonly title?: unknown
  readonly snippet?: unknown
  readonly publishedDate?: unknown
  readonly published_date?: unknown
}

interface ExaApiResponse {
  readonly results?: readonly ExaApiResponseResult[]
  readonly answer?: unknown
}

/** The Exa API search engine. */
export class ExaEngine implements SearchEngine {
  readonly id = 'exa'
  private readonly options: ExaEngineOptions
  private cachedKey = ''

  constructor(options: ExaEngineOptions) {
    this.options = options
    this.cachedKey = options.apiKey ?? ''
  }

  /** Available when a key is present (static, or a resolver that may yield one). */
  available(): boolean {
    return this.cachedKey.length > 0 || this.options.resolveSecret !== undefined
  }

  /** Run one Exa search (key resolved per search when a resolver is set). */
  async search(query: string, maxResults: number, signal: AbortSignal): Promise<EngineSearchResult> {
    if (this.options.resolveSecret !== undefined) {
      const resolved = await this.options.resolveSecret({
        name: 'websearch:exa',
        explicit: this.options.apiKey,
        env: 'EXA_API_KEY',
      }) ?? ''
      if (resolved !== this.cachedKey) this.cachedKey = resolved
    }
    if (this.cachedKey.length === 0) {
      throw new CoreError('the exa engine is enabled, but no API key is available (config, credentials, or EXA_API_KEY)', 'WEB_AUTH')
    }
    const base = (this.options.baseUrl ?? EXA_DEFAULT_BASE_URL).replace(/\/+$/, '')
    const body = {
      query,
      numResults: maxResults,
      type: this.options.searchType ?? 'auto',
      contents: { text: { highlights: { numSentences: this.options.highlightsPerResult ?? 3 } } },
    }
    let response: Response
    try {
      response = await fetch(`${base}/search`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.cachedKey,
          'user-agent': this.options.userAgent,
        },
        body: JSON.stringify(body),
        signal,
      })
    } catch (error) {
      throw classifyWebError(error, signal, 'Exa search request failed')
    }
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel()
      throw new CoreError(`Exa rejected the API key (HTTP ${response.status})`, 'WEB_AUTH', { cause: response })
    }
    if (response.status === 429) {
      await response.body?.cancel()
      throw new CoreError('Exa rate limit exceeded (HTTP 429)', 'WEB_QUOTA', { cause: response })
    }
    if (!response.ok) {
      await response.body?.cancel()
      throw new CoreError(`Exa search request failed (HTTP ${response.status})`, 'WEB_PROVIDER_ERROR', { cause: response })
    }
    let text: string
    try {
      text = await readCappedText(response, 1_048_576)
    } catch (error) {
      throw classifyWebError(error, signal, 'Exa search body read failed')
    }
    let parsed: ExaApiResponse
    try {
      parsed = JSON.parse(text) as ExaApiResponse
    } catch (error) {
      throw new CoreError('Exa returned a non-JSON response', 'WEB_PARSE_ERROR', { cause: error })
    }
    const sources = this.filterAndDedupe(parsed.results ?? [])
    const content = typeof parsed.answer === 'string' && parsed.answer.length > 0 ? parsed.answer : undefined
    return { sources, ...content !== undefined ? { content } : {} }
  }

  /** Drop entries without a usable URL and duplicate URLs (first occurrence wins). */
  private filterAndDedupe(results: readonly ExaApiResponseResult[]): SearchSource[] {
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
        ...(typeof result.snippet === 'string' && result.snippet.length > 0 ? { snippet: result.snippet } : {}),
        ...(typeof (result.publishedDate ?? result.published_date) === 'string'
          ? { publishedAt: String(result.publishedDate ?? result.published_date) }
          : {}),
      })
    }
    return sources
  }
}
