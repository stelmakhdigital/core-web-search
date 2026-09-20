/**
 * Core timeout arithmetic: signal fusion with an identifiable timeout reason
 * (port of the DSH `dsh-timeout` semantics: `AbortSignal.any` + `TimeoutReason`
 * stamp, disposed via `Symbol.dispose`).
 * @module @agents-web-search/core/timeout
 */

import type { CoreErrorCode } from './errors.ts'

/**
 * Internal abort reason carrying a capability-owned code and elapsed deadline.
 * {@link timeoutOf} translates it back before errors surface.
 */
export class TimeoutReason extends Error {
  override name = 'TimeoutReason'

  constructor(readonly code: CoreErrorCode, readonly timeoutMs: number) {
    super(`${code} after ${timeoutMs}ms`)
  }
}

/** Largest delay Node schedules without clamping to one millisecond. */
const MAX_TIMER_DELAY_MS = 2_147_483_647

function assertTimerDelay(timeoutMs: number): void {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`deadline timeoutMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`)
  }
}

/** A deadline signal plus the cleanup that clears its timer (dispose-once). */
export interface Deadline {
  /** Aborts on upstream cancellation OR on timeout (the timeout carries a {@link TimeoutReason}). */
  readonly signal: AbortSignal
  /** Clear the timer. Safe to call once; `using` calls it at scope exit. */
  [Symbol.dispose](): void
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
export function deadline(upstream: AbortSignal | undefined, timeoutMs: number, code: CoreErrorCode): Deadline {
  if (timeoutMs <= 0) {
    return { signal: upstream ?? new AbortController().signal, [Symbol.dispose]() {} }
  }
  assertTimerDelay(timeoutMs)
  const timer = new AbortController()
  const id = setTimeout(() => {
    timer.abort(new TimeoutReason(code, timeoutMs))
  }, timeoutMs)
  return {
    signal: upstream !== undefined ? AbortSignal.any([upstream, timer.signal]) : timer.signal,
    [Symbol.dispose]() {
      clearTimeout(id)
    },
  }
}

/**
 * Read the timeout reason off a (possibly aborted) signal when it was aborted
 * by our backstop deadline with the given code (or any code when omitted).
 * Returns `undefined` for upstream aborts, non-timeout aborts, and live signals.
 */
export function timeoutOf(
  x: AbortSignal | { reason?: unknown },
  code?: CoreErrorCode,
): TimeoutReason | undefined {
  const reason: unknown = x.reason
  if (!(reason instanceof TimeoutReason)) return undefined
  return code === undefined || reason.code === code ? reason : undefined
}
