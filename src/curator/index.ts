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

import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

import { WebStore, type StoredPage, type StoredSearch } from '../store/index.ts'
import type { LlmClient } from '../types.ts'

/** Curator entry (a search record or a page record with a preview). */
export interface CuratorEntry {
  readonly kind: 'search' | 'page'
  readonly id: number
  /** The query (search) or URL (page). */
  readonly title: string
  readonly when: number
  /** Engine ids (search) or status/size (page). */
  readonly meta: string
  /** A short body preview. */
  readonly preview: string
  /** The generated summary, when present. */
  readonly summary?: string
}

/** The options for starting a curator server. */
export interface CuratorOptions {
  readonly store: WebStore
  /** The host LLM client (summaries). Optional — fail-closed without it. */
  readonly llm?: LlmClient
  /** The bind address. v0.1: only loopback addresses are honored. */
  readonly bind?: string
  /** The port to bind (0 = an OS-assigned free port). */
  readonly port?: number
  /** Maximum entries listed per kind. Default 50. */
  readonly maxEntries?: number
}

/** A running curator server. */
export interface CuratorHandle {
  /** The human-facing URL (with token) to open in a browser. */
  readonly url: string
  /** The Bearer token for API calls. */
  readonly token: string
  /** The bound port. */
  readonly port: number
  /** Stop the server. */
  close(): Promise<void>
}

/** Start a curator server on the loopback interface. */
export async function startCuratorServer(options: CuratorOptions): Promise<CuratorHandle> {
  const requested = options.bind ?? '127.0.0.1'
  const bind = isLoopback(requested) ? requested : '127.0.0.1'
  const maxEntries = options.maxEntries ?? 50
  const token = randomBytes(16).toString('hex')
  const summaries = new Map<string, string>()

  const server: Server = createServer((req, res) => {
    void handleRequest(req, res)
  })

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://curator.local')
    try {
      if (!authorized(url, req, token)) return unauthorized(res)
      if (url.pathname === '/' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(renderPage())
        return
      }
      if (url.pathname === '/api/entries' && req.method === 'GET') {
        const entries = await readEntries(options.store, maxEntries, summaries)
        return sendJson(res, 200, entries)
      }
      if (url.pathname === '/api/summarize' && req.method === 'POST') {
        const body = await readBody(req)
        const id = body.id
        const kind = body.kind
        if (typeof id !== 'number' || (kind !== 'search' && kind !== 'page')) {
          return sendJson(res, 400, { error: 'body must be {id: number, kind: "search" | "page"}', code: 'WEB_BAD_REQUEST' })
        }
        if (options.llm === undefined) {
          return sendJson(res, 501, {
            error: 'No host LLM client is available (HostAdapter.llm); summaries are disabled on this host.',
            code: 'WEB_NOT_AVAILABLE',
          })
        }
        const text = await entryText(options.store, kind, id)
        if (text === undefined) return sendJson(res, 404, { error: 'entry not found', code: 'WEB_NOT_AVAILABLE' })
        const key = `${kind}:${id}`
        const cached = summaries.get(key)
        if (cached !== undefined) return sendJson(res, 200, { summary: cached })
        const prompt =
          `Summarize the following web result in 2-4 sentences (what it is, the key facts, and why an agent might have fetched it).\n\n` +
          `Kind: ${kind}\n${text.slice(0, 20_000)}`
        const result = await options.llm.complete({ prompt, maxTokens: 512 })
        const summary = result.text.trim()
        if (summary.length === 0) {
          return sendJson(res, 502, { error: 'the LLM returned an empty summary', code: 'WEB_PROVIDER_ERROR' })
        }
        summaries.set(key, summary)
        return sendJson(res, 200, { summary })
      }
      if (url.pathname === '/api/discard' && req.method === 'POST') {
        const body = await readBody(req)
        const id = body.id
        const kind = body.kind
        if (typeof id !== 'number' || (kind !== 'search' && kind !== 'page')) {
          return sendJson(res, 400, { error: 'body must be {id: number, kind: "search" | "page"}', code: 'WEB_BAD_REQUEST' })
        }
        const deleted = kind === 'search' ? await options.store.deleteSearch(id) : await options.store.deletePage(id)
        if (!deleted) return sendJson(res, 404, { error: 'entry not found', code: 'WEB_NOT_AVAILABLE' })
        summaries.delete(`${kind}:${id}`)
        return sendJson(res, 200, { ok: true })
      }
      sendJson(res, 404, { error: `no such endpoint: ${req.method} ${url.pathname}`, code: 'WEB_NOT_AVAILABLE' })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      sendJson(res, 500, { error: `curator error: ${message.slice(0, 300)}`, code: 'WEB_INTERNAL' })
    }
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port ?? 0, bind, () => resolve())
  })
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  const host = bind === 'localhost' ? '127.0.0.1' : bind
  return {
    url: `http://${host}:${port}/?token=${token}`,
    token,
    port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)))
      }),
  }
}

