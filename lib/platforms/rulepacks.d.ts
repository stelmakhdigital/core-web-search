/**
 * Rule-pack import/export. A rule pack is a versioned JSON bundle of platform
 * definitions — the portable unit for sharing platform configurations. Import
 * validates the schema and normalizes each platform; export serializes a pack
 * to pretty-printed JSON.
 * @module @agents-web-search/core/platforms/rulepacks
 */
import { type Platform, type RulePack } from './types.ts';
/**
 * Validate and normalize one raw platform definition.
 * @param raw - the parsed (untrusted) platform object.
 * @param context - a human-readable location label for errors.
 * @returns the normalized {@link Platform}.
 */
export declare function validatePlatform(raw: unknown, context: string): Platform;
/**
 * Validate and normalize a parsed rule-pack object.
 * @param raw - the parsed (untrusted) rule-pack object.
 * @returns the validated {@link RulePack}.
 */
export declare function validateRulePack(raw: unknown): RulePack;
/**
 * Import a rule pack from a JSON string or object.
 * @param input - a JSON string or an already-parsed object.
 * @returns the validated {@link RulePack}.
 */
export declare function importRulePack(input: string | object): RulePack;
/**
 * Export a rule pack to pretty-printed JSON.
 * @param pack - the rule pack to serialize.
 * @returns the JSON text.
 */
export declare function exportRulePack(pack: RulePack): string;
