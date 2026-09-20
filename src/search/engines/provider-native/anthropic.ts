/**
 * Provider-native engines over the Anthropic-compatible Messages API with the
 * hosted `web_search_20250305` server tool: presets for Anthropic and DeepSeek
 * (DeepSeek's search endpoint is Anthropic-compatible — verified against the
 * DSH built-in web-search-deepseek provider; ADR-004).
 * @module @agents-web-search/core/search/engines/provider-native/anthropic
 */

import { CoreError } from '../../../errors.ts'
import { normalizeUrl } from '../../url.ts'
import type { SearchSource } from '../../../types.ts'
import type { EngineSearchResult, SearchEngine, SearchEngineDeps } from '../types.ts'
import { asString, providerJson } from './common.ts'

/** Default endpoint bases (`/v1` included in each; `/messages` is appended). */
export const ANTHROPIC_DEFAULT_BASE_URL = 'https://api.anthropic.com/v1'
export const DEEPSEEK_DEFAULT_BASE_URL = 'https://api.deepseek.com/anthropic/v1'

/** Default models (may age — configure explicitly in production). */
export const ANTHROPIC_DEFAULT_MODEL = 'claude-sonnet-4-5'
export const DEEPSEEK_DEFAULT_MODEL = 'deepseek-v4-flash'

/** Default `anthropic-version` header value. */
export const ANTHROPIC_DEFAULT_API_VERSION = '2023-06-01'

/** Default generated-token cap for the Messages request. */
const DEFAULT_MAX_TOKENS = 4096

/** Engine options (shared by the anthropic and deepseek presets). */
export interface MessagesEngineOptions extends SearchEngineDeps {
  readonly id: 'anthropic' | 'deepseek'
  readonly apiKey?: string
  readonly baseUrl?: string
  readonly model?: string
  /** Max `web_search` server-tool uses per request. */
  readonly maxUses?: number
}

const PRESETS = {
  anthropic: {
    baseUrl: ANTHROPIC_DEFAULT_BASE_URL, model: ANTHROPIC_DEFAULT_MODEL,
    name: 'websearch:anthropic', env: 'ANTHROPIC_API_KEY', label: 'Anthropic',
  },
  deepseek: {
    baseUrl: DEEPSEEK_DEFAULT_BASE_URL, model: DEEPSEEK_DEFAULT_MODEL,
    name: 'websearch:deepseek', env: 'DEEPSEEK_API_KEY', label: 'DeepSeek',
  },
} as const

interface MessagesTextBlock {
  readonly type?: 'text'
  readonly text?: unknown
}

interface MessagesWebSearchResultBlock {
  readonly type?: 'web_search_tool_result'
  readonly content?: readonly {
    readonly type?: 'web_search_result'
    readonly url?: unknown
    readonly title?: unknown
    readonly snippet?: unknown
  }[]
}

interface MessagesResponse {
  readonly content?: readonly (MessagesTextBlock | MessagesWebSearchResultBlock)[]
  readonly stop_reason?: unknown
}

/** The Anthropic-compatible Messages API engine (anthropic + deepseek presets). */
export class MessagesSearchEngine implements SearchEngine {
  readonly id: 'anthropic' | 'deepseek'
  private readonly options: MessagesEngineOptions
  private readonly preset: (typeof PRESETS)[keyof typeof PRESETS]
  private cachedKey = ''

  constructor(options: MessagesEngineOptions) {
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
      max_tokens: DEFAULT_MAX_TOKENS,
      messages: [{ role: 'user', content: [{ type: 'text', text: query }] }],
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: Math.min(this.options.maxUses ?? 5, 10) }],
    }
    const parsed = await providerJson<MessagesResponse>({
      endpoint: `${base}/messages`,
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.cachedKey,
        'anthropic-version': ANTHROPIC_DEFAULT_API_VERSION,
        'user-agent': this.options.userAgent,
      },
      body,
      signal,
      engineLabel: this.preset.label,
    })
    const sources: SearchSource[] = []
    const seen = new Set<string>()
    const texts: string[] = []
    for (const block of parsed.content ?? []) {
      if (block.type === 'text') {
        const text = asString(block.text)
        if (text !== undefined) texts.push(text)
      } else if (block.type === 'web_search_tool_result') {
        for (const result of block.content ?? []) {
          if (result.type !== 'web_search_result') continue
          const url = asString(result.url)
          if (url === undefined || !URL.canParse(url)) continue
          const key = normalizeUrl(url)
          if (seen.has(key)) continue
          seen.add(key)
          sources.push({
            url,
            ...(asString(result.title) !== undefined ? { title: asString(result.title) } : {}),
            ...(asString(result.snippet) !== undefined ? { snippet: asString(result.snippet) } : {}),
          })
        }
      }
    }
    if (sources.length === 0) {
      // Absence of structured result blocks is an error, not an empty
      // search (parity with the DSH deepseek provider: no prose-scraping
      // fallback).
      throw new CoreError(`${this.preset.label} returned no web search result blocks (stop_reason: ${String(parsed.stop_reason ?? 'unknown')})`, 'WEB_PARSE_ERROR')
    }
    const content = texts.length > 0 ? texts.join('\n\n').slice(0, 4000) : undefined
    return { sources: sources.slice(0, maxResults), ...content !== undefined ? { content } : {} }
  }
}

/** Build the `anthropic` engine instance. */
export function createAnthropicEngine(deps: SearchEngineDeps, config?: { baseUrl?: string; model?: string; apiKey?: string; maxUses?: number }): MessagesSearchEngine {
  return new MessagesSearchEngine({ ...deps, id: 'anthropic', ...config })
}

/** Build the `deepseek` engine instance (Anthropic-compatible endpoint). */
export function createDeepseekEngine(deps: SearchEngineDeps, config?: { baseUrl?: string; model?: string; apiKey?: string; maxUses?: number }): MessagesSearchEngine {
  return new MessagesSearchEngine({ ...deps, id: 'deepseek', maxUses: config?.maxUses ?? 5, ...config })
}
