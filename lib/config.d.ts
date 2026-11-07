/**
 * Core configuration: defaults and resolution (port of the dsh-web-automation
 * "every field is defaulted" model — an empty config yields the full keyless
 * local web stack). Validation is dependency-free (no schema library): types,
 * ranges, absolute URLs, and known engine ids. Failures throw
 * `CoreError('WEB_BAD_REQUEST')` with the offending path.
 * @module @agents-web-search/core/config
 */
import type { CoreConfig } from './types.ts';
/** Default engine list: the local SearXNG instance first, then the keyless
 * public chain (DDG + Bing). A dead SearXNG instance fails fast (ECONNREFUSED
 * or the connect guard) and the router cools it down and falls through. */
export declare const DEFAULT_ENGINES: readonly ["searxng", "ddg", "bing"];
/** Engines the core knows how to build (registry membership). */
export declare const KNOWN_ENGINES: readonly ["ddg", "bing", "searxng", "exa", "jina", "tavily", "brave", "ollama", "openai", "xai", "anthropic", "deepseek", "gemini", "perplexity"];
export type KnownEngine = (typeof KNOWN_ENGINES)[number];
/** Fully-resolved configuration (every field present). */
export interface ResolvedCoreConfig {
    readonly search: {
        readonly engines: readonly string[];
        readonly mode: 'fallback' | 'fuse';
        readonly region: string;
        readonly freshness: string;
        readonly rateLimitPerSec: number;
        readonly timeoutMs: number;
        readonly cacheTtlMs: number;
        readonly maxSerpBytes: number;
        readonly enrich: {
            readonly enabled: boolean;
            readonly fetchLimit: number;
            readonly keep: number;
            readonly fetchTimeoutMs: number;
        };
        readonly embed: {
            readonly endpoint: string;
            readonly model: string;
            readonly timeoutMs: number;
        } | undefined;
    };
    readonly fetch: {
        readonly cacheTtlMs: number;
        /** In-memory page cache cap (entries, front layer over the store); 0 disables. */
        readonly memoryCacheMaxEntries: number;
        readonly revalidate: boolean;
        readonly maxBodyBytes: number;
        readonly maxOutputChars: number;
        readonly timeoutMs: number;
        readonly maxRedirects: number;
        readonly allowPrivateNetworks: boolean;
        /** PDF extraction (resolved). */
        readonly pdf: {
            readonly enabled: boolean;
            readonly maxSizeBytes: number;
            readonly maxPages: number;
        };
        /** YouTube video enrichment (resolved). */
        readonly video: {
            readonly enabled: boolean;
        };
        /** GitHub enrichment (resolved). */
        readonly github: {
            readonly enabled: boolean;
            readonly maxCloneBytes: number;
            readonly maxTreeEntries: number;
        };
    };
    readonly platforms: {
        readonly enabled: boolean;
        readonly maxResults: number;
        readonly timeoutMs: number;
        readonly maxBytes: number;
        readonly allowPrivateNetworks: boolean;
        readonly platforms: readonly unknown[];
        readonly rulePackPaths: readonly string[];
    };
    readonly store: {
        readonly path: string;
        readonly evictLimits: {
            readonly maxSearches: number;
            readonly maxPages: number;
        };
    };
    readonly ssrf: {
        readonly trustEnvProxy: boolean;
    };
    readonly browser: {
        readonly enabled: boolean;
        readonly headless: boolean;
        readonly approval: 'never' | 'navigate' | 'all';
        readonly allowPrivateNetworks: boolean;
        readonly maxConcurrentTabs: number;
        readonly screenshotInlineDefault: boolean;
        readonly timeoutMs: number;
        readonly authProfiles: Record<string, string>;
    };
    readonly providers: NonNullable<CoreConfig['providers']>;
    readonly extended: {
        readonly pdf: {
            readonly enabled: boolean;
            readonly provider: 'auto' | 'local' | 'datalab' | 'gemini';
            readonly maxSizeMB: number;
            readonly maxPages: number;
        };
        readonly video: {
            readonly enabled: boolean;
        };
        readonly github: {
            readonly clone: {
                readonly enabled: boolean;
                readonly maxSizeMB: number;
            };
        };
        readonly curator: {
            readonly enabled: boolean;
            readonly bind: string;
            readonly host: string;
            readonly remote: boolean;
        };
    };
}
/**
 * Resolve a partial host-supplied config into the fully-defaulted shape.
 * `stateDir` supplies the default store path.
 */
export declare function resolveCoreConfig(partial: CoreConfig | undefined, stateDir: string): ResolvedCoreConfig;
