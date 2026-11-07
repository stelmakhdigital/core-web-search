/**
 * Local Playwright (Chromium) provider for the browser module. Launches a real
 * browser on the host and drives one page. Interactive elements are tagged with
 * a `data-aws-ref` attribute at snapshot time so a later click/type can address
 * them by `ref` without re-deriving a fragile selector.
 *
 * `playwright` is an OPTIONAL dependency (ADR-005 §4): it is loaded lazily on
 * first use, so the core stays loadable without it; a missing playwright then
 * surfaces as a clear `BROWSER_UNAVAILABLE` error from `open()`.
 * @module @agents-web-search/core/browser/playwright
 */
import type { BrowserOpenOptions, BrowserSession } from './types.ts';
/** Options for the Playwright provider (from the resolved core config). */
export interface PlaywrightProviderConfig {
    /** Run the browser headless. Default `true`. */
    readonly headless?: boolean;
    /** Default per-action timeout in milliseconds. Default `30000`. */
    readonly timeoutMs?: number;
    /** Auth profiles: name → storage-state file path (Playwright `storageState`). */
    readonly authProfiles?: Record<string, string>;
    /**
     * Allow navigation to private/reserved network targets (loopback, LAN,
     * link-local). Default `false`: the SSRF guard blocks these. Enable only in
     * a trusted, network-isolated environment.
     */
    readonly allowPrivateNetworks?: boolean;
}
/** A minimal browser backend contract (the manager's provider surface). */
export interface CoreBrowserProvider {
    readonly id: string;
    /** Cheap local usability check; must not launch a browser. */
    available(): boolean;
    /** Launch a browser session. */
    open(options: BrowserOpenOptions, signal?: AbortSignal): Promise<BrowserSession>;
}
/**
 * Assert a navigation target is public (not a private/reserved network
 * target). Throws `CoreError` `BROWSER_SSRF_BLOCKED` when the guard blocks the
 * URL. The check runs on the literal host and after DNS resolution
 * (against rebinding) — the same guard as the fetch layer.
 */
export declare function assertPublicNavigation(url: string, allowPrivate: boolean): Promise<void>;
/** The playwright package, loaded lazily (see {@link loadPlaywright}). */
type PlaywrightModule = typeof import('playwright');
/**
 * Load playwright on first use (the promise is cached, success or failure).
 * Lazy loading keeps the core tree loadable whenever playwright is not
 * resolvable; a missing playwright surfaces as `BROWSER_UNAVAILABLE` from
 * {@link PlaywrightProvider.open} instead of a load-time crash.
 */
export declare function loadPlaywright(): Promise<PlaywrightModule>;
/**
 * The Playwright-backed browser provider.
 */
export declare class PlaywrightProvider implements CoreBrowserProvider {
    readonly id = "playwright";
    private readonly headless;
    private readonly timeoutMs;
    private readonly authProfiles;
    private readonly maxTextLength;
    private readonly maxElements;
    private readonly allowPrivateNetworks;
    constructor(config?: PlaywrightProviderConfig);
    /** Cheap local usability check: the Chromium executable must resolve. */
    available(): boolean;
    open(options: BrowserOpenOptions, signal?: AbortSignal): Promise<BrowserSession>;
    private resolveStorageState;
}
export {};
