/**
 * Provider-native engines over the OpenAI-compatible Responses API
 * (hosted `web_search` tool): presets for OpenAI and xAI (ADR-004).
 * One LLM call per search (cost guard); sources come from `url_citation`
 * annotations, the answer text from output message items.
 * @module @agents-web-search/core/search/engines/provider-native/openai
 */

import { CoreError } from '../../../errors.ts'
import { normalizeUrl } from '../../url.ts'
import type { SearchSource } from '../../../types.ts'
import type { EngineSearchResult, SearchEngine, SearchEngineDeps } from '../types.ts'
import { asString, providerJson } from './common.ts'

/** Default endpoint bases. */
export const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1'
export const XAI_DEFAULT_BASE_URL = 'https://api.x.ai/v1'

/** Default models (may age — configure explicitly in production). */
export const OPENAI_DEFAULT_MODEL = 'gpt-5.1'
export const XAI_DEFAULT_MODEL = 'grok-4.5'

/** Engine options (shared by the openai and xai presets). */
export interface ResponsesEngineOptions extends SearchEngineDeps {
  readonly id: 'openai' | 'xai'
  readonly apiKey?: string
  readonly baseUrl?: string
  readonly model?: string
  /** Default max search results the provider may return per call. */
  readonly maxUses?: number
  /** Per-request timeout hint (the router deadline still applies). */
  readonly timeoutMs?: number
}

/** Secret names / env vars per preset (ADR-004 §2). */
const PRESETS = {
  openai: { baseUrl: OPENAI_DEFAULT_BASE_URL, model: OPENAI_DEFAULT_MODEL, name: 'websearch:openai', env: 'OPENAI_API_KEY', label: 'OpenAI' },
  xai: { baseUrl: XAI_DEFAULT_BASE_URL, model: XAI_DEFAULT_MODEL, name: 'websearch:xai', env: 'XAI_API_KEY', label: 'xAI' },
} as const

interface ResponsesUrlCitationAnnotation {
  readonly type?: unknown
  readonly url_citation?: { readonly url?: unknown; readonly title?: unknown }
}

interface ResponsesOutputItem {
  readonly type?: unknown
  readonly status?: unknown
  readonly content?: readonly {
    readonly type?: unknown
    readonly text?: unknown
    readonly annotations?: readonly ResponsesUrlCitationAnnotation[]
  }[]
}

interface ResponsesResponse {
  readonly output?: readonly ResponsesOutputItem[]
}

/** The OpenAI-compatible Responses API engine (openai + xai presets). */
export class ResponsesSearchEngine implements SearchEngine {
  readonly id: 'openai' | 'xai'
  private readonly options: ResponsesEngineOptions
  private readonly preset: (typeof PRESETS)[keyof typeof PRESETS]
  private cachedKey = ''

  constructor(options: ResponsesEngineOptions) {
    this.id = options.id
    this.options = options
    this.preset = PRESETS[options.id]
    this.cachedKey = options.apiKey ?? ''
  }

  available(): boolean {
    return this.cachedKey.length > 0 || this.options.resolveSecret !== undefined
  }

  async search(query: string, maxResults: number, signal: AbortSignal): Promise<EngineSearchResult> {
    if (this.options.resolveSecret !== undefined) {
      const resolved = await this.options.resolveSecret({
        name: this.preset.name,
        explicit: this.options.apiKey,
        env: this.preset.env,
      }) ?? ''
      if (resolved !== this.cachedKey) this.cachedKey = resolved
    }
    if (this.cachedKey.length === 0) {
      throw new CoreError(
        `the ${this.id} engine is enabled, but no API key is available (config, credentials, or ${this.preset.env})`,
        'WEB_AUTH',
      )
    }
    const base = (this.options.baseUrl ?? this.preset.baseUrl).replace(/\/+$/, '')
    const body = {
      model: this.options.model ?? this.preset.model,
      input: [{ role: 'user', content: [{ type: 'input_text', text: query }] }],
      tools: [
        {
          type: 'web_search',
          web_search_options: { count: Math.min(maxResults, this.options.maxUses ?? 10) },
        },
      ],
    }
    const parsed = await providerJson<ResponsesResponse>({
      endpoint: `${base}/responses`,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.cachedKey}`,
        'user-agent': this.options.userAgent,
      },
      body,
      signal,
      engineLabel: this.preset.label,
    })
    const sources: SearchSource[] = []
    const seen = new Set<string>()
    const texts: string[] = []
    for (const item of parsed.output ?? []) {
      if (item.type !== 'message') continue
      for (const block of item.content ?? []) {
        if (block.type !== 'output_text') continue
        const text = asString(block.text)
        if (text !== undefined) texts.push(text)
        for (const annotation of block.annotations ?? []) {
          const citation = annotation.type === 'url_citation' ? annotation.url_citation : undefined
          const url = citation !== undefined ? asString(citation.url) : undefined
          if (url === undefined || !URL.canParse(url)) continue
          const key = normalizeUrl(url)
          if (seen.has(key)) continue
          seen.add(key)
          sources.push({
            url,
            ...(asString(citation?.title) !== undefined ? { title: asString(citation?.title) } : {}),
          })
        }
      }
    }
    const content = texts.length > 0 ? texts.join('\n\n').slice(0, 4000) : undefined
    return { sources: sources.slice(0, maxResults), ...content !== undefined ? { content } : {} }
  }
}

/** Build the `openai` engine instance. */
export function createOpenaiEngine(deps: SearchEngineDeps, config?: { baseUrl?: string; model?: string; apiKey?: string; maxUses?: number }): ResponsesSearchEngine {
  return new ResponsesSearchEngine({ ...deps, id: 'openai', ...config })
}

/** Build the `xai` engine instance. */
export function createXaiEngine(deps: SearchEngineDeps, config?: { baseUrl?: string; model?: string; apiKey?: string; maxUses?: number }): ResponsesSearchEngine {
  return new ResponsesSearchEngine({ ...deps, id: 'xai', ...config })
}
