/**
 * Browser readiness probe (host convenience): reports whether the optional
 * playwright package and the Chromium browser binary are actually usable on
 * this host, with an actionable hint when they are not. The probe never
 * launches a browser and never downloads anything; the only side effect is
 * an optional `ldd <binary>` parse on Linux (a static dependency read — it
 * detects the common "binary downloaded but system libraries missing" state,
 * which a plain existence check would report as ready).
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
/** Test seam: platform + `ldd` runner (both overridable in tests). */
export interface ReadinessDeps {
    readonly platform?: NodeJS.Platform;
    /** Missing shared-library names for one executable, or undefined when the
     * probe does not apply (non-Linux, no ldd) — never rejects. */
    readonly missingLibs?: (executable: string) => Promise<readonly string[] | undefined>;
}
/** `ldd <executable>` → the `=> not found` library names (Linux only). */
export declare function lddMissingLibs(executable: string): Promise<readonly string[] | undefined>;
/**
 * Check the host for browser-module readiness: playwright importable AND the
 * Chromium executable present on disk AND (on Linux) its system libraries
 * resolvable. Fire-and-forget safe (no launch, no network); designed for the
 * host's `session_start`.
 */
export declare function browserReadiness(deps?: ReadinessDeps): Promise<BrowserReadiness>;
