/**
 * `GeminiEngine`: Google Gemini generateContent with the `google_search`
 * grounding tool (provider-native search; ADR-004). Sources come from
 * grounding metadata (grounding chunks / part citations); the answer text
 * from candidate parts.
 * @module @agents-web-search/core/search/engines/provider-native/gemini
 */

import { CoreError } from '../../../errors.ts'
import { normalizeUrl } from '../../url.ts'
import type { SearchSource } from '../../../types.ts'
import type { EngineSearchResult, SearchEngine, SearchEngineDeps } from '../types.ts'
import { asString, providerJson } from './common.ts'

/** Default Gemini endpoint base. */
export const GEMINI_DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com'

/** Default model (may age — configure explicitly in production). */
export const GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash'

/** Engine options. */
export interface GeminiEngineOptions extends SearchEngineDeps {
  readonly apiKey?: string
  readonly baseUrl?: string
  readonly model?: string
}

interface GeminiPart {
  readonly text?: unknown
  readonly citation?: { readonly sourceAttribution?: { readonly uri?: unknown; readonly title?: unknown } }
}

interface GeminiGroundingChunk {
  readonly web?: { readonly uri?: unknown; readonly title?: unknown }
}

interface GeminiCandidate {
  readonly content?: { readonly parts?: readonly GeminiPart[] }
  readonly groundingMetadata?: { readonly groundingChunks?: readonly GeminiGroundingChunk[] }
}

interface GeminiResponse {
  readonly candidates?: readonly GeminiCandidate[]
}

/** The Gemini (google_search grounding) engine. */
export class GeminiEngine implements SearchEngine {
  readonly id = 'gemini'
  private readonly options: GeminiEngineOptions
  private cachedKey = ''

  constructor(options: GeminiEngineOptions) {
    this.options = options
    this.cachedKey = options.apiKey ?? ''
  }

  available(): boolean {
    return this.cachedKey.length > 0 || this.options.resolveSecret !== undefined
  }

  async search(query: string, maxResults: number, signal: AbortSignal): Promise<EngineSearchResult> {
    let key = this.cachedKey
    if (this.options.resolveSecret !== undefined) {
      const resolved = await this.options.resolveSecret({
        name: 'websearch:gemini',
        explicit: key,
        env: 'GEMINI_API_KEY',
      })
      if (resolved !== undefined && resolved.length > 0) key = resolved
      else if (key.length === 0) key = process.env['GEMINI_API_KEY'] || process.env['GOOGLE_API_KEY'] || ''
    }
    if (key.length === 0) {
      throw new CoreError('the gemini engine is enabled, but no API key is available (config, credentials, or GEMINI_API_KEY/GOOGLE_API_KEY)', 'WEB_AUTH')
    }
    if (key !== this.cachedKey) this.cachedKey = key
    const base = (this.options.baseUrl ?? GEMINI_DEFAULT_BASE_URL).replace(/\/+$/, '')
    const model = this.options.model ?? GEMINI_DEFAULT_MODEL
    const body = {
      contents: [{ parts: [{ text: query }] }],
      tools: [{ google_search: {} }],
    }
    const parsed = await providerJson<GeminiResponse>({
      endpoint: `${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': key,
        'user-agent': this.options.userAgent,
      },
      body,
      signal,
      engineLabel: 'Gemini',
    })
    const sources: SearchSource[] = []
    const seen = new Set<string>()
    const texts: string[] = []
    const pushSource = (url: string, title?: string): void => {
      const key2 = normalizeUrl(url)
      if (seen.has(key2)) return
      seen.add(key2)
      sources.push({ url, ...(title !== undefined ? { title } : {}) })
    }
    for (const candidate of parsed.candidates ?? []) {
      for (const part of candidate.content?.parts ?? []) {
        const text = asString(part.text)
        if (text !== undefined) texts.push(text)
        const uri = part.citation !== undefined ? asString(part.citation.sourceAttribution?.uri) : undefined
        if (uri !== undefined && URL.canParse(uri)) {
          pushSource(uri, part.citation !== undefined ? asString(part.citation.sourceAttribution?.title) : undefined)
        }
      }
      for (const chunk of candidate.groundingMetadata?.groundingChunks ?? []) {
        const uri = chunk.web !== undefined ? asString(chunk.web.uri) : undefined
        if (uri !== undefined && URL.canParse(uri)) {
          pushSource(uri, chunk.web !== undefined ? asString(chunk.web.title) : undefined)
        }
      }
    }
    const content = texts.length > 0 ? texts.join('\n\n').slice(0, 4000) : undefined
    return { sources: sources.slice(0, maxResults), ...content !== undefined ? { content } : {} }
  }
}
