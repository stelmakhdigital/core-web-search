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
import { classifyWebError, readCappedText } from '../http.ts'
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

  constructor(private readonly options: JinaEngineOptions) {}

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
    let response: Response
    try {
      response = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        headers: {
          'user-agent': this.options.userAgent,
          'authorization': `Bearer ${apiKey}`,
          'accept': 'application/json',
          'x-retain-images': 'false',
        },
        signal,
      })
    } catch (error: unknown) {
      throw classifyWebError(error, signal, 'Jina search request failed')
    }
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel()
      throw new CoreError(`Jina rejected the API key (HTTP ${response.status})`, 'WEB_AUTH', { cause: response })
    }
    if (response.status === 402 || response.status === 429) {
      await response.body?.cancel()
      throw new CoreError(`Jina quota/rate limit exceeded (HTTP ${response.status})`, 'WEB_QUOTA', { cause: response })
    }
    if (!response.ok) {
      await response.body?.cancel()
      throw new CoreError(`Jina search request failed (HTTP ${response.status})`, 'WEB_PROVIDER_ERROR', { cause: response })
    }
    let body: string
    try {
      body = await readCappedText(response, this.options.maxResponseBytes)
    } catch (error: unknown) {
      throw classifyWebError(error, signal, 'Jina search body read failed')
    }
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
