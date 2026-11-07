/**
 * A small token-bucket rate limiter with jitter, for polite sustained access
 * to a public endpoint. In-process only; no state crosses a boundary.
 * @module @agents-web-search/core/search/rate-limit
 */
/** Options for a {@link RateLimiter}. */
export interface RateLimiterOptions {
    /** Sustained rate in tokens per second (must be > 0). */
    perSec: number;
    /** Burst capacity (defaults to `perSec`, minimum 1). */
    burst?: number;
    /** Jitter in milliseconds added to each wait (defaults to 100). */
    jitterMs?: number;
    /** Injectable clock for tests (defaults to `Date.now`). */
    now?: () => number;
    /** Injectable wait for tests (defaults to a real timer). */
    sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}
/** Token-bucket rate limiter. */
export declare class RateLimiter {
    private readonly options;
    private readonly capacity;
    private readonly refillPerMs;
    private tokens;
    private lastRefill;
    constructor(options: RateLimiterOptions);
    /**
     * Wait until one token is available, then consume it.
     * @param signal - optional caller cancellation; an aborted wait rejects with an `AbortError`.
     */
    acquire(signal?: AbortSignal): Promise<void>;
    private refill;
    private jitter;
}
