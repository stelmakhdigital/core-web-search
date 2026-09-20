/**
 * Public types of the web-search core: request/result shapes, the host-agnostic
 * tool surface, the host contract (HostAdapter), and the core configuration
 * schema. Everything here is agent-agnostic (Q9): no host types, no host imports.
 *
 * The search result shape is deliberately 1:1 compatible with the DSH web seam
 * (`SearchResult`/`SearchSource`) so the DSH adapter maps without data loss.
 * @module @agents-web-search/core/types
 */

/** One citeable source (the DSH seam's portable citation shape). */
export interface SearchSource {
  readonly url: string
  readonly title?: string
  readonly snippet?: string
  /** Publication/crawl timestamp as an ISO-8601 string (when the engine knows it). */
  readonly publishedAt?: string
  /** Engine id that produced the source (set by the router; not part of the DSH seam). */
  readonly engine?: string
}

/** What one search request asks for (a single query; consumers may issue several). */
export interface SearchRequest {
  readonly query: string
  /** Upper bound on returned sources (1..20); the stack truncates to it. */
  readonly maxResults?: number
  /** Freshness hint; honored by engines that support it (bing, searxng, exa, ...). */
  readonly recency?: 'day' | 'week' | 'month' | 'year'
  /** Domain filters: plain = include, `-` prefix = exclude. */
  readonly domains?: readonly string[]
  /** 'auto' (default) or a forced engine id (strict: no fallback). */
  readonly engine?: string
}

/** Normalized search outcome. */
export interface SearchResult {
  /** Optional provider-generated answer text (provider-native engines). */
  readonly content?: string
  /** Citeable sources, truncated to the request's maxResults. */
  readonly sources: readonly SearchSource[]
  readonly truncated: boolean
  /** Engine ids that produced the result (routing diagnostics; set by the router). */
  readonly enginesUsed?: readonly string[]
  /** True when the result came from the search cache. */
  readonly fromCache?: boolean
}

/** One fetch of a URL. */
export interface FetchRequest {
  readonly url: string
  /** 'readable' (default): HTML is extracted and converted to markdown.
   *  'raw': the decoded body as-is (HTML stays HTML). */
  readonly mode?: 'readable' | 'raw'
}

/** The decoded body of a fetched resource (core-closed union; adapters may extend). */
export type FetchBody =
  | { readonly kind: 'html'; readonly content: string }
  | { readonly kind: 'text'; readonly content: string }

/** Normalized fetch outcome (final URL + status + classified body). */
export interface FetchResult {
  readonly url: string
  readonly statusCode: number
  readonly body: FetchBody
  readonly truncated: boolean
  /** True when served from the page cache (fresh or revalidated). */
  readonly fromCache?: boolean
  /** Content kind auto-detection (phase 5: github/youtube/pdf/video/image). */
  readonly kind?: 'web' | 'github' | 'youtube' | 'pdf' | 'video' | 'image'
}

/** One platform search (config-driven platform endpoints; see ADR-003 §5). */
export interface PlatformSearchRequest {
  readonly platform: string
  readonly query: string
  readonly maxResults?: number
}

export interface PlatformSource {
  readonly url: string
  readonly title?: string
  readonly snippet?: string
  readonly publishedAt?: string
  /** Platform id (set by the platform registry; mirrors the platform-level field). */
  readonly platform?: string
}

export interface PlatformSearchResult {
  readonly sources: readonly PlatformSource[]
  readonly platform: string
  readonly query?: string
  readonly truncated?: boolean
}

/* ------------------------------------------------------------------ tools */

/**
 * A host-agnostic tool definition (ADR-002). `parameters` is JSON Schema
 * draft 2020-12, owned by the core; host adapters convert it to their schema
 * language (DSH: schemastery; Pi: typebox) and enforce host output caps.
 */
export interface ToolSpec {
  /** Product-level tool name (e.g. `web_search`). */
  readonly name: string
  /** LLM-facing description. */
  readonly description: string
  /** Parameter schema (JSON Schema draft 2020-12 object). */
  readonly parameters: Readonly<Record<string, unknown>>
  /** Advisory output cap (chars); hosts may apply stricter host-level caps. */
  readonly maxOutputChars?: number
  /** Execute the tool. `args` is validated against `parameters` by the caller. */
  readonly execute: (
    args: unknown,
    ctx: { readonly signal: AbortSignal; readonly onUpdate?: (partial: ToolOutput) => void },
  ) => Promise<ToolOutput>
}

/** One tool output: model-facing text + host renderable details. */
export interface ToolOutput {
  readonly text: string
  /** Opaque, host-rendered state (caches, diagnostics). */
  readonly details?: unknown
  readonly isError?: boolean
}

/* --------------------------------------------------------------- approval */

/** A sensitive-operation confirmation request (ADR-005 §3). */
export interface ApprovalRequest {
  readonly kind: 'browser_navigate' | 'browser_evaluate' | 'browser_click' | 'browser_type' | 'curator_remote' | (string & {})
  /** Human-readable description (URL/action; never secrets). */
  readonly description: string
}

