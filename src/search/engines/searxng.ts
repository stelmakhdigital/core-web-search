/**
 * `SearXNGEngine`: a self-hosted metasearch engine backed by a SearXNG
 * instance's JSON API. SearXNG aggregates multiple search engines (Google,
 * Bing, DuckDuckGo, etc.) behind a single local endpoint, so the plugin gets
 * multi-engine results without calling any external API or data broker.
 *
 * The JSON API must be enabled on the SearXNG instance (`search.formats:
 * [html, json]` in `settings.yml`). The engine queries
 * `{endpoint}/search?q=...&format=json` and maps the results to
 * `SearchSource`.
 *
 * Fast fail: a closed port fails on its own (ECONNREFUSED surfaces
 * immediately — the engine adds no retry or wait); for hosts that silently
 * drop connects the request carries a short connect-phase guard
 * (`connectTimeoutMs`) on top of the caller's deadline.
 * @module @agents-web-search/core/search/engines/searxng
 */

import { CoreError } from '../../errors.ts'
import { dedupeSources, serpStatusErrors, HttpSearchClient } from '../http.ts'
import type { EngineSearchResult, SearchEngine } from './types.ts'

/** Engine options. */
export interface SearXNGEngineOptions {
  /** SearXNG instance base URL (e.g., `http://localhost:8080`). */
  endpoint: string
  /** `User-Agent` header sent on every request. */
  userAgent: string
  /** Search-request rate limit (requests per second). */
  rateLimitPerSec: number
  /** Hard cap on one response body (bytes). */
  maxSerpBytes: number
  /** Domains (suffix match) excluded from results. */
  blockedDomains: readonly string[]
  /**
   * Connect-phase fast-fail guard (ms): abort the request when the response
   * headers have not arrived within this budget. Default 3s; 0 disables.
   */
  connectTimeoutMs?: number
}

/** Default SearXNG endpoint (local instance). */
export const SEARXNG_DEFAULT_ENDPOINT = 'http://localhost:8080'

/** Default connect-phase fast-fail guard (ms). */
export const SEARXNG_CONNECT_TIMEOUT_MS = 3_000

/** One raw SearXNG JSON result. */
interface SearXNGResult {
  url?: string
  title?: string
  content?: string
  engine?: string
  score?: number
}

/** The self-hosted SearXNG metasearch engine. */
export class SearXNGEngine implements SearchEngine {
  readonly id = 'searxng'
  private readonly http: HttpSearchClient

  constructor(private readonly options: SearXNGEngineOptions) {
    this.http = new HttpSearchClient({ userAgent: options.userAgent, rateLimitPerSec: options.rateLimitPerSec })
  }

  /** Cheap local check: the endpoint must parse as an absolute URL. No network. */
  available(): boolean {
    return URL.canParse(this.endpoint())
  }

  /** Query the SearXNG JSON API and map the results. */
  async search(query: string, maxResults: number, signal: AbortSignal): Promise<EngineSearchResult> {
    const body = await this.fetchJson(query, signal)
    const results = (body.results ?? []) as SearXNGResult[]
    return { sources: this.filterAndDedupe(results).slice(0, maxResults) }
  }

  private endpoint(): string {
    return this.options.endpoint.replace(/\/$/, '')
  }

  private searchUrl(query: string): string {
    const params = new URLSearchParams({ q: query, format: 'json' })
    return `${this.endpoint()}/search?${params.toString()}`
  }

  /** Fetch and parse one SearXNG JSON response. */
  private async fetchJson(query: string, signal: AbortSignal): Promise<{ results?: SearXNGResult[] }> {
    const text = await this.http.fetchText({
      url: this.searchUrl(query),
      headers: { accept: 'application/json' },
      signal,
      maxBytes: this.options.maxSerpBytes,
      context: 'SearXNG search request',
      connectTimeoutMs: (this.options.connectTimeoutMs ?? SEARXNG_CONNECT_TIMEOUT_MS) > 0
        ? (this.options.connectTimeoutMs ?? SEARXNG_CONNECT_TIMEOUT_MS)
        : undefined,
      mapStatus: serpStatusErrors('SearXNG'),
    })
    try {
      return JSON.parse(text) as { results?: SearXNGResult[] }
    } catch {
      throw new CoreError('SearXNG returned a non-JSON response (is the JSON API enabled?)', 'WEB_PROVIDER_ERROR')
    }
  }

  /** Drop blocked domains and duplicate URLs (first occurrence wins). */
  private filterAndDedupe(results: readonly SearXNGResult[]): ReturnType<typeof dedupeSources> {
    return dedupeSources(results, this.options.blockedDomains)
  }
}
