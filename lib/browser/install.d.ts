/**
 * One-shot Chromium download for hosts with `browser.autoDownload`: runs the
 * playwright CLI (`playwright install chromium`) as a child process. This is
 * the only part of browser setup a plugin may automate — it writes solely
 * under the user's browser cache, needs no privileges, and is idempotent.
 * System libraries (libnss3, …) are deliberately NOT installed here: they
 * require root, and readiness hints carry the distro-specific command instead.
 * @module @agents-web-search/core/browser/install
 */
/** Result of {@link installChromium}. */
export interface InstallChromiumResult {
    readonly ok: boolean;
    /** Tail of the CLI output on failure (already bounded, safe for a notice). */
    readonly error?: string;
}
/** Test seam: replace the child-process runner (never spawns in tests). */
export interface InstallChromiumDeps {
    readonly run?: (command: string, args: readonly string[], timeoutMs: number) => Promise<void>;
    readonly timeoutMs?: number;
}
/** Run a command, rejecting with the output tail on failure. Exported for
 * tests; it is the default runner of {@link installChromium}. */
export declare function runCapturing(command: string, args: readonly string[], timeoutMs: number): Promise<void>;
/**
 * Download the Chromium binary through the locally installed playwright CLI
 * (resolved next to the playwright package the core imports). Non-blocking
 * for the caller — hosts fire this in the background and report the result.
 * Never installs system libraries; failure text is user-actionable.
 */
export declare function installChromium(deps?: InstallChromiumDeps): Promise<InstallChromiumResult>;
