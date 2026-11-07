/**
 * Shared helpers for provider-native engines (ADR-004): a single JSON POST
 * with uniform status classification. The core speaks these provider APIs
 * over plain HTTP — no host LLM SDK, no vendor packages (Q9).
 * @module @agents-web-search/core/search/engines/provider-native/common
 */
export interface ProviderJsonOptions {
    readonly endpoint: string;
    readonly headers: Record<string, string>;
    readonly body: unknown;
    readonly engineLabel: string;
    readonly signal: AbortSignal;
}
/**
 * POST one JSON document and parse the JSON response, classifying transport
 * and provider failures into `CoreError` codes (401/403 → WEB_AUTH,
 * 402/429 → WEB_QUOTA, 404/405/501 → WEB_UNSUPPORTED, else WEB_PROVIDER_ERROR).
 */
export declare function providerJson<T>(options: ProviderJsonOptions): Promise<T>;
/** Normalize an unknown field to a non-empty string (or undefined). */
export declare function asString(value: unknown): string | undefined;
