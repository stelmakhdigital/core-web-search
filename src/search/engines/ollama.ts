/**
 * `OllamaEngine`: web search through a local Ollama instance
 * (`POST /api/experimental/web_search`). A configured local endpoint is
 * trusted by definition (same semantics as the SearXNG self-hosted engine:
 * the user chose the endpoint, so the SSRF guard does not apply).
 * @module @agents-web-search/core/search/engines/ollama
 */

import { CoreError } from '../../errors.ts'
import { HttpSearchClient } from '../http.ts'
import { normalizeUrl } from '../url.ts'
import type { SearchSource } from '../../types.ts'
import type { EngineSearchResult, SearchEngine, SearchEngineDeps } from './types.ts'

/** Default local Ollama host. */
export const OLLAMA_DEFAULT_ENDPOINT = 'http://localhost:11434'

/** Engine options. */
export interface OllamaEngineOptions extends SearchEngineDeps {
  /** Local Ollama base endpoint. */
  readonly endpoint?: string
}

interface OllamaSearchResult {
  readonly title?: unknown
  readonly url?: unknown
  readonly content?: unknown
}

interface OllamaSearchResponse {
  readonly results?: readonly OllamaSearchResult[]
}

/** The local Ollama web-search engine. */
export class OllamaEngine implements SearchEngine {
  readonly id = 'ollama'
  private readonly options: OllamaEngineOptions
  private readonly http: HttpSearchClient

  constructor(options: OllamaEngineOptions) {
    this.options = options
    this.http = new HttpSearchClient({ userAgent: options.userAgent })
  }

  private endpoint(): string {
    return (this.options.endpoint ?? OLLAMA_DEFAULT_ENDPOINT).replace(/\/+$/, '')
  }

  /** Cheap local check: the endpoint must parse as an absolute http(s) URL. */
  available(): boolean {
    return URL.canParse(this.endpoint())
  }

  async search(query: string, maxResults: number, signal: AbortSignal): Promise<EngineSearchResult> {
    let text: string
    try {
      text = await this.http.fetchText({
        url: `${this.endpoint()}/api/experimental/web_search`,
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query, max_results: maxResults }),
        signal,
        maxBytes: 1_048_576,
        context: 'Ollama search request',
        mapStatus: (status) => {
          if (status === 401) {
            return new CoreError('Ollama web search requires authentication (run `ollama signin`)', 'WEB_AUTH')
          }
          return new CoreError(`Ollama web search failed (HTTP ${status})`, 'WEB_PROVIDER_ERROR')
        },
      })
    } catch (error) {
      if (error instanceof CoreError && error.code === 'WEB_NETWORK') {
        throw new CoreError(
          `could not reach the Ollama instance at ${this.endpoint()} (is it running with web search enabled?)`,
          'WEB_NETWORK',
          { cause: error },
        )
      }
      throw error
    }
    let parsed: OllamaSearchResponse
    try {
      parsed = JSON.parse(text) as OllamaSearchResponse
    } catch (error) {
      throw new CoreError('Ollama returned a non-JSON response', 'WEB_PARSE_ERROR', { cause: error })
    }
    const seen = new Set<string>()
    const sources: SearchSource[] = []
    for (const result of parsed.results ?? []) {
      const url = typeof result.url === 'string' ? result.url : ''
      if (url.length === 0 || !URL.canParse(url)) continue
      const key = normalizeUrl(url)
      if (seen.has(key)) continue
      seen.add(key)
      sources.push({
        url,
        ...(typeof result.title === 'string' && result.title.length > 0 ? { title: result.title } : {}),
        ...(typeof result.content === 'string' && result.content.length > 0
          ? { snippet: result.content.slice(0, 300) }
          : {}),
      })
      if (sources.length >= maxResults) break
    }
    return { sources }
  }
}
