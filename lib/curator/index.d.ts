/**
 * Curator UI (roadmap 5.4): a local, token-protected HTTP server that lets a
 * human review the agent's web results — recent searches and fetched pages —
 * generate LLM summaries, and discard entries.
 *
 * Security model (v0.1): the server binds loopback only (non-loopback `bind`
 * values are forced back to 127.0.0.1; the `remote` config option is accepted
 * but remote access is deferred), issues a random Bearer token at start
 * (also accepted as `?token=` for direct browser opens), and answers 401 to
 * anything else. Summaries are produced through `HostAdapter.llm`; without an
 * LLM client the endpoint fails closed with `WEB_NOT_AVAILABLE`.
 *
 * v0.1 known limitations (documented): remote access (no 0.0.0.0/TLS),
 * summaries are held in memory (lost on restart), no pagination beyond the
 * entry cap.
 *
 * @module @agents-web-search/core/curator
 */
import { WebStore } from '../store/index.ts';
import type { LlmClient } from '../types.ts';
/** Curator entry (a search record or a page record with a preview). */
export interface CuratorEntry {
    readonly kind: 'search' | 'page';
    readonly id: number;
    /** The query (search) or URL (page). */
    readonly title: string;
    readonly when: number;
    /** Engine ids (search) or status/size (page). */
    readonly meta: string;
    /** A short body preview. */
    readonly preview: string;
    /** The generated summary, when present. */
    readonly summary?: string;
}
/** The options for starting a curator server. */
export interface CuratorOptions {
    readonly store: WebStore;
    /** The host LLM client (summaries). Optional — fail-closed without it. */
    readonly llm?: LlmClient;
    /** The bind address. v0.1: only loopback addresses are honored. */
    readonly bind?: string;
    /** The port to bind (0 = an OS-assigned free port). */
    readonly port?: number;
    /** Maximum entries listed per kind. Default 50. */
    readonly maxEntries?: number;
}
/** A running curator server. */
export interface CuratorHandle {
    /** The human-facing URL (with token) to open in a browser. */
    readonly url: string;
    /** The Bearer token for API calls. */
    readonly token: string;
    /** The bound port. */
    readonly port: number;
    /** Stop the server. */
    close(): Promise<void>;
}
/** Start a curator server on the loopback interface. */
export declare function startCuratorServer(options: CuratorOptions): Promise<CuratorHandle>;
/** Whether a bind address is loopback (v0.1 security rule). */
export declare function isLoopback(host: string | undefined): boolean;
