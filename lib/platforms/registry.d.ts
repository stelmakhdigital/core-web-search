/**
 * The platform registry: merges built-in, configured, and rule-pack platform
 * definitions (later sources override earlier by id) and hot-reloads rule-pack
 * files by mtime. Rule-pack files are small local JSON; a missing or invalid
 * file keeps its last good state rather than breaking searches.
 * @module @agents-web-search/core/platforms/registry
 */
import type { Platform } from './types.ts';
/** Registry construction options. */
export interface PlatformRegistryOptions {
    /** Built-in platforms (lowest precedence). */
    builtins: readonly Platform[];
    /** Platforms from plugin config (cordis.yml); override built-ins by id. */
    configured: readonly Platform[];
    /** Rule-pack JSON file paths (highest precedence); hot-reloaded by mtime. */
    rulePackPaths: readonly string[];
}
/**
 * Merge platforms by id, later entries overriding earlier ones.
 * @param groups - platform groups in ascending precedence order.
 * @returns the merged, de-duplicated platforms (first-seen order, overridden in place).
 */
export declare function mergePlatforms(groups: readonly (readonly Platform[])[]): Platform[];
/** The platform registry. */
export declare class PlatformRegistry {
    private readonly builtins;
    private readonly configured;
    private readonly rulePackPaths;
    private readonly rulePackCache;
    constructor(options: PlatformRegistryOptions);
    /**
     * Re-read rule-pack files whose mtime changed (hot reload). Safe to call on
     * every search; unchanged files are not re-read.
     */
    refresh(): void;
    /** The merged platform list (built-ins < configured < rule packs). */
    list(): Platform[];
    /** Look up one platform by id. */
    get(id: string): Platform | undefined;
    /** Whether a platform id is registered. */
    has(id: string): boolean;
    /** All registered platform ids, in merge order. */
    ids(): string[];
    /** The most recent rule-pack load errors (path → message), if any. */
    rulePackErrors(): Record<string, string>;
}
