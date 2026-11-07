/**
 * `BrowserManager`: per-stack ownership of browser sessions (port of the DSH
 * `BrowserRuntime` semantics, minus the host service layer). Sessions are keyed
 * by an arbitrary agent key (the host decides what identifies an agent; the
 * anonymous key is used by the model-facing `browser_*` tools). The Playwright
 * provider is the default backend; tests inject a fake provider.
 *
 * ADR-005 §3: the manager never approves anything — approval is enforced at
 * the tool layer through the host's `approve` (fail-closed).
 * @module @agents-web-search/core/browser/manager
 */
import type { BrowserOpenOptions, BrowserSession } from './types.ts';
import { type CoreBrowserProvider } from './playwright.ts';
/** Options for {@link createBrowserManager}. */
export interface BrowserManagerOptions {
    /** Headless by default. */
    readonly headless?: boolean;
    /** Default per-action timeout (ms). */
    readonly timeoutMs?: number;
    /** Auth profiles: name → storage-state file path. */
    readonly authProfiles?: Record<string, string>;
    /** Allow navigation to private/reserved targets (SSRF opt-out). Default false. */
    readonly allowPrivateNetworks?: boolean;
    /** Maximum concurrent open sessions. Default 1. */
    readonly maxConcurrentTabs?: number;
    /** Test/diagnostic provider override (defaults to the Playwright provider). */
    readonly provider?: CoreBrowserProvider;
}
/**
 * The browser manager owned by one web stack.
 */
export interface BrowserManager {
    /** The active session for `agent`, if any (anonymous session when omitted). */
    session(agent?: unknown): BrowserSession | undefined;
    /**
     * Open a browser session for `agent`. Throws `BROWSER_ALREADY_OPEN` when the
     * agent already has a session or the tab cap is reached, and
     * `BROWSER_UNAVAILABLE` when the backend is unavailable.
     */
    open(agent?: unknown, options?: BrowserOpenOptions, signal?: AbortSignal): Promise<BrowserSession>;
    /** Close and drop the open session for `agent`. A no-op when none is open. */
    close(agent?: unknown): Promise<void>;
    /** Close every open session (used on stack disposal). */
    closeAll(): Promise<void>;
    /** Cheap backend usability check (no launch). */
    available(): boolean;
    /** The backend provider id (`playwright` for the default). */
    readonly providerId: string;
}
/** Sentinel key for the anonymous session (model-facing tools, diagnostics). */
export declare const ANON_KEY: unique symbol;
/**
 * Create the browser manager for a stack (called by `createWebStack` when
 * `browser.enabled` is true).
 */
export declare function createBrowserManager(options?: BrowserManagerOptions): BrowserManager;
