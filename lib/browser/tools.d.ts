/**
 * The model-facing `browser_*` tools (ADR-006: registered only when
 * `browser.enabled`). Sensitive actions (navigation, script evaluation — in
 * `navigate` mode; clicks/types — in `all` mode) are gated through the host's
 * `approve` (ADR-005 §3): no approver on the host ⇒ the action is DENIED
 * (fail-closed), a declined request ⇒ `BROWSER_APPROVAL_DENIED`.
 * @module @agents-web-search/core/browser/tools
 */
import type { ResolvedCoreConfig } from '../config.ts';
import type { HostAdapter, ToolSpec } from '../types.ts';
import type { BrowserManager } from './manager.ts';
export interface BrowserToolDeps {
    readonly manager: BrowserManager;
    readonly host: HostAdapter;
    readonly config: ResolvedCoreConfig;
}
/** Build the `browser_*` tool specs (registered only when `browser.enabled`). */
export declare function buildBrowserTools(deps: BrowserToolDeps): ToolSpec[];
