/**
 * `CachedHttpFetchProvider`: an anonymous public HTTP(S) `WebFetchProvider`
 * with a SQLite-backed page cache (the shared web store). Transport hygiene
 * mirrors `@deepseek-ai/dsh-web-fetch-http` (the two MUST evolve together);
 * this provider adds TTL caching, ETag/Last-Modified conditional
 * revalidation, and stale-on-error serving.
 *
 * Only 2xx results are cached: a 404 or 500 may become a 200, so non-2xx
 * responses always pass through to the network. The page cache is shared with
 * the search provider's enrichment (same `web_pages` table), so a page
 * fetched by `web_fetch` is reused by `web_search` and vice versa.
 *
 * Private-network and SSRF protection is enforced by default: the guard
 * blocks requests to loopback, private, link-local, and otherwise reserved
 * targets (checked on the literal host and after DNS resolution, against
 * rebinding). Set `allowPrivateNetworks: true` to disable the guard in a
 * trusted, network-isolated environment.
 * @module dsh-web-automation/fetch/provider
 */
import type { FetchRequest, FetchResult } from '../types.ts';
import type { WebStore } from '../store/index.ts';
import { type PdfLimits } from './pdf.ts';
/** Resolved provider limits and cache settings. */
export interface CachedFetchLimits {
    /** Maximum accepted request URL length. */
    maxUrlLength: number;
    /** Maximum response body size in bytes (read is aborted past this). */
    maxResponseBytes: number;
    /** Maximum decoded body length in characters (truncated past this). */
    maxBodyChars: number;
    /** Fetch timeout in milliseconds. */
    timeoutMs: number;
    /** Maximum number of (same-origin) redirect hops to follow. */
    maxRedirects: number;
    /** `User-Agent` header sent on every request. */
    userAgent: string;
    /** Time-to-live in milliseconds for cached pages. */
    cacheTtlMs: number;
    /** In-memory page cache cap (entries); 0/undefined disables the memory layer. */
    memoryCacheMaxEntries?: number;
    /** The shared web store (page cache). */
    store: WebStore;
    /** Issue conditional revalidation requests for fresh-but-expired entries. */
    revalidate: boolean;
    /**
     * Allow requests to private/reserved network targets (loopback, LAN,
     * link-local). Defaults to false: the SSRF guard blocks these so the
     * plugin cannot probe internal infrastructure. Enable only in a trusted,
     * network-isolated environment (e.g. a container with no internal routes).
     */
    allowPrivateNetworks: boolean;
    /**
     * PDF extraction (roadmap 5.1). `application/pdf` responses are extracted
     * to markdown (body kind `text`, cached like any page) instead of failing
     * with `WEB_UNSUPPORTED_CONTENT_TYPE` when `enabled`.
     */
    pdf: PdfLimits;
    /**
     * YouTube video enrichment (roadmap 5.2). Watch URLs are enriched into a
     * markdown document (oEmbed + meta description + public transcript).
     */
    video: {
        readonly enabled: boolean;
    };
    /**
     * GitHub enrichment (roadmap 5.3). Repository/tree/file URLs are served
     * from a shallow clone; PR/issue URLs from the keyless REST API.
     */
    github: {
        readonly enabled: boolean;
        readonly maxCloneBytes: number;
        readonly maxTreeEntries: number;
        readonly maxFileBytes: number;
        readonly clonesDir: string;
        /** Test-only override for the git clone source. */
        readonly sourceResolver?: (t: import('./github.ts').GitHubTarget) => string;
    };
}
/** Stable id this provider registers under. */
export declare const CACHED_FETCH_PROVIDER_ID = "cached-http";
/** The SQLite-cached anonymous public HTTP(S) fetch provider. */
export declare class CachedHttpFetchProvider {
    private readonly limits;
    readonly id = "cached-http";
    private readonly memory;
    constructor(limits: CachedFetchLimits);
    /** Drop the in-memory page layer (wired into `web_cache_clear`). */
    clearMemoryCache(): void;
    /** No credentials to check — an anonymous public fetcher is always usable. */
    available(): boolean;
    /** Fetch one URL, serving from the cache when fresh. */
    fetch(request: FetchRequest, signal?: AbortSignal): Promise<FetchResult>;
    /**
     * Assert a URL is public (not a private/reserved network target). Throws a
     * `WEB_SSRF_BLOCKED` error when the guard blocks the URL. The check runs on
     * the literal host and after DNS resolution (against rebinding).
     * @param url - the URL to check.
     */
    private assertPublic;
    /** Fetch from the network, cache a 2xx result, and return it. */
    private fetchFresh;
    /** Record one fetched 2xx page in the store and the memory layer; returns
     * the result with `pageId` when the store accepted the row. */
    private persistPage;
    /**
     * Conditional revalidation of a TTL-expired cache entry. A 304 refreshes
     * the timestamp and serves the stale body; a 2xx reads the new body from
     * the conditional response itself (one request, no second full GET) and
     * re-caches it with the fresh ETag/Last-Modified; anything else (redirects,
     * errors) falls through to a full fetch. A transport failure serves the
     * stale body (stale-on-error) rather than failing the call; caller
     * cancellation and our own timeout still fail loudly.
     */
    private revalidate;
    /** Follow same-origin redirects up to the hop cap, then read the final response. */
    private followAndRead;
    /**
     * The video branch (5.2): a YouTube watch URL fetched as a regular page is
     * enriched into a markdown document (oEmbed + meta description + public
     * transcript). Each stage is fail-soft — only when ALL of them fail does
     * the call reject (`WEB_NOT_AVAILABLE`). Non-video URLs (or the feature
     * disabled) fall through to the regular body read.
     */
    private readVideoOrBody;
    /**
     * Run one fail-soft video stage: any error (transport, HTTP, parse) yields
     * `undefined` rather than failing the whole fetch.
     */
    private videoStage;
    /**
     * A guarded sub-request for the video stages (SSRF-checked on the initial
     * URL AND on every redirect hop via fetchPublic — a redirect from the
     * video host to a private address must not be followed; 6.3), UA header,
     * non-2xx rejects.
     */
    private videoSubFetch;
    private requestOnce;
    /** Read, byte-cap, classify, and decode the final response body. */
    private readBody;
    /**
     * Read the response stream up to `maxBytes`. A `Content-Length` over the
     * cap rejects immediately with `WEB_FETCH_TOO_LARGE`; a stream that grows
     * past the cap is cut short (`truncatedByBytes`) rather than rejected.
     */
    private readCapped;
}