/* ----------------------------------------------------------------- llm */

/**
 * Minimal LLM client for AUXILIARY generation only (curator summaries, answer
 * mode, video descriptions). Provider-native search does NOT use this: it is
 * implemented as HTTP engines in the core (ADR-004).
 */
export interface LlmClient {
  complete(
    req: { readonly prompt: string; readonly model?: string; readonly maxTokens?: number; readonly signal?: AbortSignal },
  ): Promise<{ readonly text: string; readonly model?: string; readonly usage?: { readonly in: number; readonly out: number } }>
}

/* ---------------------------------------------------------- host adapter */

/**
 * The host contract (ADR-002): the minimal surface the core expects from an
 * agent host. DSH, Pi, and future agents each implement it; the core imports
 * nothing host-specific.
 */
export interface HostAdapter {
  /** Host identity: { name: 'dsh' | 'pi' | custom, version? } — UA, logs, stats. */
  readonly identity: { readonly name: string; readonly version?: string }
  /** The resolved core configuration (the adapter maps host config → CoreConfig). */
  readonly config: CoreConfig
  /** Host state paths. `stateDir` is required (store, caches); `tempDir` for temp files. */
  readonly paths: { readonly stateDir: string; readonly tempDir?: string }
  /**
   * Resolve a secret by name (env/config/credentials domain of the host).
   * Names: `websearch:<engine>` (e.g. `websearch:exa`). `undefined` = absent.
   */
  credential(name: string): Promise<string | undefined>
  /**
   * Register the core's tool specs with the host's mechanism and return a
   * disposer. The adapter filters specs (e.g. DSH keeps web_search/web_fetch
   * host-registered) and converts schemas.
   */
  registerTools(specs: readonly ToolSpec[]): () => void
  /** Map a core error to a host error (DSH: CoreError; Pi: thrown Error). */
  toHostError(error: unknown): unknown
  /**
   * Confirm a sensitive operation. When the host has NO `approve`, the core
   * DENIES the operation (fail-closed, ADR-005 §3).
   */
  approve?(request: ApprovalRequest): Promise<boolean>
  /** Auxiliary LLM client (optional; generation features degrade without it). */
  readonly llm?: LlmClient
  /** Host logging (optional). The core never logs secrets. */
  log?(level: 'debug' | 'info' | 'warn' | 'error', message: string, meta?: Record<string, unknown>): void
  /** Lifecycle (optional): before first operation / on stack disposal. */
  init?(): Promise<void>
  dispose?(): Promise<void>
}

/* ---------------------------------------------------------------- config */

export type EngineMode = 'fallback' | 'fuse'

/** Provider (API / provider-native) configuration. */
export interface ProviderConfig {
  /** Endpoint base override (e.g. `https://api.openai.com/v1`). */
  readonly baseUrl?: string
  /** Model id (defaults are documented per engine; may age — set explicitly in prod). */
  readonly model?: string
  /** Explicit API key (literal). Wins over `credential` and env (ADR-002 §6). */
  readonly apiKey?: string
  /** Env var name fallback (e.g. `OPENAI_API_KEY`). */
  readonly apiKeyEnv?: string
  /** Explicit-only engines never join the `auto` chain (cost guard; xai default). */
  readonly explicitOnly?: boolean
  /** Max provider-side search uses/depth per request (engine-specific meaning). */
  readonly maxUses?: number
  /** Per-request timeout (ms). */
  readonly timeoutMs?: number
}

