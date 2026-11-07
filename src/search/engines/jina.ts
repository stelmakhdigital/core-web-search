/**
 * `JinaEngine`: a search engine backed by the Jina search API
 * (`https://s.jina.ai/{query}`). Requires a Jina API key, resolved from the
 * config override or the launch environment at plugin `apply` time and
 * re-resolved per search when a resolver is set (the credentials domain, so
 * a key written there takes effect without a restart).
 *
 * `available()` reports *potentially* available: true when a static key is
 * present OR a resolver is set (the resolver may yield a key at search time).
 * A search issued without any key fails with a provider error, which the
 * router's cooldown handles — the engine is not silently skipped.
 * @module @agents-web-search/core/search/engines/jina
 */

import { CoreError } from '../../errors.ts'
import type { SearchSource } from '../../types.ts'
import { apiStatusErrors, HttpSearchClient } from '../http.ts'
import type { EngineSearchResult, SearchEngine, SearchEngineDeps } from './types.ts'

/** Engine options. */
export interface JinaEngineOptions extends SearchEngineDeps {
  /** Resolved Jina API key (empty is fine when the resolver may yield one). */
  readonly apiKey?: string
  /** Endpoint base; the query path is appended. */
  readonly baseURL?: string
  /** Hard cap on one response body (bytes). */
  readonly maxResponseBytes: number
}

/** Default Jina search endpoint base. */
export const JINA_DEFAULT_BASE_URL = 'https://s.jina.ai'

/** One item of the Jina search JSON response. */
interface JinaSearchItem {
  title?: string
  url?: string
  content?: string
  description?: string
}

/** The Jina API search engine. */
export class JinaEngine implements SearchEngine {
  readonly id = 'jina'
  private readonly http: HttpSearchClient

  constructor(private readonly options: JinaEngineOptions) {
    this.http = new HttpSearchClient({ userAgent: options.userAgent })
  }

  /** Available when a key is present (static, or a resolver that may yield one). */
  available(): boolean {
    const hasKey = (this.options.apiKey?.length ?? 0) > 0 || this.options.resolveSecret !== undefined
    return hasKey && URL.canParse(this.options.baseURL ?? JINA_DEFAULT_BASE_URL)
  }

  /** Run one search against the Jina API. */
  async search(query: string, maxResults: number, signal: AbortSignal): Promise<EngineSearchResult> {
    let apiKey = this.options.apiKey ?? ''
    if (this.options.resolveSecret !== undefined) {
      const resolved = await this.options.resolveSecret({ name: 'websearch:jina', explicit: apiKey, env: 'JINA_API_KEY' })
      if (resolved !== undefined && resolved.length > 0) apiKey = resolved
    }
    if (apiKey.length === 0) {
      throw new CoreError('the jina engine is enabled, but no API key is available (config, credentials, or JINA_API_KEY)', 'WEB_AUTH')
    }
    const url = `${(this.options.baseURL ?? JINA_DEFAULT_BASE_URL).replace(/\/$/, '')}/${encodeURIComponent(query)}`
    const body = await this.http.fetchText({
      url,
      headers: {
        'authorization': `Bearer ${apiKey}`,
        'accept': 'application/json',
        'x-retain-images': 'false',
      },
      signal,
      maxBytes: this.options.maxResponseBytes,
      context: 'Jina search request',
      mapStatus: apiStatusErrors('Jina', [402]),
    })
    let parsed: { data?: JinaSearchItem[] }
    try {
      parsed = JSON.parse(body) as { data?: JinaSearchItem[] }
    } catch (error: unknown) {
      throw new CoreError(`Jina search returned a non-JSON response: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
    const sources: SearchSource[] = []
    for (const item of parsed.data ?? []) {
      if (item.url === undefined || item.url.length === 0) continue
      sources.push({
        url: item.url,
        ...(item.title !== undefined && item.title.length > 0 ? { title: item.title } : {}),
        ...(item.description !== undefined && item.description.length > 0
          ? { snippet: item.description }
          : item.content !== undefined && item.content.length > 0
            ? { snippet: item.content.slice(0, 300) }
            : {}),
      })
      if (sources.length >= maxResults) break
    }
    return { sources }
  }
}