/** Token check: Bearer header or `?token=` query (closure over the instance token). */
function authorized(url: URL, req: IncomingMessage, token: string): boolean {
  const header = req.headers.authorization
  if (typeof header === 'string' && header.startsWith('Bearer ')) return header.slice(7) === token
  return url.searchParams.get('token') === token
}

/** Read recent searches + pages (with previews and cached summaries). */
async function readEntries(store: WebStore, maxEntries: number, summaries: Map<string, string>) {
  const searches = await store.recentSearches(maxEntries)
  const pages = await store.recentPages(maxEntries)
  return [
    {
      kind: 'search',
      entries: searches.map((s) => toSearchEntry(s, summaries.get(`search:${s.id}`))),
    },
    {
      kind: 'page',
      entries: pages.map((p) => toPageEntry(p, summaries.get(`page:${p.id}`))),
    },
  ]
}

function toSearchEntry(s: StoredSearch, summary: string | undefined): CuratorEntry {
  const sources = Array.isArray(s.sources) ? s.sources.length : 0
  const firstSnippet = Array.isArray(s.sources) && s.sources.length > 0 ? ((s.sources[0] as { snippet?: unknown } | undefined)?.snippet ?? '') : ''
  const preview = (s.content !== undefined && s.content.length > 0 ? s.content : firstSnippet).toString().slice(0, 300)
  return {
    kind: 'search',
    id: s.id,
    title: s.query,
    when: s.createdAt,
    meta: `${s.engines.join(', ') || 'unknown engine'} · ${sources} source(s)${s.truncated ? ' · truncated' : ''}`,
    preview,
    ...(summary !== undefined ? { summary } : {}),
  }
}

function toPageEntry(p: StoredPage, summary: string | undefined): CuratorEntry {
  const preview = (p.bodyKind === 'text' ? p.body : `[${p.bodyKind} content — ${(p.body ?? '').length} chars]`).slice(0, 300)
  return {
    kind: 'page',
    id: p.id,
    title: p.url,
    when: p.fetchedAt,
    meta: `HTTP ${p.statusCode} · ${p.bodyKind}${p.truncated ? ' · truncated' : ''}`,
    preview,
    ...(summary !== undefined ? { summary } : {}),
  }
}

/** The LLM-facing text of one entry (for summarization prompts). */
async function entryText(store: WebStore, kind: 'search' | 'page', id: number): Promise<string | undefined> {
  if (kind === 'search') {
    const searches = await store.recentSearches(500)
    const found = searches.find((s) => s.id === id)
    if (found === undefined) return undefined
    const sources = (Array.isArray(found.sources) ? found.sources : [])
      .map((s, i) => {
        const src = s as { url?: unknown; title?: unknown; snippet?: unknown }
        return `${i + 1}. ${src.title ?? ''}\n   ${src.url ?? ''}\n   ${src.snippet ?? ''}`
      })
      .join('\n')
      .slice(0, 20_000)
    return `Query: ${found.query}\nEngines: ${found.engines.join(', ')}\n${found.content !== undefined && found.content.length > 0 ? `Merged answer:\n${found.content.slice(0, 4_000)}\n\n` : ''}Sources:\n${sources}`
  }
  const pages = await store.recentPages(500)
  const found = pages.find((p) => p.id === id)
  if (found === undefined) return undefined
  return `URL: ${found.url}\nHTTP ${found.statusCode}\n${found.bodyKind === 'text' ? found.body.slice(0, 20_000) : `[${found.bodyKind} content]`}`
}

/** Send a JSON response. */
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text) })
  res.end(text)
}

function unauthorized(res: ServerResponse): void {
  sendJson(res, 401, { error: 'missing or invalid token (use ?token= or Authorization: Bearer)', code: 'WEB_AUTH' })
}

/** Read and parse a JSON request body (capped at 1 MiB). */
async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > 1_000_000) throw new Error('request body too large')
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf-8'))
  } catch {
    throw new Error('invalid JSON body')
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('body must be a JSON object')
  return parsed as Record<string, unknown>
}

