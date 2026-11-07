/**
 * Per-engine failure cooldown with exponential backoff. A failing engine is
 * skipped for `baseMs * 2^(consecutiveFailures - 1)` (capped at `maxMs`); a
 * success resets the counter. Keeps the router from hammering a blocked or
 * down engine on every search.
 * @module @agents-web-search/core/search/cooldown
 */
export interface EngineCooldownOptions {
    /** Base cooldown after the first failure (ms). */
    baseMs: number;
    /** Maximum cooldown (ms). */
    maxMs: number;
    /** Injectable clock (ms) for tests. */
    now?: () => number;
}
/** The per-engine failure cooldown tracker. */
export declare class EngineCooldown {
    private readonly options;
    private readonly states;
    constructor(options: EngineCooldownOptions);
    /** True while the engine is cooling down. */
    isCoolingDown(engineId: string): boolean;
    /** Record a failure and extend the cooldown (exponential backoff). */
    recordFailure(engineId: string): void;
    /** Record a success and clear the cooldown. */
    recordSuccess(engineId: string): void;
    /** Cooldown state for diagnostics (engine id → remaining ms, 0 when idle). */
    remainingMs(engineId: string): number;
    /** Consecutive failure count (drives the backoff exponent; 0 when idle). */
    consecutive(engineId: string): number;
}
