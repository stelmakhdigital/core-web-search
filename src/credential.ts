/**
 * Secret resolution (ADR-002 §6): explicit config value → host credential
 * domain → environment variable. Engines receive a `resolveSecret` callback so
 * host-written keys (e.g. the DSH credentials domain, Pi subscription auth)
 * take effect per-search without a restart.
 * @module @agents-web-search/core/credential
 */

import type { HostAdapter } from './types.ts'

export interface SecretSpec {
  /** Credential name for the host (e.g. `websearch:exa`). */
  readonly name: string
  /** Explicit literal key from config (highest precedence). */
  readonly explicit?: string
  /** Environment variable name fallback (lowest precedence). */
  readonly env?: string
}

/**
 * Build the per-engine secret resolver used by engines:
 * `explicit > host.credential(name) > process.env[env]`.
 */
export function makeSecretResolver(host: HostAdapter): (spec: SecretSpec) => Promise<string | undefined> {
  return async (spec: SecretSpec): Promise<string | undefined> => {
    if (spec.explicit !== undefined && spec.explicit.length > 0) return spec.explicit
    try {
      const fromHost = await host.credential(spec.name)
      if (fromHost !== undefined && fromHost.length > 0) return fromHost
    } catch (error) {
      host.log?.('warn', `credential(${spec.name}) failed; falling back to env`, { error: String(error) })
    }
    const fromEnv = spec.env !== undefined ? process.env[spec.env] : undefined
    if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv
    return undefined
  }
}

/** Default environment variable names per engine (documented in ADR-004 §2). */
export const DEFAULT_SECRET_ENV: Record<string, string> = {
  openai: 'OPENAI_API_KEY',
  xai: 'XAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  gemini: 'GEMINI_API_KEY',
  perplexity: 'PERPLEXITY_API_KEY',
  exa: 'EXA_API_KEY',
  tavily: 'TAVILY_API_KEY',
  brave: 'BRAVE_API_KEY',
  jina: 'JINA_API_KEY',
}

/** Default credential names per engine (`websearch:<id>`). */
export function credentialName(engineId: string): string {
  return `websearch:${engineId}`
}
