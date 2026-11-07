/**
 * `BingEngine`: a keyless search engine backed by the Bing HTML SERP.
 * Server-rendered results parsed with cheerio; a consent/challenge page is a
 * provider failure (the router cools the engine down and falls through).
 * @module @agents-web-search/core/search/engines/bing
 */

import { CoreError } from '../../errors.ts'
import type { SearchSource } from '../../types.ts'
import { dedupeSources, serpStatusErrors, HttpSearchClient } from '../http.ts'
import { isBlockedBingSerp, parseBingSerp } from '../bingparse.ts'
import type { EngineSearchResult, SearchEngine } from './types.ts'

/** Engine options. */
export interface BingEngineOptions {
  /** SERP endpoint (absolute URL). */
  endpoint: string
  /** Region/market hint (`setmkt` parameter, e.g. `en-US`); empty allowed. */
  market: string
  /** `User-Agent` header sent on every request. */
  userAgent: string
  /** Search-request rate limit (requests per second). */
  rateLimitPerSec: number
  /** Hard cap on one SERP body (bytes). */
  maxSerpBytes: number
  /** Domains (suffix match) excluded from results. */
  blockedDomains: readonly string[]
  /**
   * Freshness filter (news mode). Maps to Bing's `qft` parameter:
   * `24h` → past day, `week` → past week, `month` → past month, `year` → past year.
   * Empty string disables the filter.
   */
  freshness?: string
}

/** Default Bing SERP endpoint. */
export const BING_DEFAULT_ENDPOINT = 'https://www.bing.com/search'

/** The keyless Bing HTML search engine. */
export class BingEngine implements SearchEngine {
  readonly id = 'bing'
  private readonly http: HttpSearchClient

  constructor(private readonly options: BingEngineOptions) {
    this.http = new HttpSearchClient({ userAgent: options.userAgent, rateLimitPerSec: options.rateLimitPerSec })
  }

  /** Cheap local check: the endpoint must parse as an absolute URL. No network. */
  available(): boolean {
    return URL.canParse(this.options.endpoint)
  }

  /** Fetch and parse one SERP. */
  async search(query: string, maxResults: number, signal: AbortSignal): Promise<EngineSearchResult> {
    const html = await this.fetchSerp(query, maxResults, signal)
    if (isBlockedBingSerp(html)) {
      throw new CoreError(
        'Bing returned a consent or challenge page instead of results; slow down or try again later',
        'WEB_PROVIDER_ERROR',
      )
    }
    return { sources: this.filterAndDedupe(parseBingSerp(html)).slice(0, maxResults) }
  }

  private serpUrl(query: string, maxResults: number): string {
    const url = new URL(this.options.endpoint)
    url.searchParams.set('q', query)
    url.searchParams.set('count', String(Math.min(maxResults, 50)))
    if (this.options.market.length > 0) url.searchParams.set('setmkt', this.options.market)
    // Freshness filter (news mode): map to Bing's qft parameter.
    const qft = this.freshnessQft()
    if (qft.length > 0) url.searchParams.set('qft', qft)
    return url.toString()
  }

  /** Map the freshness setting to Bing's `qft` filter value. */
  private freshnessQft(): string {
    const freshness = this.options.freshness ?? ''
    switch (freshness) {
      case '24h': return '+filter:ex1'
      case 'week': return '+filter:ex2'
      case 'month': return '+filter:ex3'
      case 'year': return '+filter:ex4'
      default: return ''
    }
  }

  /** Fetch the SERP document; block-like failures surface as `CoreError`. */
  private async fetchSerp(query: string, maxResults: number, signal: AbortSignal): Promise<string> {
    return this.http.fetchText({
      url: this.serpUrl(query, maxResults),
      headers: { accept: 'text/html' },
      signal,
      maxBytes: this.options.maxSerpBytes,
      context: 'Bing search request',
      mapStatus: serpStatusErrors('Bing'),
    })
  }

  /** Drop blocked domains and duplicate URLs (first occurrence wins). */
  private filterAndDedupe(results: readonly { url: string; title: string; snippet: string }[]): SearchSource[] {
    return dedupeSources(results, this.options.blockedDomains)
  }
}
