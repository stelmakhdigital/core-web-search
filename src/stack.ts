/**
 * `createWebStack`: the core's top-level factory (ADR-003). Wires the
 * resolved host config into the full web stack — search (14 engines,
 * router, cache, enrichment), fetch (SSRF-guarded cached HTTP), platform
 * search (registry + rule packs), the shared web store — and exposes the
 * model-facing tools as `ToolSpec`s.
 *
 * The host adapter (ADR-002) is the only host dependency: config, state
 * paths, credential resolution, tool registration, error mapping.
 * @module @agents-web-search/core/stack
 */

import { resolveCoreConfig, type ResolvedCoreConfig } from './config.ts'
import { CoreError } from './errors.ts'
import { PRODUCT_USER_AGENT } from './user-agent.ts'
import { buildEngines, explicitOnlyEngineIds } from './search/engines/factory.ts'
import { MULTI_SEARCH_PROVIDER_ID, MultiSearchProvider, searchCacheKey } from './search/provider.ts'
import { buildFetchLimits, CachedHttpFetchProvider } from './fetch/index.ts'
import { BUILTIN_PLATFORMS } from './platforms/builtins.ts'
import { PlatformRegistry } from './platforms/registry.ts'
import { validatePlatform } from './platforms/rulepacks.ts'
import { searchPlatform } from './platforms/search.ts'
import { WebStore } from './store/index.ts'
import { buildCoreTools, type ToolHost } from './tools/index.ts'
import type {
  CoreConfig,
  FetchRequest,
  FetchResult,
  HostAdapter,
  PlatformSearchRequest,
  SearchRequest,
  SearchResult,
  ToolSpec,
} from './types.ts'
import type { PlatformSearchResult, PlatformSource } from './platforms/types.ts'
import type { SearchEngine } from './search/engines/types.ts'
import type { Platform } from './platforms/types.ts'

/** Cooldown defaults (ported from the DSH plugin: 30 s base, 1 h cap). */
const COOLDOWN_BASE_MS = 30_000
const COOLDOWN_MAX_MS = 3_600_000

/** Default result count when a request carries none. */
const DEFAULT_MAX_RESULTS = 5

/** The assembled core web stack. */
export interface WebStack {
  /** The host adapter the stack was built for. */
  readonly host: HostAdapter
  /** The resolved configuration. */
  readonly config: ResolvedCoreConfig
  /** The shared web store (search cache, page cache, history). */
  readonly store: WebStore
  /** Product user-agent (host identity included). */
  readonly userAgent: string
  /** Built engine map (diagnostics). */
  readonly engines: ReadonlyMap<string, SearchEngine>
  /**
   * Run one search (single query). Multi-query merging is a tool-layer
   * concern; adapters may issue several searches.
   */
  search(request: SearchRequest, signal?: AbortSignal): Promise<SearchResult>
  /** Fetch one URL (SSRF-guarded, cached, markdown-ready). */
  fetch(request: FetchRequest, signal?: AbortSignal): Promise<FetchResult>
  /** Run one platform search. */
  platformSearch(request: PlatformSearchRequest, signal?: AbortSignal): Promise<PlatformSearchResult>
  /** Build the model-facing tool specs (host registration contract). */
  tools(): ToolSpec[]
  /** Release host resources (store close, host.dispose()). */
  dispose(): Promise<void>
}

interface SearchRequestWithEngine extends SearchRequest {
  /** Forced single engine id (strict: no fallback). */
  readonly engine?: string
}