/** The full core configuration. Every field is defaulted (empty = keyless stack). */
export interface CoreConfig {
  readonly search?: {
    /** Ordered engine ids (priority order). Default: `['ddg', 'bing']`. */
    readonly engines?: readonly string[]
    /** 'fallback' (default) = first success wins; 'fuse' = parallel + RRF. */
    readonly mode?: EngineMode
    /** Region/market hint (DDG `kl`, Bing `setmkt`). */
    readonly region?: string
    /** Freshness default: '24h' | 'week' | 'month' | 'year' (honor-supporting engines). */
    readonly freshness?: string
    /** Per-engine rate limit (requests/second). Default 1. */
    readonly rateLimitPerSec?: number
    /** Overall search deadline (ms). Default 30000. */
    readonly timeoutMs?: number
    /** Search result cache TTL (ms). Default 900000 (15 min). */
    readonly cacheTtlMs?: number
    /** Hard cap on one SERP body (bytes). Default 2 MiB. */
    readonly maxSerpBytes?: number
    /** Enrichment (fetch top candidates, extract, re-rank). */
    readonly enrich?: {
      readonly enabled?: boolean
      /** How many top candidates to fetch. Default 6. */
      readonly fetchLimit?: number
      /** How many enriched sources to keep. Default 5. */
      readonly keep?: number
      /** Per-page enrichment fetch timeout (ms). Default 10000. */
      readonly fetchTimeoutMs?: number
    }
    /** Embedding re-rank endpoint (Ollama or any /embeddings). Fallback: BM25. */
    readonly embed?: {
      readonly endpoint: string
      readonly model?: string
      readonly timeoutMs?: number
    }
  }
  readonly fetch?: {
    /** Page cache TTL (ms). Default 24h. */
    readonly cacheTtlMs?: number
    /** Conditional revalidation (ETag/Last-Modified) for fresh-but-expired pages. Default true. */
    readonly revalidate?: boolean
    /** Maximum response body (bytes). Default 5 MiB. */
    readonly maxBodyBytes?: number
    /** Maximum decoded body (chars); output truncation cap. Default 100000. */
    readonly maxOutputChars?: number
    /** Fetch timeout (ms). Default 30000. */
    readonly timeoutMs?: number
    /** Same-origin redirect hops to follow (each hop re-checks SSRF). Default 5. */
    readonly maxRedirects?: number
    /** Allow private/reserved network targets (SSRF opt-out; trusted envs only). Default false. */
    readonly allowPrivateNetworks?: boolean
  }
  readonly platforms?: {
    readonly enabled?: boolean
    /** Upper bound on sources per call. Default 20. */
    readonly maxResults?: number
    readonly timeoutMs?: number
    /** Cap on one fetched platform body (bytes). Default 5 MiB. */
    readonly maxBytes?: number
    readonly allowPrivateNetworks?: boolean
    /** Platform definitions (override built-ins by id, or add new). */
    readonly platforms?: readonly unknown[]
    /** Rule-pack JSON file paths (highest precedence; hot-reloaded by mtime). */
    readonly rulePackPaths?: readonly string[]
  }
  readonly store?: {
    /** SQLite file path. Default: `<host.paths.stateDir>/web.db`. */
    readonly path?: string
    /** LRU eviction caps. */
    readonly evictLimits?: { readonly maxSearches?: number; readonly maxPages?: number }
  }
  readonly ssrf?: {
    /**
     * Opt-in: skip the local DNS preflight for hostnames proxied via
     * HTTP_PROXY/HTTPS_PROXY/ALL_PROXY (NO_PROXY still validated; literal
     * private targets always blocked). Default false.
     */
    readonly trustEnvProxy?: boolean
  }
  readonly browser?: {
    /** Enable the Playwright browser module. Default false (Q8). */
    readonly enabled?: boolean
    /** Run the browser headless (no visible window). Default true. */
    readonly headless?: boolean
    /** Approval policy: 'never' | 'navigate' | 'all'. Default 'navigate'. */
    readonly approval?: 'never' | 'navigate' | 'all'
    readonly allowPrivateNetworks?: boolean
    /** Concurrent browser sessions (tabs). Default 1. */
    readonly maxConcurrentTabs?: number
    /** Default screenshot mode: file (false) or inline base64 (true). */
    readonly screenshotInlineDefault?: boolean
    readonly timeoutMs?: number
    /** Auth profiles: name → Playwright storage-state file path. */
    readonly authProfiles?: Record<string, string>
  }
  /** Provider settings for API and provider-native engines (ADR-004). */
  readonly providers?: {
    readonly openai?: ProviderConfig
    readonly xai?: ProviderConfig
    readonly anthropic?: ProviderConfig
    readonly deepseek?: ProviderConfig
    readonly gemini?: ProviderConfig
    readonly perplexity?: ProviderConfig
    readonly exa?: { readonly apiKey?: string; readonly apiKeyEnv?: string; readonly baseUrl?: string }
    readonly tavily?: { readonly apiKey?: string; readonly apiKeyEnv?: string; readonly baseUrl?: string }
    readonly brave?: { readonly apiKey?: string; readonly apiKeyEnv?: string; readonly baseUrl?: string }
    readonly jina?: { readonly apiKey?: string; readonly apiKeyEnv?: string; readonly baseUrl?: string }
    readonly searxng?: { readonly endpoint?: string; readonly formats?: readonly ('html' | 'json')[] }
    readonly ollama?: { readonly endpoint?: string }
  }
  /** Extended fetch features (phase 5; schema present from v1 — ADR-003 §4). */
  readonly extended?: {
    readonly pdf?: {
      readonly enabled?: boolean
      readonly provider?: 'auto' | 'local' | 'datalab' | 'gemini'
      readonly maxSizeMB?: number
      readonly maxPages?: number
    }
    readonly video?: { readonly enabled?: boolean }
    readonly github?: { readonly clone?: { readonly enabled?: boolean; readonly maxSizeMB?: number } }
    readonly curator?: {
      readonly enabled?: boolean
      readonly bind?: string
      readonly host?: string
      readonly remote?: boolean
    }
    readonly contentCache?: {
      readonly maxEntries?: number
      readonly maxBytes?: number
      readonly ttlMs?: number
    }
  }
}
