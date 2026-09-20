/**
 * Engine factory: builds every known engine from the resolved core config and
 * the host's per-search secret resolver. Engines are constructed eagerly;
 * `available()` (cheap, no network) decides participation at routing time, so
 * a keyless deployment simply sees the key engines as unavailable.
 * @module @agents-web-search/core/search/engines/factory
 */

import { makeSecretResolver } from '../../credential.ts'
import type { ResolvedCoreConfig } from '../../config.ts'
import type { HostAdapter } from '../../types.ts'
import { BingEngine, BING_DEFAULT_ENDPOINT } from './bing.ts'
import { DuckDuckGoEngine, DUCKDUCKGO_DEFAULT_ENDPOINT } from './ddg.ts'
import { ExaEngine, EXA_DEFAULT_BASE_URL } from './exa.ts'
import { JinaEngine, JINA_DEFAULT_BASE_URL } from './jina.ts'
import { OllamaEngine, OLLAMA_DEFAULT_ENDPOINT } from './ollama.ts'
import { SearXNGEngine, SEARXNG_DEFAULT_ENDPOINT } from './searxng.ts'
import { TavilyEngine, TAVILY_DEFAULT_BASE_URL } from './tavily.ts'
import { BraveEngine, BRAVE_DEFAULT_BASE_URL } from './brave.ts'
import { createAnthropicEngine, createDeepseekEngine } from './provider-native/anthropic.ts'
import { createOpenaiEngine, createXaiEngine } from './provider-native/openai.ts'
import { GeminiEngine, GEMINI_DEFAULT_BASE_URL, GEMINI_DEFAULT_MODEL } from './provider-native/gemini.ts'
import { PerplexityEngine, PERPLEXITY_DEFAULT_BASE_URL, PERPLEXITY_DEFAULT_MODEL } from './provider-native/perplexity.ts'
import type { SearchEngine, SearchEngineDeps } from './types.ts'

export interface EngineFactoryOptions {
  readonly config: ResolvedCoreConfig
  readonly host: HostAdapter
  /** Product user-agent (host identity included). */
  readonly userAgent: string
}

/** Default blocked SERP domains (search-engine/CDN noise). */
export const DEFAULT_BLOCKED_DOMAINS = [
  'duckduckgo.com', 'bing.com', 'microsoft.com', 'google.com', 'googleapis.com',
  'gstatic.com', 'w3.org', 'schema.org',
] as const

/**
 * Build the full engine map (id → engine). All 14 known engines are
 * constructed; the router filters by `config.search.engines`, `available()`,
 * cooldowns, and `explicitOnly` (ADR-004/006).
 */
export function buildEngines(options: EngineFactoryOptions): Map<string, SearchEngine> {
  const { config, host, userAgent } = options
  const resolveSecret = makeSecretResolver(host)
  const deps: SearchEngineDeps = { userAgent, resolveSecret }
  const rateLimit = config.search.rateLimitPerSec
  const maxSerpBytes = config.search.maxSerpBytes
  const providers = config.providers

  const engines = new Map<string, SearchEngine>()
  engines.set('ddg', new DuckDuckGoEngine({
    endpoint: DUCKDUCKGO_DEFAULT_ENDPOINT,
    region: config.search.region,
    userAgent,
    rateLimitPerSec: rateLimit,
    maxSerpBytes,
    blockedDomains: DEFAULT_BLOCKED_DOMAINS,
  }))
  engines.set('bing', new BingEngine({
    endpoint: BING_DEFAULT_ENDPOINT,
    market: config.search.region,
    userAgent,
    rateLimitPerSec: rateLimit,
    maxSerpBytes,
    blockedDomains: DEFAULT_BLOCKED_DOMAINS,
    freshness: config.search.freshness,
  }))
  engines.set('searxng', new SearXNGEngine({
    endpoint: providers.searxng?.endpoint ?? SEARXNG_DEFAULT_ENDPOINT,
    userAgent,
    rateLimitPerSec: rateLimit,
    maxSerpBytes,
    blockedDomains: [],
  }))
  engines.set('exa', new ExaEngine({
    ...deps,
    apiKey: providers.exa?.apiKey,
    baseUrl: providers.exa?.baseUrl ?? EXA_DEFAULT_BASE_URL,
  }))
  engines.set('jina', new JinaEngine({
    ...deps,
    apiKey: providers.jina?.apiKey,
    baseURL: providers.jina?.baseUrl ?? JINA_DEFAULT_BASE_URL,
    maxResponseBytes: maxSerpBytes,
  }))
  engines.set('tavily', new TavilyEngine({
    ...deps,
    apiKey: providers.tavily?.apiKey,
    baseUrl: providers.tavily?.baseUrl ?? TAVILY_DEFAULT_BASE_URL,
  }))
  engines.set('brave', new BraveEngine({
    ...deps,
    apiKey: providers.brave?.apiKey,
    baseUrl: providers.brave?.baseUrl ?? BRAVE_DEFAULT_BASE_URL,
    country: config.search.region || undefined,
    freshness: config.search.freshness,
  }))
  engines.set('ollama', new OllamaEngine({ ...deps, endpoint: providers.ollama?.endpoint ?? OLLAMA_DEFAULT_ENDPOINT }))
  engines.set('openai', createOpenaiEngine(deps, {
    baseUrl: providers.openai?.baseUrl,
    model: providers.openai?.model,
    apiKey: providers.openai?.apiKey,
    maxUses: providers.openai?.maxUses,
  }))
  engines.set('xai', createXaiEngine(deps, {
    baseUrl: providers.xai?.baseUrl,
    model: providers.xai?.model,
    apiKey: providers.xai?.apiKey,
    maxUses: providers.xai?.maxUses,
  }))
  engines.set('anthropic', createAnthropicEngine(deps, {
    baseUrl: providers.anthropic?.baseUrl,
    model: providers.anthropic?.model,
    apiKey: providers.anthropic?.apiKey,
    maxUses: providers.anthropic?.maxUses,
  }))
  engines.set('deepseek', createDeepseekEngine(deps, {
    baseUrl: providers.deepseek?.baseUrl,
    model: providers.deepseek?.model,
    apiKey: providers.deepseek?.apiKey,
    maxUses: providers.deepseek?.maxUses,
  }))
  engines.set('gemini', new GeminiEngine({
    ...deps,
    apiKey: providers.gemini?.apiKey,
    baseUrl: providers.gemini?.baseUrl ?? GEMINI_DEFAULT_BASE_URL,
    model: providers.gemini?.model ?? GEMINI_DEFAULT_MODEL,
  }))
  engines.set('perplexity', new PerplexityEngine({
    ...deps,
    apiKey: providers.perplexity?.apiKey,
    baseUrl: providers.perplexity?.baseUrl ?? PERPLEXITY_DEFAULT_BASE_URL,
    model: providers.perplexity?.model ?? PERPLEXITY_DEFAULT_MODEL,
  }))
  return engines
}

/** Engines excluded from the `auto` chain unless explicitly requested (cost guard; ADR-004). */
export function explicitOnlyEngineIds(config: ResolvedCoreConfig): ReadonlySet<string> {
  const ids = new Set<string>()
  if (config.providers.xai?.explicitOnly !== false) ids.add('xai')
  if (config.providers.openai?.explicitOnly) ids.add('openai')
  if (config.providers.anthropic?.explicitOnly) ids.add('anthropic')
  if (config.providers.deepseek?.explicitOnly) ids.add('deepseek')
  if (config.providers.gemini?.explicitOnly) ids.add('gemini')
  if (config.providers.perplexity?.explicitOnly) ids.add('perplexity')
  return ids
}
