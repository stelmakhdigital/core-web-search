/**
 * The model-facing `browser_*` tools (ADR-006: registered only when
 * `browser.enabled`). Sensitive actions (navigation, script evaluation — in
 * `navigate` mode; clicks/types — in `all` mode) are gated through the host's
 * `approve` (ADR-005 §3): no approver on the host ⇒ the action is DENIED
 * (fail-closed), a declined request ⇒ `BROWSER_APPROVAL_DENIED`.
 * @module @agents-web-search/core/browser/tools
 */

import { CoreError, errorCodeOf } from '../errors.ts'
import type { ResolvedCoreConfig } from '../config.ts'
import type { HostAdapter, ToolOutput, ToolSpec } from '../types.ts'
import type { BrowserElement, BrowserSession, BrowserTarget } from './types.ts'
import { BROWSER_CODES } from './types.ts'
import type { BrowserManager } from './manager.ts'
import { writeScreenshot } from './screenshot.ts'

export interface BrowserToolDeps {
  readonly manager: BrowserManager
  readonly host: HostAdapter
  readonly config: ResolvedCoreConfig
}

/** Which browser actions require an approval grant before running. */
type BrowserApprovalKind = 'browser_navigate' | 'browser_evaluate' | 'browser_click' | 'browser_type'

/** Does the configured policy gate `kind`? */
function requiresApproval(policy: 'never' | 'navigate' | 'all', kind: BrowserApprovalKind): boolean {
  if (policy === 'never') return false
  if (policy === 'all') return true
  return kind === 'browser_navigate' || kind === 'browser_evaluate'
}

/**
 * Gate a sensitive action through the host approver (fail-closed, ADR-005 §3).
 * The core NEVER performs the action without an explicit `true`.
 */
async function approve(deps: BrowserToolDeps, kind: BrowserApprovalKind, description: string): Promise<void> {
  if (!requiresApproval(deps.config.browser.approval, kind)) return
  const host = deps.host
  if (host.approve === undefined) {
    throw new CoreError(
      `browser ${kind.slice('browser_'.length)} requires approval (policy "${deps.config.browser.approval}"), but the host provides no approval channel — the action is denied (fail-closed)`,
      BROWSER_CODES.APPROVAL_UNAVAILABLE,
    )
  }
  const granted = await host.approve({ kind, description })
  if (granted !== true) {
    throw new CoreError(`browser ${kind.slice('browser_'.length)} was not approved`, BROWSER_CODES.APPROVAL_DENIED)
  }
}

/** Wrap an execution body so CoreErrors become `isError` outputs. */
function guarded<A>(body: (args: A, ctx: ToolExecuteCtx) => Promise<ToolOutput>): ToolSpec['execute'] {
  return async (args: unknown, ctx: ToolExecuteCtx): Promise<ToolOutput> => {
    try {
      return await body(args as A, ctx)
    } catch (error) {
      if (error instanceof CoreError) {
        return { text: `Error (${errorCodeOf(error)}): ${error.message}`, isError: true }
      }
      return { text: `Error (WEB_INTERNAL): ${error instanceof Error ? error.message : String(error)}`, isError: true }
    }
  }
}

/** The tool execution context (matches `ToolSpec.execute`). */
interface ToolExecuteCtx {
  readonly signal: AbortSignal
  readonly onUpdate?: (partial: ToolOutput) => void
}

/** The active session or a `BROWSER_NOT_OPEN` error. */
function requireSession(deps: BrowserToolDeps): BrowserSession {
  const session = deps.manager.session()
  if (session === undefined) {
    throw new CoreError('no browser session is open; call browser_open first', BROWSER_CODES.NOT_OPEN)
  }
  return session
}

/** Render a snapshot as a readable element list plus page text. */
function renderSnapshot(
  value: { url: string; title: string; elements: readonly BrowserElement[]; text: string; truncated: boolean },
): string {
  const lines: string[] = [`URL: ${value.url}`, `Title: ${value.title}`, '']
  if (value.elements.length === 0) {
    lines.push('No interactive elements.')
  } else {
    lines.push('Interactive elements (click/type by ref or selector; elements in child frames are marked):')
    for (const el of value.elements) {
      const href = el.href !== undefined ? ` (${el.href})` : ''
      const frame = el.frame !== undefined ? ` [in iframe: ${frameLabel(el.frame)}]` : ''
      lines.push(`  ${el.ref} [${el.role}] "${el.name}"${href}${frame}`)
    }
  }
  lines.push('', 'Page text:')
  lines.push(value.text === '' ? '(empty)' : value.text)
  if (value.truncated) lines.push('(truncated)')
  return lines.join('\n')
}

