/**
 * The engine contract for the core search stack: one search backend behind a
 * uniform interface. Engines are built by the stack (which owns credential
 * resolution through the host contract) and handed to the router in an
 * id-keyed map.
 * @module @agents-web-search/core/search/engines/types
 */

import type { SearchSource } from '../../types.ts'

/** One secret reference (explicit config > host credential > env; ADR-002 §6). */
export interface SecretSpec {
  /** Credential name for the host (e.g. `websearch:exa`). */
  readonly name: string
  /** Explicit literal key from config (highest precedence). */
  readonly explicit?: string
  /** Environment variable name fallback (lowest precedence). */
  readonly env?: string
}

/** Resolve one secret reference to a key (or undefined when absent). */
export type SecretResolver = (spec: SecretSpec) => Promise<string | undefined>

/** Shared dependencies every engine receives from the stack. */
export interface SearchEngineDeps {
  /** Product `User-Agent` sent on every request (host identity included). */
  readonly userAgent: string
  /**
   * Per-search secret resolver (host credentials domain, env fallback).
   * Optional: keyless engines ignore it; key engines fail `WEB_AUTH` when it
   * (and no static key) yields nothing.
   */
  readonly resolveSecret?: SecretResolver
}

/** One engine's raw search output (pre-routing, pre-enrichment). */
export interface EngineSearchResult {
  /** Ranked result sources (engine order = engine rank). */
  readonly sources: readonly SearchSource[]
  /** Optional merged answer text (API engines that return one). */
  readonly content?: string
}

/** A single search backend. */
export interface SearchEngine {
  /** Stable engine id (config, cache keys, diagnostics). */
  readonly id: string
  /**
   * Cheap local availability check (no network). An unavailable engine is
   * skipped by the router; a forced unavailable engine is an error.
   */
  available(): boolean
  /**
   * Run one search. The router always passes its deadline signal so engine
   * failures classify against it. Throws `CoreError` on failure.
   */
  search(query: string, maxResults: number, signal: AbortSignal): Promise<EngineSearchResult>
}