/** Build the full web stack for one host. */
export function createWebStack(host: HostAdapter): WebStack {
  const config = resolveCoreConfig(host.config, host.paths.stateDir)
  const userAgent = composeUserAgent(host)
  const store = new WebStore({
    path: config.store.path,
    evictLimits: config.store.evictLimits,
  })
  const fetcher = new CachedHttpFetchProvider(buildFetchLimits(config, store, userAgent))
  const engines = buildEngines({ config, host, userAgent })
  const explicitOnly = explicitOnlyEngineIds(config)

  const multi = new MultiSearchProvider({
    engines: config.search.engines,
    mode: config.search.mode,
    defaultMaxResults: DEFAULT_MAX_RESULTS,
    store,
    engineById: engines,
    enrich: config.search.enrich.enabled,
    enrichFetchLimit: config.search.enrich.fetchLimit,
    enrichKeep: config.search.enrich.keep,
    searchCacheTtlMs: config.search.cacheTtlMs,
    pageCacheTtlMs: config.fetch.cacheTtlMs,
    timeoutMs: config.search.timeoutMs,
    cooldownBaseMs: COOLDOWN_BASE_MS,
    cooldownMaxMs: COOLDOWN_MAX_MS,
    enrichOptions: {
      pageTimeoutMs: config.search.enrich.fetchTimeoutMs,
      pageCacheTtlMs: config.fetch.cacheTtlMs,
      maxPageBytes: config.fetch.maxBodyBytes,
      maxBodyChars: config.fetch.maxOutputChars,
      snippetChars: 500,
      userAgent,
      concurrency: 3,
      allowPrivateNetworks: config.fetch.allowPrivateNetworks,
    },
    logger: host.log !== undefined
      ? { info: (message: string, ...meta: unknown[]) => host.log?.('info', message, toMeta(meta)) }
      : undefined,
  })

  const registry = new PlatformRegistry({
    builtins: BUILTIN_PLATFORMS,
    configured: (config.platforms.platforms as readonly unknown[]).map((raw, index) => {
      try {
        return validatePlatform(raw, `platforms.platforms[${index}]`)
      } catch (error) {
        throw new CoreError(
          `invalid configured platform at platforms.platforms[${index}]: ${error instanceof Error ? error.message : String(error)}`,
          'WEB_BAD_REQUEST',
          { cause: error },
        )
      }
    }),
    rulePackPaths: config.platforms.rulePackPaths,
  })

  const stackToolHost: ToolHost = {
    config,
    store,
    search: (request, signal) => searchStack(request, signal),
    fetch: (request, signal) => fetcher.fetch({ url: request.url }, signal),
    platformSearch: (request, signal) => platformSearchStack(request, signal),
  }

  async function searchStack(request: SearchRequest, signal?: AbortSignal): Promise<SearchResult> {
    const forced = (request as SearchRequestWithEngine).engine
    if (forced !== undefined && explicitOnly.has(forced)) {
      // explicitOnly engines (xai default) only run when explicitly forced —
      // satisfied here by construction; nothing to reject.
    }
    const query = request.query?.trim()
    if (query === undefined || query.length === 0) {
      throw new CoreError('search query must be a non-empty string', 'WEB_BAD_REQUEST')
    }
    const maxResults = request.maxResults !== undefined ? Math.min(Math.max(request.maxResults, 1), 20) : DEFAULT_MAX_RESULTS
    // explicitOnly guard: a forced explicitOnly engine is allowed (explicit);
    // in the auto chain it is excluded via the engines list below.
    const provider = forced !== undefined ? forcedProviders.get(forced) ?? buildForcedProvider(forced) : multi
    if (forced !== undefined) forcedProviders.set(forced, provider as MultiSearchProvider)
    const result = await provider.search(
      {
        query,
        maxResults,
        ...(request.recency !== undefined ? { recency: request.recency } : {}),
        ...(request.domains !== undefined ? { domains: [...request.domains] } : {}),
      },
      signal,
    )
    return {
      ...result,
      enginesUsed: forced !== undefined ? [forced] : undefined,
    }
  }

  /** Lazily built, cached per-engine providers for forced searches. */
  const forcedProviders = new Map<string, MultiSearchProvider>()

  function buildForcedProvider(engineId: string): MultiSearchProvider {
    return new MultiSearchProvider({
      engines: [engineId],
      forcedEngine: engineId,
      mode: config.search.mode,
      defaultMaxResults: DEFAULT_MAX_RESULTS,
      store,
      engineById: engines,
      enrich: false,
      enrichFetchLimit: 0,
      enrichKeep: 0,
      searchCacheTtlMs: config.search.cacheTtlMs,
      pageCacheTtlMs: config.fetch.cacheTtlMs,
      timeoutMs: config.search.timeoutMs,
      cooldownBaseMs: COOLDOWN_BASE_MS,
      cooldownMaxMs: COOLDOWN_MAX_MS,
      enrichOptions: {
        pageTimeoutMs: config.search.enrich.fetchTimeoutMs,
        pageCacheTtlMs: config.fetch.cacheTtlMs,
        maxPageBytes: config.fetch.maxBodyBytes,
        maxBodyChars: config.fetch.maxOutputChars,
        snippetChars: 500,
        userAgent,
        concurrency: 1,
        allowPrivateNetworks: config.fetch.allowPrivateNetworks,
      },
    })
  }

  async function platformSearchStack(request: PlatformSearchRequest, signal?: AbortSignal): Promise<PlatformSearchResult> {
    registry.refresh()
    const platformSignal = signal ?? new AbortController().signal
    return await searchPlatform(
      { platform: request.platform, query: request.query, ...(request.maxResults !== undefined ? { limit: request.maxResults } : {}) },
      {
        registry,
        timeoutMs: config.platforms.timeoutMs,
        maxBytes: config.platforms.maxBytes,
        maxResults: config.platforms.maxResults,
        allowPrivateNetworks: config.platforms.allowPrivateNetworks,
      },
      platformSignal,
    )
  }

  let disposed = false
  return {
    host,
    config,
    store,
    userAgent,
    engines,
    search: searchStack,
    fetch: (request: FetchRequest, signal?: AbortSignal): Promise<FetchResult> => {
      const url = request.url?.trim()
      if (url === undefined || url.length === 0) {
        return Promise.reject(new CoreError('fetch url must be a non-empty string', 'WEB_BAD_REQUEST'))
      }
      return fetcher.fetch({ url }, signal)
    },
    platformSearch: platformSearchStack,
    tools(): ToolSpec[] {
      return buildCoreTools(stackToolHost)
    },
    async dispose(): Promise<void> {
      if (disposed) return
      disposed = true
      await host.dispose?.()
      await store.close()
    },
  }

  function toMeta(meta: readonly unknown[]): Record<string, unknown> {
    const record: Record<string, unknown> = {}
    meta.forEach((value, index) => {
      if (value !== undefined) record[`meta${index}`] = value
    })
    return record
  }
}

/** Compose the product UA with the host identity (ADR-005 §5). */
function composeUserAgent(host: HostAdapter): string {
  const identity = host.identity.name
  const version = host.identity.version
  return version !== undefined && version.length > 0
    ? `${PRODUCT_USER_AGENT} ${identity}/${version}`
    : `${PRODUCT_USER_AGENT} ${identity}`
}

/** Re-export for adapters that build cache keys. */
export { searchCacheKey, MULTI_SEARCH_PROVIDER_ID }