/** Short human-readable label for a child-frame URL (its origin, or a marker). */
function frameLabel(url: string): string {
  if (!url || url === 'about:blank' || url === 'about:srcdoc') return 'about:blank'
  try {
    const origin = new URL(url).origin
    return origin === 'null' ? url : origin
  } catch {
    return url
  }
}

/** Coerce an evaluated page value to a bounded JSON string (the tool output contract). */
function toOutputJson(value: unknown): string {
  if (value === undefined) return 'null'
  let text: string
  try {
    text = JSON.stringify(JSON.parse(JSON.stringify(value)))
  } catch {
    return String(value).slice(0, 20_000)
  }
  if (text.length > 20_000) text = `${text.slice(0, 20_000)}…(truncated)`
  return text
}

/** Resolve a click/type target from `ref` / `selector` (exactly one). */
function resolveTarget(args: Record<string, unknown>): BrowserTarget {
  const ref = typeof args['ref'] === 'string' ? args['ref'] : ''
  const selector = typeof args['selector'] === 'string' ? args['selector'] : ''
  if (ref.length > 0 && selector.length > 0) {
    throw new CoreError('provide exactly one of "ref" or "selector"', BROWSER_CODES.INVALID_URL)
  }
  if (ref.length > 0) return { kind: 'ref', ref }
  if (selector.length > 0) return { kind: 'selector', selector }
  throw new CoreError('provide "ref" (from browser_snapshot) or "selector" (CSS)', BROWSER_CODES.INVALID_URL)
}

