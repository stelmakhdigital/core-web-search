/**
 * Core timeout arithmetic: signal fusion with an identifiable timeout reason
 * (port of the DSH `dsh-timeout` semantics: `AbortSignal.any` + `TimeoutReason`
 * stamp, disposed via `Symbol.dispose`).
 * @module @agents-web-search/core/timeout
 */
import type { CoreErrorCode } from './errors.ts';
/**
 * Internal abort reason carrying a capability-owned code and elapsed deadline.
 * {@link timeoutOf} translates it back before errors surface.
 */
export declare class TimeoutReason extends Error {
    readonly code: CoreErrorCode;
    readonly timeoutMs: number;
    name: string;
    constructor(code: CoreErrorCode, timeoutMs: number);
}
/** A deadline signal plus the cleanup that clears its timer (dispose-once). */
export interface Deadline {
    /** Aborts on upstream cancellation OR on timeout (the timeout carries a {@link TimeoutReason}). */
    readonly signal: AbortSignal;
    /** Clear the timer. Safe to call once; `using` calls it at scope exit. */
    [Symbol.dispose](): void;
}
/**
 * Fuse upstream cancellation with an identifiable timeout. `timeoutMs <= 0`
 * means "no timer" (background work): only the upstream signal is forwarded.
 *
 * `AbortSignal.any` adopts the reason of whichever source aborts FIRST, so a
 * race resolves to a single cause: {@link timeoutOf} reads the
 * {@link TimeoutReason} only when the timeout won; an upstream win leaves an
 * ordinary abort reason.
 */
export declare function deadline(upstream: AbortSignal | undefined, timeoutMs: number, code: CoreErrorCode): Deadline;
/**
 * Read the timeout reason off a (possibly aborted) signal when it was aborted
 * by our backstop deadline with the given code (or any code when omitted).
 * Returns `undefined` for upstream aborts, non-timeout aborts, and live signals.
 */
export declare function timeoutOf(x: AbortSignal | {
    reason?: unknown;
}, code?: CoreErrorCode): TimeoutReason | undefined;
