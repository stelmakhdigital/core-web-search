/**
 * Core configuration: defaults and resolution (port of the dsh-web-automation
 * "every field is defaulted" model — an empty config yields the full keyless
 * local web stack). Validation is dependency-free (no schema library): types,
 * ranges, absolute URLs, and known engine ids. Failures throw
 * `CoreError('WEB_BAD_REQUEST')` with the offending path.
 * @module @agents-web-search/core/config
 */

import { CoreError } from './errors.ts'
import type { CoreConfig } from './types.ts'

/** Default engine list: keyless-first privacy model (DDG + Bing). */
export const DEFAULT_ENGINES = ['ddg', 'bing'] as const

/** Engines the core knows how to build (registry membership). */
export const KNOWN_ENGINES = [
  'ddg', 'bing', 'searxng',
  'exa', 'jina', 'tavily', 'brave', 'ollama',
  'openai', 'xai', 'anthropic', 'deepseek', 'gemini', 'perplexity',
] as const

export type KnownEngine = (typeof KNOWN_ENGINES)[number]

/** Fully-resolved configuration (every field present). */
export interface ResolvedCoreConfig {
  readonly search: {
    readonly engines: readonly string[]
    readonly mode: 'fallback' | 'fuse'
    readonly region: string
    readonly freshness: string
    readonly rateLimitPerSec: number
    readonly timeoutMs: number
    readonly cacheTtlMs: number
    readonly maxSerpBytes: number
    readonly enrich: {
      readonly enabled: boolean
      readonly fetchLimit: number
      readonly keep: number
      readonly fetchTimeoutMs: number
    }
    readonly embed: { readonly endpoint: string; readonly model: string; readonly timeoutMs: number } | undefined
  }
  readonly fetch: {
    readonly cacheTtlMs: number
    readonly revalidate: boolean
    readonly maxBodyBytes: number
    readonly maxOutputChars: number
    readonly timeoutMs: number
    readonly maxRedirects: number
    readonly allowPrivateNetworks: boolean
  }
  readonly platforms: {
    readonly enabled: boolean
    readonly maxResults: number
    readonly timeoutMs: number
    readonly maxBytes: number
    readonly allowPrivateNetworks: boolean
    readonly platforms: readonly unknown[]
    readonly rulePackPaths: readonly string[]
  }
  readonly store: {
    readonly path: string
    readonly evictLimits: { readonly maxSearches: number; readonly maxPages: number }
  }
  readonly ssrf: {
    readonly trustEnvProxy: boolean
  }
  readonly browser: {
    readonly enabled: boolean
    readonly headless: boolean
    readonly approval: 'never' | 'navigate' | 'all'
    readonly allowPrivateNetworks: boolean
    readonly maxConcurrentTabs: number
    readonly screenshotInlineDefault: boolean
    readonly timeoutMs: number
    readonly authProfiles: Record<string, string>
  }
  readonly providers: NonNullable<CoreConfig['providers']>
  readonly extended: {
    readonly pdf: { readonly enabled: boolean; readonly provider: 'auto' | 'local' | 'datalab' | 'gemini'; readonly maxSizeMB: number; readonly maxPages: number }
    readonly video: { readonly enabled: boolean }
    readonly github: { readonly clone: { readonly enabled: boolean; readonly maxSizeMB: number } }
    readonly curator: { readonly enabled: boolean; readonly bind: string; readonly host: string; readonly remote: boolean }
    readonly contentCache: { readonly maxEntries: number; readonly maxBytes: number; readonly ttlMs: number }
  }
}

function assertPositiveInt(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) throw new CoreError(`${name} must be a positive integer`, 'WEB_BAD_REQUEST')
}

function assertPositiveFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) throw new CoreError(`${name} must be a positive finite number`, 'WEB_BAD_REQUEST')
}

function assertString(name: string, value: unknown): asserts value is string {
  if (typeof value !== 'string') throw new CoreError(`${name} must be a string`, 'WEB_BAD_REQUEST')
}

function assertBoolean(name: string, value: unknown): asserts value is boolean {
  if (typeof value !== 'boolean') throw new CoreError(`${name} must be a boolean`, 'WEB_BAD_REQUEST')
}

function assertAbsoluteUrl(name: string, value: string): void {
  if (!URL.canParse(value) || !/^https?:$/.test(new URL(value).protocol)) {
    throw new CoreError(`${name} must be an absolute http(s) URL (got "${value}")`, 'WEB_BAD_REQUEST')
  }
}

/**
 * Resolve a partial host-supplied config into the fully-defaulted shape.
 * `stateDir` supplies the default store path.
 */
