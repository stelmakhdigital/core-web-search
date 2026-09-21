/**
 * Core fetch layer: the SQLite-cached anonymous public HTTP(S) fetcher.
 * The ported `CachedHttpFetchProvider` owns transport + cache semantics; this
 * module provides the limits builder from the resolved core config.
 *
 * The page cache lives in the shared web store (the same `web_pages` table the
 * search enrichment writes), so a page fetched by `web_fetch` is reused by
 * `web_search` enrichment and vice versa.
 * @module @agents-web-search/core/fetch
 */

import path from 'node:path'

import type { ResolvedCoreConfig } from '../config.ts'
import type { WebStore } from '../store/index.ts'
import type { CachedFetchLimits } from './provider.ts'
import { CACHED_FETCH_PROVIDER_ID, CachedHttpFetchProvider } from './provider.ts'

export { CACHED_FETCH_PROVIDER_ID, CachedHttpFetchProvider } from './provider.ts'
export type { CachedFetchLimits } from './provider.ts'
export { checkSsrf, SsrfBlockedError, fetchPublic, SSRF_MAX_REDIRECTS } from './ssrf.ts'
export type { SsrfCheckResult } from './ssrf.ts'
export { validateFetchUrl, isSameOrigin, parseCharset, decoderForCharset, classifyContentType, type FetchableKind } from './policy.ts'
export { normalizeUrl as normalizeFetchUrl } from './url.ts'

/**
 * Build the resolved fetch limits from the core config.
 * `userAgent` is host-injected (product UA with host identity; ADR-005 §5).
 */
export function buildFetchLimits(
  config: ResolvedCoreConfig,
  store: WebStore,
  userAgent: string,
): CachedFetchLimits {
  return {
    maxUrlLength: 2048,
    maxResponseBytes: config.fetch.maxBodyBytes,
    maxBodyChars: config.fetch.maxOutputChars,
    timeoutMs: config.fetch.timeoutMs,
    maxRedirects: config.fetch.maxRedirects,
    userAgent,
    cacheTtlMs: config.fetch.cacheTtlMs,
    store,
    revalidate: config.fetch.revalidate,
    allowPrivateNetworks: config.fetch.allowPrivateNetworks,
    pdf: config.fetch.pdf,
    video: config.fetch.video,
    github: {
      enabled: config.fetch.github.enabled,
      maxCloneBytes: config.fetch.github.maxCloneBytes,
      maxTreeEntries: config.fetch.github.maxTreeEntries,
      maxFileBytes: config.fetch.maxBodyBytes,
      clonesDir: path.join(path.dirname(config.store.path), 'github-clones'),
    },
  }
}
