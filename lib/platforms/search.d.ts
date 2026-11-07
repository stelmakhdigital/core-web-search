/**
 * Platform search execution: resolve the platform, build the search URL, fetch
 * it (with the platform's headers and a deadline), and parse the results by
 * format. Fetches go directly (not through `ctx.web`) because platforms need
 * per-request headers the fetch seam does not carry. Errors are classified into
 * the web family's `CoreError` codes.
 * @module @agents-web-search/core/platforms/search
 */
import type { PlatformRegistry } from './registry.ts';
import type { PlatformSearchArgs, PlatformSearchResult } from './types.ts';
/** Execution dependencies for a platform search. */
export interface PlatformSearchDeps {
    /** The platform registry. */
    registry: PlatformRegistry;
    /** Per-search deadline (ms). */
    timeoutMs: number;
    /** Cap on one fetched body (bytes). */
    maxBytes: number;
    /** The tool-level result cap (clamps `limit`). */
    maxResults: number;
    /**
     * Allow platform fetches to private/reserved network targets (loopback,
     * LAN, link-local). Defaults to false: the SSRF guard blocks these. The
     * guard matters for the `rss` platform, whose query IS the fetched URL.
     */
    allowPrivateNetworks: boolean;
}
/**
 * Run one platform search.
 * @param args - the validated tool arguments.
 * @param deps - the execution dependencies.
 * @param signal - the caller cancellation signal.
 * @returns the parsed, capped result.
 */
export declare function searchPlatform(args: PlatformSearchArgs, deps: PlatformSearchDeps, signal: AbortSignal): Promise<PlatformSearchResult>;