/** Build the `browser_*` tool specs (registered only when `browser.enabled`). */
export function buildBrowserTools(deps: BrowserToolDeps): ToolSpec[] {
  const screenshotDir = `${deps.host.paths.stateDir.replace(/\/+$/, '')}/browser-screenshots`
  const inlineDefault = deps.config.browser.screenshotInlineDefault

  return [
    {
      name: 'browser_open',
      description:
        'Open a local headless Chromium browser session (Playwright). Optionally navigate to a URL immediately. ' +
        'Navigate is a sensitive action and may require approval per the configured policy.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Absolute http(s) URL to open immediately (optional).' },
        },
      },
      execute: guarded(async (args, { signal }): Promise<ToolOutput> => {
        const record = asRecord(args)
        const url = typeof record['url'] === 'string' && record['url'].length > 0 ? record['url'] : undefined
        const session = await deps.manager.open(undefined, {}, signal)
        let text = `Browser session opened (provider: ${session.providerId}).`
        if (url !== undefined) {
          await approve(deps, 'browser_navigate', `Navigate to ${url}`)
          const result = await session.navigate(url, signal)
          text += ` Navigated to ${result.url}${result.title !== undefined ? ` ("${result.title}")` : ''}.`
        }
        return { text, details: { url: session.url() } }
      }),
    },
    {
      name: 'browser_navigate',
      description: 'Navigate the open browser session to an absolute http(s) URL and wait for load.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Absolute http(s) URL.' },
        },
        required: ['url'],
      },
      execute: guarded(async (args, { signal }): Promise<ToolOutput> => {
        const record = asRecord(args)
        const url = typeof record['url'] === 'string' ? record['url'] : ''
        if (url.length === 0) throw new CoreError('url is required', BROWSER_CODES.INVALID_URL)
        await approve(deps, 'browser_navigate', `Navigate to ${url}`)
        const session = requireSession(deps)
        const result = await session.navigate(url, signal)
        return { text: `Navigated to ${result.url}${result.title !== undefined ? ` ("${result.title}")` : ''}.`, details: result }
      }),
    },
    {
      name: 'browser_snapshot',
      description:
        'Capture the current page: interactive elements (addressable by ref for click/type) and visible text.',
      parameters: {
        type: 'object',
        properties: {
          max_elements: { type: 'integer', description: 'Maximum interactive elements (default 200).' },
          max_text: { type: 'integer', description: 'Maximum visible-text characters (default 20000).' },
        },
      },
      execute: guarded(async (args): Promise<ToolOutput> => {
        const record = asRecord(args)
        const session = requireSession(deps)
        const snapshot = await session.snapshot({
          ...(typeof record['max_elements'] === 'number' ? { maxElements: record['max_elements'] } : {}),
          ...(typeof record['max_text'] === 'number' ? { maxTextLength: record['max_text'] } : {}),
        })
        return { text: renderSnapshot(snapshot), details: snapshot }
      }),
    },
    {
      name: 'browser_click',
      description: 'Click an element of the open browser page, addressed by snapshot ref or CSS selector.',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'Element ref from browser_snapshot (e.g. "@e3").' },
          selector: { type: 'string', description: 'CSS selector (alternative to ref).' },
        },
      },
      execute: guarded(async (args, { signal }): Promise<ToolOutput> => {
        const record = asRecord(args)
        const target = resolveTarget(record)
        await approve(deps, 'browser_click', `Click ${describeTarget(target)}`)
        const session = requireSession(deps)
        await session.click(target, signal)
        return { text: `Clicked ${describeTarget(target)}.` }
      }),
    },
    {
      name: 'browser_type',
      description: 'Type text into an element of the open browser page (replacing its value).',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'Element ref from browser_snapshot (e.g. "@e3").' },
          selector: { type: 'string', description: 'CSS selector (alternative to ref).' },
          text: { type: 'string', description: 'The text to type.' },
        },
        required: ['text'],
      },
      execute: guarded(async (args, { signal }): Promise<ToolOutput> => {
        const record = asRecord(args)
        const target = resolveTarget(record)
        const text = typeof record['text'] === 'string' ? record['text'] : ''
        if (text.length === 0) throw new CoreError('text is required', BROWSER_CODES.INVALID_URL)
        await approve(deps, 'browser_type', `Type into ${describeTarget(target)}`)
        const session = requireSession(deps)
        await session.type(target, text, signal)
        return { text: `Typed ${text.length} characters into ${describeTarget(target)}.` }
      }),
    },
    {
      name: 'browser_evaluate',
      description: 'Evaluate JavaScript in the page context and return the JSON-serializable result.',
      parameters: {
        type: 'object',
        properties: {
          expression: { type: 'string', description: 'The JavaScript expression to evaluate.' },
        },
        required: ['expression'],
      },
      execute: guarded(async (args, { signal }): Promise<ToolOutput> => {
        const record = asRecord(args)
        const expression = typeof record['expression'] === 'string' ? record['expression'] : ''
        if (expression.length === 0) throw new CoreError('expression is required', BROWSER_CODES.INVALID_URL)
        await approve(deps, 'browser_evaluate', `Evaluate: ${expression.slice(0, 200)}`)
        const session = requireSession(deps)
        const result = await session.evaluate(expression, signal)
        return { text: toOutputJson(result) }
      }),
    },
    {
      name: 'browser_screenshot',
      description:
        'Capture a PNG screenshot of the page (or one element). By default written to a file in the state dir; ' +
        `inline: true returns a data URI instead. Default mode: ${inlineDefault ? 'inline' : 'file'}.`,
      parameters: {
        type: 'object',
        properties: {
          full_page: { type: 'boolean', description: 'Capture the full scrollable page (default false).' },
          selector: { type: 'string', description: 'Capture a single element (CSS selector) instead of the page.' },
          inline: { type: 'boolean', description: 'Return a data:image/png;base64 URI instead of a file path.' },
        },
      },
      execute: guarded(async (args, { signal }): Promise<ToolOutput> => {
        const record = asRecord(args)
        const session = requireSession(deps)
        const inline = typeof record['inline'] === 'boolean' ? record['inline'] : inlineDefault
        const screenshot = await session.screenshot({
          ...(typeof record['full_page'] === 'boolean' ? { fullPage: record['full_page'] } : {}),
          ...(typeof record['selector'] === 'string' ? { selector: record['selector'] } : {}),
        }, signal)
        if (inline) {
          return {
            text: `data:image/png;base64,${screenshot.buffer.toString('base64')}`,
            details: { inline: true },
          }
        }
        const path = await writeScreenshot(screenshot.buffer, screenshotDir)
        return { text: `Screenshot saved to ${path}.`, details: { path } }
      }),
    },
    {
      name: 'browser_close',
      description: 'Close the open browser session and release the browser.',
      parameters: { type: 'object', properties: {} },
      execute: guarded(async (): Promise<ToolOutput> => {
        await deps.manager.close(undefined)
        return { text: 'Browser session closed.' }
      }),
    },
  ]
}

/** A short description of a click/type target (logs/approvals; never secrets). */
function describeTarget(target: BrowserTarget): string {
  return target.kind === 'ref' ? target.ref : `"${target.selector}"`
}

function asRecord(args: unknown): Record<string, unknown> {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return {}
  return args as Record<string, unknown>
}
