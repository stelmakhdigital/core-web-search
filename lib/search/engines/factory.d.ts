/**
 * Engine factory: builds every known engine from the resolved core config and
 * the host's per-search secret resolver. Engines are constructed eagerly;
 * `available()` (cheap, no network) decides participation at routing time, so
 * a keyless deployment simply sees the key engines as unavailable.
 * @module @agents-web-search/core/search/engines/factory
 */
import type { ResolvedCoreConfig } from '../../config.ts';
import type { HostAdapter } from '../../types.ts';
import type { SearchEngine } from './types.ts';
export interface EngineFactoryOptions {
    readonly config: ResolvedCoreConfig;
    readonly host: HostAdapter;
    /** Product user-agent (host identity included). */
    readonly userAgent: string;
}
/** Default blocked SERP domains (search-engine/CDN noise). */
export declare const DEFAULT_BLOCKED_DOMAINS: readonly ["duckduckgo.com", "bing.com", "microsoft.com", "google.com", "googleapis.com", "gstatic.com", "w3.org", "schema.org"];
/**
 * Build the full engine map (id → engine). All 14 known engines are
 * constructed; the router filters by `config.search.engines`, `available()`,
 * cooldowns, and `explicitOnly` (ADR-004/006).
 */
export declare function buildEngines(options: EngineFactoryOptions): Map<string, SearchEngine>;
/** Engines excluded from the `auto` chain unless explicitly requested (cost guard; ADR-004). */
export declare function explicitOnlyEngineIds(config: ResolvedCoreConfig): ReadonlySet<string>;