/** Whether a bind address is loopback (v0.1 security rule). */
export function isLoopback(host: string | undefined): boolean {
  return host === undefined || host === '127.0.0.1' || host === '::1' || host === 'localhost'
}

/**
 * The single-page curator UI. Inline CSS/JS, no external assets; the token is
 * carried in the URL query (local loopback server only).
 */
function renderPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Web Search Curator</title>
<style>
  :root { color-scheme: dark; }
  body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 0; background: #0f1115; color: #e6e6e6; }
  header { padding: 16px 24px; border-bottom: 1px solid #262a33; display: flex; justify-content: space-between; align-items: center; }
  h1 { font-size: 18px; margin: 0; }
  main { padding: 16px 24px; display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
  section h2 { font-size: 14px; text-transform: uppercase; letter-spacing: .08em; color: #9aa3b2; }
  .entry { border: 1px solid #262a33; border-radius: 8px; padding: 12px; margin-bottom: 12px; }
  .entry h3 { font-size: 14px; margin: 0 0 6px; word-break: break-all; }
  .meta { font-size: 12px; color: #9aa3b2; margin-bottom: 6px; }
  .preview { font-size: 12px; color: #b9c0cc; white-space: pre-wrap; max-height: 96px; overflow: auto; margin: 0 0 8px; }
  .summary { font-size: 13px; background: #1a1f2b; border-radius: 6px; padding: 8px; margin-bottom: 8px; }
  .actions { display: flex; gap: 8px; }
  button { font-size: 12px; padding: 4px 10px; border-radius: 6px; border: 1px solid #3a4150; background: #1a1f2b; color: #e6e6e6; cursor: pointer; }
  button.danger { border-color: #5a2a2a; background: #2a1a1a; }
  .error { color: #e08585; font-size: 12px; margin-top: 4px; min-height: 14px; }
</style>
</head>
<body>
<header>
  <h1>Web Search Curator</h1>
  <button onclick="load()">Reload</button>
</header>
<main>
  <section><h2>Recent searches</h2><div id="searches">Loading…</div></section>
  <section><h2>Recent pages</h2><div id="pages">Loading…</div></section>
</main>
<script>
  const TOKEN = new URLSearchParams(location.search).get('token') || '';
  async function api(path, options = {}) {
    const res = await fetch(path, { headers: { 'Authorization': 'Bearer ' + TOKEN, ...(options.headers || {}) }, ...options });
    if (!res.ok) { const body = await res.json().catch(() => ({})); throw new Error(body.error || ('HTTP ' + res.status)); }
    return res.json();
  }
  function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function entryHtml(kind, e) {
    return '<div class="entry"><h3>' + escapeHtml(e.title) + '</h3>' +
      '<div class="meta">' + escapeHtml(e.meta) + ' · ' + new Date(e.when).toLocaleString() + '</div>' +
      (e.summary ? '<div class="summary">' + escapeHtml(e.summary) + '</div>' : '') +
      '<p class="preview">' + escapeHtml(e.preview || '(no preview)') + '</p>' +
      '<div class="actions"><button data-action="summarize" data-kind="' + kind + '" data-id="' + e.id + '">Summarize</button>' +
      '<button class="danger" data-action="discard" data-kind="' + kind + '" data-id="' + e.id + '">Discard</button></div>' +
      '<div class="error"></div></div>';
  }
  async function load() {
    try {
      const data = await api('/api/entries');
      for (const key of ['searches', 'pages']) {
        const group = data.find((g) => g.kind === key);
        document.getElementById(key).innerHTML = (group ? group.entries : []).map((e) => entryHtml(key, e)).join('') || '<p>No entries.</p>';
      }
    } catch (err) {
      document.getElementById('searches').innerHTML = '<p class="error">' + escapeHtml(err.message) + '</p>';
    }
  }
  document.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const { action, kind, id } = button.dataset;
    const errorEl = button.closest('.entry').querySelector('.error');
    try {
      if (action === 'summarize') {
        button.disabled = true; button.textContent = '…';
        const result = await api('/api/summarize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: Number(id), kind }) });
        button.disabled = false; button.textContent = 'Summarize';
        const summaryEl = document.createElement('div'); summaryEl.className = 'summary';
        summaryEl.textContent = result.summary; button.closest('.entry').insertBefore(summaryEl, button.closest('.actions'));
      } else {
        await api('/api/discard', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: Number(id), kind }) });
        button.closest('.entry').remove();
      }
    } catch (err) { errorEl.textContent = err.message; }
  });
  load();
</script>
</body>
</html>`
}
