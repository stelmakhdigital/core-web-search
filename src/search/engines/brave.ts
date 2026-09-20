/**
 * `BraveEngine`: the Brave Web Search API as a core engine (free tier for
 * personal keys; the router treats quota failures as cooldowns).
 * @module @agents-web-search/core/search/engines/brave
 */

import { CoreError } from '../../errors.ts'
import { classifyWebError, readCappedText } from '../http.ts'
import { normalizeUrl } from '../url.ts'
import type { SearchSource } from '../../types.ts'
import type { EngineSearchResult, SearchEngine, SearchEngineDeps } from './types.ts'

/** Default Brave Search API base. */
export const BRAVE_DEFAULT_BASE_URL = 'https://api.search.brave.com'

/** Engine options. */
export interface BraveEngineOptions extends SearchEngineDeps {
  readonly apiKey?: string
  readonly baseUrl?: string
  readonly country?: string
  readonly freshness?: string
}

interface BraveWebResult {
  readonly url?: unknown
  readonly title?: unknown
  readonly description?: unknown
  readonly page_age?: unknown
}

interface BraveResponse {
  readonly web?: { readonly results?: readonly BraveWebResult[] }
}

/** Map the core freshness hint to Brave's `freshness` parameter. */
export function braveFreshness(freshness: string): string {
  switch (freshness) {
    case '24h': return 'pd'
    case 'week': return 'pw'
    case 'month': return 'pm'
    case 'year': return 'py'
    default: return ''
  }
}

/** The Brave Web Search API engine. */
export class BraveEngine implements SearchEngine {
  readonly id = 'brave'
  private readonly options: BraveEngineOptions
  private cachedKey = ''

  constructor(options: BraveEngineOptions) {
    this.options = options
    this.cachedKey = options.apiKey ?? ''
  }

  available(): boolean {
    return this.cachedKey.length > 0 || this.options.resolveSecret !== undefined
  }

  async search(query: string, maxResults: number, signal: AbortSignal): Promise<EngineSearchResult> {
    if (this.options.resolveSecret !== undefined) {
      const resolved = await this.options.resolveSecret({
        name: 'websearch:brave',
        explicit: this.options.apiKey,
        env: 'BRAVE_API_KEY',
      }) ?? ''
      if (resolved !== this.cachedKey) this.cachedKey = resolved
    }
    if (this.cachedKey.length === 0) {
      throw new CoreError('the brave engine is enabled, but no API key is available (config, credentials, or BRAVE_API_KEY)', 'WEB_AUTH')
    }
    const base = (this.options.baseUrl ?? BRAVE_DEFAULT_BASE_URL).replace(/\/+$/, '')
    const params = new URLSearchParams({ q: query, count: String(Math.min(maxResults, 20)) })
    if (this.options.country !== undefined && this.options.country.length > 0) params.set('country', this.options.country)
    const freshness = braveFreshness(this.options.freshness ?? '')
    if (freshness.length > 0) params.set('freshness', freshness)
    const url = `${base}/res/v1/web/search?${params.toString()}`
    let response: Response
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: {
          'accept': 'application/json',
          'accept-Encoding': 'gzip',
          'X-Subscription-Token': this.cachedKey,
          'user-agent': this.options.userAgent,
        },
        signal,
      })
    } catch (error) {
      throw classifyWebError(error, signal, 'Brave search request failed')
    }
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel()
      throw new CoreError(`Brave rejected the API key (HTTP ${response.status})`, 'WEB_AUTH', { cause: response })
    }
    if (response.status === 429) {
      await response.body?.cancel()
      throw new CoreError('Brave rate limit exceeded (HTTP 429)', 'WEB_QUOTA', { cause: response })
    }
    if (!response.ok) {
      await response.body?.cancel()
      throw new CoreError(`Brave search request failed (HTTP ${response.status})`, 'WEB_PROVIDER_ERROR', { cause: response })
    }
    let text: string
    try {
      text = await readCappedText(response, 1_048_576)
    } catch (error) {
      throw classifyWebError(error, signal, 'Brave search body read failed')
    }
    let parsed: BraveResponse
    try {
      parsed = JSON.parse(text) as BraveResponse
    } catch (error) {
      throw new CoreError('Brave returned a non-JSON response', 'WEB_PARSE_ERROR', { cause: error })
    }
    return { sources: this.filterAndDedupe(parsed.web?.results ?? []) }
  }

  private filterAndDedupe(results: readonly BraveWebResult[]): SearchSource[] {
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
        ...(typeof result.description === 'string' && result.description.length > 0
          ? { snippet: result.description }
          : {}),
        ...(typeof result.page_age === 'string' && result.page_age.length > 0
          ? { publishedAt: result.page_age }
          : {}),
      })
    }
    return sources
  }
}
