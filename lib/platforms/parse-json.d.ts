/**
 * JSON result extraction for `json` and `json-in-html` platforms. Fields are
 * addressed by dot-separated paths; a missing field yields `undefined` (never
 * an error), and items without a string URL are skipped rather than fatal.
 * @module @agents-web-search/core/platforms/parse-json
 */
import type { JsonFields, PlatformSource } from './types.ts';
/**
 * Resolve a dot-separated path against a parsed JSON value. Array indices are
 * addressed as numeric segments (e.g. `runs.0.text`).
 * @param value - the parsed JSON root (or a nested node).
 * @param path - a dot-separated field path (e.g. `data.children`).
 * @returns the resolved value, or `undefined` when any segment is missing.
 */
export declare function resolvePath(value: unknown, path: string): unknown;
/**
 * Parse a JSON document into platform sources using the configured field paths.
 * @param text - the raw JSON body.
 * @param fields - the platform's {@link JsonFields}.
 * @returns the parsed sources, in document order.
 * @throws a `SyntaxError` when the body is not valid JSON.
 */
export declare function parseJsonResults(text: string, fields: JsonFields): PlatformSource[];
/**
 * Locate and extract the JSON object that follows `marker` in an HTML document,
 * using balanced-brace scanning that respects string literals and escapes.
 * @param html - the raw HTML document.
 * @param marker - the text immediately preceding the JSON object.
 * @returns the extracted JSON object as text.
 * @throws an `Error` when the marker or a balanced object is not found.
 */
export declare function extractJsonAfterMarker(html: string, marker: string): string;
