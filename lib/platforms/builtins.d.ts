/**
 * Built-in platform definitions. These ship with the package as a convenient
 * starting point; every field is overridable via config or a rule pack, and
 * the endpoints are best-effort (third-party markup/APIs change). The JSON
 * platforms (GitHub, Reddit, Bilibili) hit public, keyless endpoints and are
 * the most reliable; the HTML/SPA platforms (V2EX, YouTube) are best-effort.
 * @module @agents-web-search/core/platforms/builtins
 */
import type { Platform } from './types.ts';
/** The built-in platforms, in display order. */
export declare const BUILTIN_PLATFORMS: readonly Platform[];
