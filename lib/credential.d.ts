/**
 * Secret resolution (ADR-002 §6): explicit config value → host credential
 * domain → environment variable. Engines receive a `resolveSecret` callback so
 * host-written keys (e.g. the DSH credentials domain, Pi subscription auth)
 * take effect per-search without a restart.
 * @module @agents-web-search/core/credential
 */
import type { HostAdapter } from './types.ts';
export interface SecretSpec {
    /** Credential name for the host (e.g. `websearch:exa`). */
    readonly name: string;
    /** Explicit literal key from config (highest precedence). */
    readonly explicit?: string;
    /** Environment variable name fallback (lowest precedence). */
    readonly env?: string;
}
/**
 * Build the per-engine secret resolver used by engines:
 * `explicit > host.credential(name) > process.env[env]`.
 */
export declare function makeSecretResolver(host: HostAdapter): (spec: SecretSpec) => Promise<string | undefined>;
/** Default environment variable names per engine (documented in ADR-004 §2). */
export declare const DEFAULT_SECRET_ENV: Record<string, string>;
/** Default credential names per engine (`websearch:<id>`). */
export declare function credentialName(engineId: string): string;