export function resolveCoreConfig(partial: CoreConfig | undefined, stateDir: string): ResolvedCoreConfig {
  const config = partial ?? {}
  const s = config.search ?? {}

  const engines = (s.engines ?? [...DEFAULT_ENGINES]) as readonly string[]
  if (engines.length === 0) throw new CoreError('search.engines must not be empty', 'WEB_BAD_REQUEST')
  for (const id of engines) {
    if (!KNOWN_ENGINES.includes(id as KnownEngine)) {
      throw new CoreError(`search.engines: unknown engine "${id}" (known: ${KNOWN_ENGINES.join(', ')})`, 'WEB_BAD_REQUEST')
    }
  }

  const search = {
    engines: [...engines],
    mode: s.mode ?? 'fallback',
    region: s.region ?? '',
    freshness: s.freshness ?? '',
    rateLimitPerSec: s.rateLimitPerSec ?? 1,
    timeoutMs: s.timeoutMs ?? 30_000,
    cacheTtlMs: s.cacheTtlMs ?? 900_000,
    maxSerpBytes: s.maxSerpBytes ?? 2 * 1024 * 1024,
    enrich: {
      enabled: s.enrich?.enabled ?? true,
      fetchLimit: s.enrich?.fetchLimit ?? 6,
      keep: s.enrich?.keep ?? 5,
      fetchTimeoutMs: s.enrich?.fetchTimeoutMs ?? 10_000,
    },
    embed: s.embed?.endpoint !== undefined
      ? {
          endpoint: s.embed.endpoint,
          model: s.embed.model ?? 'nomic-embed-text',
          timeoutMs: s.embed.timeoutMs ?? 10_000,
        }
      : undefined,
  }
  assertPositiveInt('search.rateLimitPerSec', search.rateLimitPerSec)
  assertPositiveInt('search.timeoutMs', search.timeoutMs)
  assertPositiveInt('search.cacheTtlMs', search.cacheTtlMs)
  assertPositiveInt('search.maxSerpBytes', search.maxSerpBytes)
  assertPositiveInt('search.enrich.fetchLimit', search.enrich.fetchLimit)
  assertPositiveInt('search.enrich.keep', search.enrich.keep)
  if (search.embed !== undefined) {
    assertAbsoluteUrl('search.embed.endpoint', search.embed.endpoint)
    assertPositiveInt('search.embed.timeoutMs', search.embed.timeoutMs)
  }

  const f = config.fetch ?? {}
  const fetch = {
    cacheTtlMs: f.cacheTtlMs ?? 24 * 60 * 60 * 1000,
    revalidate: f.revalidate ?? true,
    maxBodyBytes: f.maxBodyBytes ?? 5 * 1024 * 1024,
    maxOutputChars: f.maxOutputChars ?? 100_000,
    timeoutMs: f.timeoutMs ?? 30_000,
    maxRedirects: f.maxRedirects ?? 5,
    allowPrivateNetworks: f.allowPrivateNetworks ?? false,
  }
  assertPositiveInt('fetch.cacheTtlMs', fetch.cacheTtlMs)
  assertPositiveInt('fetch.maxBodyBytes', fetch.maxBodyBytes)
  assertPositiveInt('fetch.maxOutputChars', fetch.maxOutputChars)
  assertPositiveInt('fetch.timeoutMs', fetch.timeoutMs)
  if (!Number.isInteger(fetch.maxRedirects) || fetch.maxRedirects < 0) {
    throw new CoreError('fetch.maxRedirects must be a non-negative integer', 'WEB_BAD_REQUEST')
  }
  assertBoolean('fetch.revalidate', fetch.revalidate)
  assertBoolean('fetch.allowPrivateNetworks', fetch.allowPrivateNetworks)

  const p = config.platforms ?? {}
  const platforms = {
    enabled: p.enabled ?? true,
    maxResults: p.maxResults ?? 20,
    timeoutMs: p.timeoutMs ?? 30_000,
    maxBytes: p.maxBytes ?? 5 * 1024 * 1024,
    allowPrivateNetworks: p.allowPrivateNetworks ?? false,
    platforms: p.platforms ?? [],
    rulePackPaths: p.rulePackPaths ?? [],
  }
  assertPositiveInt('platforms.maxResults', platforms.maxResults)
  assertPositiveInt('platforms.timeoutMs', platforms.timeoutMs)
  assertPositiveInt('platforms.maxBytes', platforms.maxBytes)

  const st = config.store ?? {}
  let storePath = st.path
  if (storePath !== undefined) assertString('store.path', storePath)
  const store = {
    path: storePath ?? `${stateDir.replace(/\/+$/, '')}/web.db`,
    evictLimits: {
      maxSearches: st.evictLimits?.maxSearches ?? 1000,
      maxPages: st.evictLimits?.maxPages ?? 500,
    },
  }
  assertPositiveInt('store.evictLimits.maxSearches', store.evictLimits.maxSearches)
  assertPositiveInt('store.evictLimits.maxPages', store.evictLimits.maxPages)

  const ssrfCfg = config.ssrf ?? {}
  const ssrf = { trustEnvProxy: ssrfCfg.trustEnvProxy ?? false }
  assertBoolean('ssrf.trustEnvProxy', ssrf.trustEnvProxy)

  const b = config.browser ?? {}
  const browser = {
    enabled: b.enabled ?? false,
    headless: b.headless ?? true,
    approval: b.approval ?? 'navigate',
    allowPrivateNetworks: b.allowPrivateNetworks ?? false,
    maxConcurrentTabs: b.maxConcurrentTabs ?? 1,
    screenshotInlineDefault: b.screenshotInlineDefault ?? false,
    timeoutMs: b.timeoutMs ?? 30_000,
    authProfiles: b.authProfiles ?? {},
  }
  assertPositiveInt('browser.maxConcurrentTabs', browser.maxConcurrentTabs)
  assertPositiveInt('browser.timeoutMs', browser.timeoutMs)
  if (browser.approval !== 'never' && browser.approval !== 'navigate' && browser.approval !== 'all') {
    throw new CoreError(`browser.approval must be one of never|navigate|all (got "${browser.approval}")`, 'WEB_BAD_REQUEST')
  }

  const providers = {
    openai: config.providers?.openai,
    xai: { explicitOnly: true, ...config.providers?.xai },
    anthropic: config.providers?.anthropic,
    deepseek: config.providers?.deepseek,
    gemini: config.providers?.gemini,
    perplexity: config.providers?.perplexity,
    exa: config.providers?.exa,
    tavily: config.providers?.tavily,
    brave: config.providers?.brave,
    jina: config.providers?.jina,
    searxng: config.providers?.searxng,
    ollama: config.providers?.ollama,
  }
  for (const [name, value] of Object.entries({
    openai: providers.openai, xai: providers.xai, anthropic: providers.anthropic,
    deepseek: providers.deepseek, gemini: providers.gemini, perplexity: providers.perplexity,
  })) {
    if (value?.baseUrl !== undefined) assertAbsoluteUrl(`providers.${name}.baseUrl`, value.baseUrl)
    if (value?.timeoutMs !== undefined) assertPositiveInt(`providers.${name}.timeoutMs`, value.timeoutMs)
  }
  for (const name of ['exa', 'tavily', 'brave', 'jina'] as const) {
    const value = providers[name]
    if (value?.baseUrl !== undefined) assertAbsoluteUrl(`providers.${name}.baseUrl`, value.baseUrl)
  }
  if (providers.searxng?.endpoint !== undefined) assertAbsoluteUrl('providers.searxng.endpoint', providers.searxng.endpoint)
  if (providers.ollama?.endpoint !== undefined) assertAbsoluteUrl('providers.ollama.endpoint', providers.ollama.endpoint)

  const e = config.extended ?? {}
  const extended = {
    pdf: {
      enabled: e.pdf?.enabled ?? false,
      provider: e.pdf?.provider ?? 'auto',
      maxSizeMB: e.pdf?.maxSizeMB ?? 20,
      maxPages: e.pdf?.maxPages ?? 100,
    },
    video: { enabled: e.video?.enabled ?? false },
    github: { clone: { enabled: e.github?.clone?.enabled ?? false, maxSizeMB: e.github?.clone?.maxSizeMB ?? 350 } },
    curator: {
      enabled: e.curator?.enabled ?? false,
      bind: e.curator?.bind ?? '127.0.0.1',
      host: e.curator?.host ?? 'localhost',
      remote: e.curator?.remote ?? false,
    },
    contentCache: {
      maxEntries: e.contentCache?.maxEntries ?? 128,
      maxBytes: e.contentCache?.maxBytes ?? 128 * 1024 * 1024,
      ttlMs: e.contentCache?.ttlMs ?? 60 * 60 * 1000,
    },
  }
  assertPositiveInt('extended.pdf.maxSizeMB', extended.pdf.maxSizeMB)
  assertPositiveInt('extended.pdf.maxPages', extended.pdf.maxPages)
  assertPositiveInt('extended.contentCache.maxEntries', extended.contentCache.maxEntries)
  assertPositiveInt('extended.contentCache.maxBytes', extended.contentCache.maxBytes)
  assertPositiveInt('extended.contentCache.ttlMs', extended.contentCache.ttlMs)

  return { search, fetch, platforms, store, ssrf, browser, providers, extended }
}
