/**
 * `BrowserManager`: per-stack ownership of browser sessions (port of the DSH
 * `BrowserRuntime` semantics, minus the host service layer). Sessions are keyed
 * by an arbitrary agent key (the host decides what identifies an agent; the
 * anonymous key is used by the model-facing `browser_*` tools). The Playwright
 * provider is the default backend; tests inject a fake provider.
 *
 * ADR-005 §3: the manager never approves anything — approval is enforced at
 * the tool layer through the host's `approve` (fail-closed).
 * @module @agents-web-search/core/browser/manager
 */

import { CoreError } from '../errors.ts'
import type { BrowserOpenOptions, BrowserSession } from './types.ts'
import { BROWSER_CODES } from './types.ts'
import { PlaywrightProvider, type CoreBrowserProvider } from './playwright.ts'

/** Options for {@link createBrowserManager}. */
export interface BrowserManagerOptions {
  /** Headless by default. */
  readonly headless?: boolean
  /** Default per-action timeout (ms). */
  readonly timeoutMs?: number
  /** Auth profiles: name → storage-state file path. */
  readonly authProfiles?: Record<string, string>
  /** Allow navigation to private/reserved targets (SSRF opt-out). Default false. */
  readonly allowPrivateNetworks?: boolean
  /** Maximum concurrent open sessions. Default 1. */
  readonly maxConcurrentTabs?: number
  /** Test/diagnostic provider override (defaults to the Playwright provider). */
  readonly provider?: CoreBrowserProvider
}

/**
 * The browser manager owned by one web stack.
 */
export interface BrowserManager {
  /** The active session for `agent`, if any (anonymous session when omitted). */
  session(agent?: unknown): BrowserSession | undefined
  /**
   * Open a browser session for `agent`. Throws `BROWSER_ALREADY_OPEN` when the
   * agent already has a session or the tab cap is reached, and
   * `BROWSER_UNAVAILABLE` when the backend is unavailable.
   */
  open(agent?: unknown, options?: BrowserOpenOptions, signal?: AbortSignal): Promise<BrowserSession>
  /** Close and drop the open session for `agent`. A no-op when none is open. */
  close(agent?: unknown): Promise<void>
  /** Close every open session (used on stack disposal). */
  closeAll(): Promise<void>
  /** Cheap backend usability check (no launch). */
  available(): boolean
  /** The backend provider id (`playwright` for the default). */
  readonly providerId: string
}

/** Sentinel key for the anonymous session (model-facing tools, diagnostics). */
export const ANON_KEY = Symbol('browser-anon-session')

/**
 * Create the browser manager for a stack (called by `createWebStack` when
 * `browser.enabled` is true).
 */
export function createBrowserManager(options: BrowserManagerOptions = {}): BrowserManager {
  const provider: CoreBrowserProvider = options.provider ?? new PlaywrightProvider({
    headless: options.headless,
    timeoutMs: options.timeoutMs,
    authProfiles: options.authProfiles,
    allowPrivateNetworks: options.allowPrivateNetworks,
  })
  const maxTabs = Math.max(options.maxConcurrentTabs ?? 1, 1)
  const sessions = new Map<unknown, BrowserSession>()

  const keyOf = (agent: unknown): unknown => agent ?? ANON_KEY

  return {
    providerId: provider.id,
    session(agent?: unknown): BrowserSession | undefined {
      return sessions.get(keyOf(agent))
    },
    async open(agent?: unknown, openOptions: BrowserOpenOptions = {}, signal?: AbortSignal): Promise<BrowserSession> {
      const key = keyOf(agent)
      const existing = sessions.get(key)
      if (existing !== undefined) {
        throw new CoreError('a browser session is already open for this agent; close it first (browser_close)', BROWSER_CODES.ALREADY_OPEN)
      }
      if (sessions.size >= maxTabs) {
        throw new CoreError(`the browser tab limit is reached (${maxTabs} concurrent session${maxTabs > 1 ? 's' : ''}); close one first`, BROWSER_CODES.ALREADY_OPEN)
      }
      const session = await provider.open(openOptions, signal)
      sessions.set(key, session)
      return session
    },
    async close(agent?: unknown): Promise<void> {
      const key = keyOf(agent)
      const session = sessions.get(key)
      if (session === undefined) return
      sessions.delete(key)
      await session.close()
    },
    async closeAll(): Promise<void> {
      const open = [...sessions.values()]
      sessions.clear()
      await Promise.all(open.map((session) => session.close()))
    },
    available(): boolean {
      return provider.available()
    },
  }
}
