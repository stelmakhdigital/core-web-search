/**
 * `DuckDuckGoEngine`: a keyless search engine backed by the DuckDuckGo HTML
 * endpoint. It parses the server-rendered SERP, decodes the `uddg` redirect
 * wrapper, and filters blocked domains. No credentials, no cloud account.
 * @module @agents-web-search/core/search/engines/ddg
 */

import { CoreError } from '../../errors.ts'
import type { SearchSource } from '../../types.ts'
import { dedupeSources, serpStatusErrors, HttpSearchClient } from '../http.ts'
import { isBlockedSerp, parseDuckDuckGoSerp, type SerpResult } from '../serpparse.ts'
import type { EngineSearchResult, SearchEngine } from './types.ts'

/** Engine options. */
export interface DuckDuckGoEngineOptions {
  /** SERP endpoint (absolute URL). */
  endpoint: string
  /** Region hint (`kl` parameter); empty allowed. */
  region: string
  /** `User-Agent` header sent on every request. */
  userAgent: string
  /** Search-request rate limit (requests per second). */
  rateLimitPerSec: number
  /** Hard cap on one SERP body (bytes). */
  maxSerpBytes: number
  /** Domains (suffix match) excluded from results. */
  blockedDomains: readonly string[]
}

/** Default DuckDuckGo HTML SERP endpoint. */
export const DUCKDUCKGO_DEFAULT_ENDPOINT = 'https://html.duckduckgo.com/html/'

/** The keyless DuckDuckGo HTML search engine. */
export class DuckDuckGoEngine implements SearchEngine {
  readonly id = 'ddg'
  private readonly http: HttpSearchClient

  constructor(private readonly options: DuckDuckGoEngineOptions) {
    this.http = new HttpSearchClient({ userAgent: options.userAgent, rateLimitPerSec: options.rateLimitPerSec })
  }

  /** Cheap local check: the endpoint must parse as an absolute URL. No network. */
  available(): boolean {
    return URL.canParse(this.endpoint())
  }

  /** Fetch and parse one SERP. */
  async search(query: string, maxResults: number, signal: AbortSignal): Promise<EngineSearchResult> {
    const html = await this.fetchSerp(query, signal)
    if (isBlockedSerp(html)) {
      throw new CoreError(
        'DuckDuckGo returned a bot challenge instead of results; slow down or try again later',
        'WEB_PROVIDER_ERROR',
      )
    }
    return { sources: this.filterAndDedupe(parseDuckDuckGoSerp(html)).slice(0, maxResults) }
  }
  private endpoint(): string {
    return this.options.endpoint.endsWith('/') ? this.options.endpoint : `${this.options.endpoint}/`
  }

  private serpUrl(query: string): string {
    const params = new URLSearchParams({ q: query })
    if (this.options.region.length > 0) params.set('kl', this.options.region)
    const base = this.endpoint()
    const separator = base.includes('?') ? '&' : '?'
    return `${base}${separator}${params.toString()}`
  }

  /** Fetch the SERP document; block-like failures surface as `CoreError`. */
  private async fetchSerp(query: string, signal: AbortSignal): Promise<string> {
    return this.http.fetchText({
      url: this.serpUrl(query),
      headers: { accept: 'text/html' },
      signal,
      maxBytes: this.options.maxSerpBytes,
      context: 'DuckDuckGo search request',
      mapStatus: serpStatusErrors('DuckDuckGo'),
    })
  }

  /** Drop blocked domains and duplicate URLs (first occurrence wins). */
  private filterAndDedupe(results: readonly SerpResult[]): SearchSource[] {
    return dedupeSources(results, this.options.blockedDomains)
  }
}
