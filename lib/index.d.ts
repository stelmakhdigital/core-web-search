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
export { createWebStack, type WebStack } from './stack.ts';
export { resolveCoreConfig, DEFAULT_ENGINES, KNOWN_ENGINES, type ResolvedCoreConfig, type KnownEngine } from './config.ts';
export { SEARXNG_DEFAULT_ENDPOINT } from './search/engines/searxng.ts';
export { CoreError, isCoreError, toCoreError, errorCodeOf, errorMessage, type CoreErrorCode, } from './errors.ts';
export { deadline, timeoutOf, TimeoutReason, type Deadline } from './timeout.ts';
export type { SearchSource, SearchRequest, SearchResult, FetchRequest, FetchBody, FetchResult, PlatformSearchRequest, PlatformSource as CorePlatformSource, PlatformSearchResult as CorePlatformSearchResult, ToolSpec, ToolOutput, ApprovalRequest, LlmClient, HostAdapter, CoreConfig, ProviderConfig, EngineMode, } from './types.ts';
export { WebStore } from './store/index.ts';
export { startCuratorServer, isLoopback, type CuratorOptions, type CuratorHandle, type CuratorEntry } from './curator/index.ts';
export type { WebStoreOptions, StoredSearch, StoredPage, WebStoreStats, SearchRecordInput, PageRecordInput, } from './store/index.ts';
export { buildEngines, DEFAULT_BLOCKED_DOMAINS, explicitOnlyEngineIds } from './search/engines/factory.ts';
export type { SearchEngine, EngineSearchResult, SearchEngineDeps, SecretSpec, SecretResolver } from './search/engines/types.ts';
export { MultiSearchProvider, MULTI_SEARCH_PROVIDER_ID, searchCacheKey, type EngineDiagnostics } from './search/provider.ts';
export { CachedHttpFetchProvider, CACHED_FETCH_PROVIDER_ID, checkSsrf, buildFetchLimits } from './fetch/index.ts';
export type { CachedFetchLimits, SsrfCheckResult } from './fetch/index.ts';
export { BUILTIN_PLATFORMS } from './platforms/builtins.ts';
export { PlatformRegistry } from './platforms/registry.ts';
export { validatePlatform, validateRulePack, importRulePack, exportRulePack } from './platforms/rulepacks.ts';
export type { Platform, PlatformSearchArgs, PlatformSearchResult, PlatformSource } from './platforms/types.ts';
export { buildCoreTools, buildSearchTool, buildFetchTool, buildGetSearchContentTool, buildPlatformSearchTool, buildHistoryTool, buildStatsTool, buildCacheClearTool, type ToolHost, } from './tools/index.ts';
export { BROWSER_CODES, PlaywrightProvider, assertPublicNavigation, createBrowserManager, buildBrowserTools, browserReadiness, writeScreenshot, ANON_KEY, loadPlaywright, type BrowserManager, type BrowserManagerOptions, type BrowserSession, type BrowserSnapshot, type BrowserSnapshotOptions, type BrowserElement, type BrowserNavigateResult, type BrowserOpenOptions, type BrowserScreenshot, type BrowserScreenshotOptions, type BrowserTarget, type BrowserCode, type CoreBrowserProvider, type PlaywrightProviderConfig, type BrowserToolDeps, type BrowserReadiness, } from './browser/index.ts';
export { htmlToMarkdown } from './markdown.ts';
export { normalizeUrl } from './search/url.ts';
export { PRODUCT_USER_AGENT } from './user-agent.ts';
