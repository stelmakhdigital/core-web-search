/**
 * `PerplexityEngine`: Perplexity search as a synthesis engine (provider-native
 * family: returns a generated answer + citations; ADR-004). Client-side
 * 10-requests/minute guard (parity with pi-web-access policy).
 * @module @agents-web-search/core/search/engines/provider-native/perplexity
 */

import { CoreError } from '../../../errors.ts'
import { normalizeUrl } from '../../url.ts'
import type { SearchSource } from '../../../types.ts'
import type { EngineSearchResult, SearchEngine, SearchEngineDeps } from '../types.ts'
import { asString, providerJson } from './common.ts'

/** Default Perplexity endpoint base. */
export const PERPLEXITY_DEFAULT_BASE_URL = 'https://api.perplexity.ai'

/** Default model. */
export const PERPLEXITY_DEFAULT_MODEL = 'sonar'

/** Engine options. */
export interface PerplexityEngineOptions extends SearchEngineDeps {
  readonly apiKey?: string
  readonly baseUrl?: string
  readonly model?: string
}

interface PerplexityChoice {
  readonly message?: { readonly content?: unknown }
}

interface PerplexityResponse {
  readonly choices?: readonly PerplexityChoice[]
  readonly citations?: readonly unknown[]
}

/** The Perplexity synthesis search engine. */
export class PerplexityEngine implements SearchEngine {
  readonly id = 'perplexity'
  private readonly options: PerplexityEngineOptions
  private cachedKey = ''
  /** Timestamps of the last requests (10/min guard). */
  private readonly recentRequests: number[] = []

  constructor(options: PerplexityEngineOptions) {
    this.options = options
    this.cachedKey = options.apiKey ?? ''
  }

  available(): boolean {
    return this.cachedKey.length > 0 || this.options.resolveSecret !== undefined
  }

  /** Enforce the 10-requests/minute client-side budget. */
  private guardRateLimit(): void {
    const now = Date.now()
    const windowStart = now - 60_000
    while (this.recentRequests.length > 0 && (this.recentRequests[0] ?? Infinity) < windowStart) this.recentRequests.shift()
    if (this.recentRequests.length >= 10) {
      throw new CoreError('Perplexity client-side rate limit: at most 10 requests per minute', 'WEB_QUOTA')
    }
    this.recentRequests.push(now)
  }

  async search(query: string, maxResults: number, signal: AbortSignal): Promise<EngineSearchResult> {
    if (this.options.resolveSecret !== undefined) {
      const resolved = await this.options.resolveSecret({
        name: 'websearch:perplexity',
        explicit: this.options.apiKey,
        env: 'PERPLEXITY_API_KEY',
      }) ?? ''
      if (resolved !== this.cachedKey) this.cachedKey = resolved
    }
    if (this.cachedKey.length === 0) {
      throw new CoreError('the perplexity engine is enabled, but no API key is available (config, credentials, or PERPLEXITY_API_KEY)', 'WEB_AUTH')
    }
    this.guardRateLimit()
    const base = (this.options.baseUrl ?? PERPLEXITY_DEFAULT_BASE_URL).replace(/\/+$/, '')
    const body = {
      model: this.options.model ?? PERPLEXITY_DEFAULT_MODEL,
      messages: [{ role: 'user', content: query }],
    }
    const parsed = await providerJson<PerplexityResponse>({
      endpoint: `${base}/chat/completions`,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.cachedKey}`,
        'user-agent': this.options.userAgent,
      },
      body,
      signal,
      engineLabel: 'Perplexity',
    })
    const content = asString(parsed.choices?.[0]?.message?.content)
    if (content === undefined) {
      throw new CoreError('Perplexity returned no answer content', 'WEB_PARSE_ERROR')
    }
    const sources: SearchSource[] = []
    const seen = new Set<string>()
    for (const citation of parsed.citations ?? []) {
      const url = asString(citation)
      if (url === undefined || !URL.canParse(url)) continue
      const key = normalizeUrl(url)
      if (seen.has(key)) continue
      seen.add(key)
      sources.push({ url })
    }
    return { sources: sources.slice(0, maxResults), content }
  }
}
