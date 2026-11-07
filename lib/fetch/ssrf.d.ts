/**
 * SSRF guard for the cached fetch provider. Blocks requests to private,
 * loopback, link-local, and otherwise non-public network targets so the
 * plugin cannot be used to probe internal infrastructure (cloud metadata
 * endpoints, LAN services, localhost) through the model's `web_fetch` tool.
 *
 * The check runs twice: once on the literal hostname (catches IP-literal
 * URLs) and once after DNS resolution (catches domains that resolve to
 * private addresses, including DNS-rebinding). A request is allowed only if
 * every resolved address is public. Embedded-IPv4 forms (IPv4-mapped
 * `::ffff:a.b.c.d`, IPv4-compatible `::a.b.c.d`, NAT64 `64:ff9b::a.b.c.d`)
 * are checked through their IPv4 tail, so `[::ffff:127.0.0.1]` is blocked
 * like `127.0.0.1`.
 * @module dsh-web-automation/fetch/ssrf
 */
/**
 * Result of an SSRF check for one URL.
 */
export interface SsrfCheckResult {
    /** Whether the URL is allowed (public). */
    allowed: boolean;
    /** The reason the URL was blocked (when not allowed). */
    reason?: string;
    /** The resolved addresses (for diagnostics). */
    addresses?: string[];
}
/**
 * Check a URL against the SSRF policy. The hostname is checked as a literal
 * (catches IP-literal URLs) and, when it is a domain, resolved via DNS and
 * every resolved address is checked (catches private domains and
 * DNS-rebinding). A URL is allowed only if every resolved address is public.
 * @param url - the absolute http(s) URL to check.
 * @param options - optional overrides.
 * @param options.allowPrivate - when true, skip the check (allow all).
 * @returns the check result.
 */
export declare function checkSsrf(url: string, options?: {
    allowPrivate?: boolean;
}): Promise<SsrfCheckResult>;
/**
 * A URL (or a redirect hop) was rejected by the SSRF guard. Callers that must
 * fail loudly (tools) translate this into a `CoreError`; callers that degrade
 * gracefully (search enrichment) skip the page.
 */
export declare class SsrfBlockedError extends Error {
    /** The guard's block reason. */
    readonly reason: string;
    /** The blocked URL. */
    readonly url: string;
    constructor(url: string, reason: string);
}
/** Maximum redirect hops followed by {@link fetchPublic}. */
export declare const SSRF_MAX_REDIRECTS = 5;
/**
 * Fetch a URL with the SSRF guard enforced on the initial URL and on EVERY
 * redirect hop: cross-origin redirects are allowed, but only to public
 * addresses (a public URL that 302s to the cloud metadata endpoint is
 * blocked). The guard is re-run per hop, which also bounds the TOCTOU window
 * to a single hop.
 *
 * Returns the final `Response` — the caller owns reading/cancelling its body.
 * Network failures propagate unchanged (the caller classifies them); a guard
 * block rejects with {@link SsrfBlockedError}.
 * @param url - the absolute http(s) URL to fetch.
 * @param options - guard and request options.
 * @returns the final response after following (public) redirects.
 */
export declare function fetchPublic(url: string, options?: {
    allowPrivate?: boolean;
    headers?: Record<string, string>;
    signal?: AbortSignal;
    maxRedirects?: number;
}): Promise<Response>;
