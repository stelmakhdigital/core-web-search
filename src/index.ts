/**
 * `@agents-web-search/core` — agent-agnostic web-search core.
 *
 * Public API:
 * - {@link createWebStack}: the top-level factory (host adapter in, full
 *   web stack out).
 * - Public types (requests/results, `HostAdapter`, `ToolSpec`, `CoreConfig`).
 * - `CoreError` + code helpers; the web store; engine registry helpers.
 *
 * The core has zero host dependencies (Q9): agent hosts integrate through
 * {@link HostAdapter} only (DSH and Pi adapters live in the sibling
 * `@agents-web-search` workspace packages).
 * @module @agents-web-search/core
 */

// Factory
export { createWebStack, type WebStack } from './stack.ts'

// Config
export { resolveCoreConfig, DEFAULT_ENGINES, KNOWN_ENGINES, type ResolvedCoreConfig, type KnownEngine } from './config.ts'

// Errors
export {
  CoreError,
  isCoreError,
  toCoreError,
  errorCodeOf,
  errorMessage,
  type CoreErrorCode,
} from './errors.ts'

// Timeout primitives
export { deadline, timeoutOf, TimeoutReason, type Deadline } from './timeout.ts'

// Public types
export type {
  SearchSource,
  SearchRequest,
  SearchResult,
  FetchRequest,
  FetchBody,
  FetchResult,
  PlatformSearchRequest,
  PlatformSource as CorePlatformSource,
  PlatformSearchResult as CorePlatformSearchResult,
  ToolSpec,
  ToolOutput,
  ApprovalRequest,
  LlmClient,
  HostAdapter,
  CoreConfig,
  ProviderConfig,
  EngineMode,
} from './types.ts'

// Store
export { WebStore } from './store/index.ts'
export type {
  WebStoreOptions,
  StoredSearch,
  StoredPage,
  WebStoreStats,
  SearchRecordInput,
  PageRecordInput,
} from './store/index.ts'

// Engines (advanced composition; createWebStack builds these internally)
export { buildEngines, DEFAULT_BLOCKED_DOMAINS, explicitOnlyEngineIds } from './search/engines/factory.ts'
export type { SearchEngine, EngineSearchResult, SearchEngineDeps, SecretSpec, SecretResolver } from './search/engines/types.ts'

// Search internals (router, cache key)
export { MultiSearchProvider, MULTI_SEARCH_PROVIDER_ID, searchCacheKey } from './search/provider.ts'

// Fetch internals
export { CachedHttpFetchProvider, CACHED_FETCH_PROVIDER_ID, checkSsrf, buildFetchLimits } from './fetch/index.ts'
export type { CachedFetchLimits, SsrfCheckResult } from './fetch/index.ts'

// Platforms
export { BUILTIN_PLATFORMS } from './platforms/builtins.ts'
export { PlatformRegistry } from './platforms/registry.ts'
export { validatePlatform, validateRulePack, importRulePack, exportRulePack } from './platforms/rulepacks.ts'
export type { Platform, PlatformSearchArgs, PlatformSearchResult, PlatformSource } from './platforms/types.ts'

// Tools
export {
  buildCoreTools,
  buildSearchTool,
  buildFetchTool,
  buildPlatformSearchTool,
  buildHistoryTool,
  buildStatsTool,
  buildCacheClearTool,
  type ToolHost,
} from './tools/index.ts'

// Browser module (ADR-005 §4, Q8; opt-in via config.browser.enabled)
export {
  BROWSER_CODES,
  PlaywrightProvider,
  assertPublicNavigation,
  createBrowserManager,
  buildBrowserTools,
  writeScreenshot,
  ANON_KEY,
  loadPlaywright,
  type BrowserManager,
  type BrowserManagerOptions,
  type BrowserSession,
  type BrowserSnapshot,
  type BrowserSnapshotOptions,
  type BrowserElement,
  type BrowserNavigateResult,
  type BrowserOpenOptions,
  type BrowserScreenshot,
  type BrowserScreenshotOptions,
  type BrowserTarget,
  type BrowserCode,
  type CoreBrowserProvider,
  type PlaywrightProviderConfig,
  type BrowserToolDeps,
} from './browser/index.ts'


// Utilities
export { htmlToMarkdown } from './markdown.ts'
export { normalizeUrl } from './search/url.ts'
export { PRODUCT_USER_AGENT } from './user-agent.ts'
