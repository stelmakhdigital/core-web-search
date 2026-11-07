/**
 * Browser readiness probe (host convenience): reports whether the optional
 * playwright package and the Chromium browser binary are actually usable on
 * this host, with an actionable hint when they are not. The probe never
 * launches a browser and never downloads anything.
 * @module @agents-web-search/core/browser/readiness
 */
/** One readiness report (`browserReadiness()`). */
export interface BrowserReadiness {
    /** The `playwright` package resolves. */
    readonly playwright: boolean;
    /** The Chromium binary is downloaded (`playwright install chromium`). */
    readonly chromium: boolean;
    /** Actionable fix when something is missing; undefined when ready. */
    readonly hint?: string;
}
/**
 * Check the host for browser-module readiness: playwright importable AND the
 * Chromium executable present on disk. Fire-and-forget safe (no launch, no
 * network); designed for the host's `session_start`.
 */
export declare function browserReadiness(): Promise<BrowserReadiness>;
