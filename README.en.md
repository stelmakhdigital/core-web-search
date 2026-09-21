# @agents-web-search/core

An agent-agnostic web-search core: 14 search engines (keyless SERP, APIs and
provider-native), cached fetch with SSRF protection, platform search, a web
store (history/cache) and model-facing tools. Host agents (DSH, Pi, and any
other agent) integrate through a single `HostAdapter` contract — the core has
zero agent dependencies (Q9) and no host imports (enforced by CI lint, 6.1).

> Русский: русскоязычная версия — [`README.md`](README.md).

## Quick start

```ts
import { createWebStack } from '@agents-web-search/core'

const host = {
  identity: { name: 'my-agent', version: '1.0.0' },
  config: {}, // empty config = keyless stack (ddg + bing)
  paths: { stateDir: '/home/user/.my-agent' },
  async credential() { return undefined },
  registerTools(specs) { /* register in the host's mechanism */ return () => {} },
  toHostError(error) { return error },
}

const stack = createWebStack(host)
const result = await stack.search({ query: 'node 22 release notes', maxResults: 5 })
console.log(result.sources.map((s) => s.url))

// or model-facing tools (ToolSpec with JSON-Schema parameters):
for (const tool of stack.tools()) {
  console.log(tool.name) // web_search, web_fetch, web_platform_search, ...
  const out = await tool.execute({ queries: ['vitest 4'] }, { signal: new AbortController().signal })
}
await stack.dispose()
```

## Engines (14)

| Id | Type | Key | Default |
|---|---|---|---|
| `ddg`, `bing` | HTML SERP | none | yes (`search.engines`) |
| `searxng`, `ollama` | local instances | none | per-endpoint config |
| `exa`, `jina`, `tavily`, `brave` | search APIs | API key | when a key is present |
| `openai`, `xai` | provider-native (Responses API) | API key | xai — explicit only |
| `anthropic`, `deepseek` | provider-native (Messages API) | API key | — |
| `gemini` | provider-native (generateContent) | API key | — |
| `perplexity` | provider-native (synthesis + citations) | API key | — |

Keys: `config.providers.<engine>.apiKey` → `host.credential('websearch:<engine>')`
→ env (`OPENAI_API_KEY`, `EXA_API_KEY`, …). Provider-native = the host's own
web search inside the LLM call (one LLM request per search; 60 s router
deadline).

## Tools (v1.0)

`web_search` (1–4 queries, max_results ≤ 20, recency, domains, engine),
`web_fetch` (readable→markdown / raw), `web_platform_search` (github, reddit,
youtube, bilibili, v2ex, rss + custom), `web_history`, `web_search_stats`,
`web_cache_clear`, `web_curator` (`extended.curator.enabled`),
`get_search_content` (full cached content by record id, with
`findText`/`offset`/`limit`). Extended fetch: PDF (local `unpdf`),
YouTube documents (oEmbed + description + timed transcript), GitHub
(repo/tree/blob via shallow clone cache; PRs/issues via keyless REST API),
curator UI (loopback HTTP server + token: review searches/pages, LLM
summaries via `HostAdapter.llm`, discard).

## Install into agents

Distribution channel: **git** (decision 2026-09-21: the packages are not
published to npm; the `@agents-web-search/*` names are kept as package
identifiers). The adapters repo is self-contained: the pinned core
(`v1.0.0`) ships inside the repo as a tarball (`.vendor/`) and the DSH
plugin as a prebuilt bundle (`packages/dsh/lib/`) — a fresh clone
installs offline.

### DSH (DeepSeek Harness)

Adapter: [`@agents-web-search/dsh`](https://github.com/stelmakhdigital/agents-web-search/tree/master/packages/dsh)
(cordis plugin):

```sh
git clone https://github.com/stelmakhdigital/agents-web-search.git
# in a DSH profile (a dir with package.json + pnpm-workspace.yaml):
dsh plugin --profile <profile> add file:/path/to/agents-web-search/packages/dsh
dsh --profile <profile> --dump-config   # verify: web seam patched (multi/cached-http)
```

Update: `git -C /path/to/agents-web-search pull` +
`dsh plugin --profile <profile> update`. There is no one-command
`dsh plugin add git+https://…`: `dsh plugin add` is a forwarder to
`pnpm add`, and pnpm resolves `file:` dependencies inside a git package
relative to the **consuming project** (the profile), not the clone
(verified on pnpm 11.7) — clone + `file:` is the reliable, E2E-verified
path (fresh clone → `--dump-config`: seam pinned, no DUPLICATE/AMBIGUOUS).

The plugin registers the core's providers into the `web` seam (ids
`multi`/`cached-http`) plus the adapter tools (`get_search_content`,
`web_platform_search`, `web_history`, `web_search_stats`, `web_cache_clear`,
`browser_*`). `web_search`/`web_fetch` belong to the host's `tool-web`; the
pin `searchProvider: multi`/`fetchProvider: cached-http` routes them to the
core. Built-in DSH web packages (ids `http`/`deepseek`, …) coexist safely —
the pin resolves `WEB_PROVIDER_AMBIGUOUS`; `WEB_DUPLICATE_PROVIDER` can only
happen when the plugin is loaded twice (6.4).

### Pi (earendil-works)

Adapter: [`@agents-web-search/pi`](https://github.com/stelmakhdigital/agents-web-search/tree/master/packages/pi)
(Pi package with an extension). Pi installs a git repo in **one command**
(it clones into its install dir and runs `npm install` itself):

```sh
pi install https://github.com/stelmakhdigital/agents-web-search.git@v1.0.1   # user scope
pi install -l https://github.com/stelmakhdigital/agents-web-search.git@v1.0.1  # project scope
pi list                                    # verify
# update: pi update (for a pinned ref — fetch origin <ref>)
```

The extension registers all core tools (including `web_search`/`web_fetch`);
config — `~/.pi/agent/web-search.json` (optional), state —
`~/.pi/agent/web-search/`. A tool-name conflict with another extension
fails fast at Pi startup (6.4).

### Using the core directly (in your own code)

The core is a plain package (repo root `core-web-search`) and can be
installed straight from git (the repo ships a prebuilt `lib/`):

```sh
pnpm add git+https://github.com/stelmakhdigital/core-web-search.git#v1.0.0
# or with npm:
npm i git+https://github.com/stelmakhdigital/core-web-search.git#v1.0.0
```

## Writing your own adapter (HostAdapter)

The core is agent-agnostic (Q9): any agent integrates through the single
`HostAdapter` contract (`createWebStack(host)`). Fields:

| Field | Role |
|---|---|
| `identity: {name, version?}` | host metadata (history/stats) |
| `config: CoreConfig` | core config (partial allowed — defaults exist) |
| `paths: {stateDir, tempDir?}` | where `web.db` and temp files live |
| `credential(name) → string?` | secrets (e.g. `websearch:<engine>` for API keys) |
| `registerTools(specs) → disposer` | register `ToolSpec`s in the host's mechanism; **the core never calls registerTools itself — the adapter does** |
| `toHostError(error) → unknown` | map `CoreError` to the host's error format |
| `approve?(request) → boolean?` | approvals (browser); absent → fail-closed |
| `llm?(client)` | LLM client (`complete({prompt, model?, maxTokens?, signal?})`): question mode of `web_fetch`, curator summaries; absent → those features fail closed |
| `log?`, `dispose?` | optional hooks |

`ToolSpec` = `{name, description, parameters (JSON Schema), maxOutputChars?,
execute(args, {signal, onUpdate?}) → Promise<{text, isError?}>}`. Tool
errors are returned as `{text: 'Error (<CODE>): <message>', isError: true}`.

Adapter rules (ADR-002): a thin layer — mapping of types/config/paths/
errors only; all logic (engines, cache, SSRF, store, tools) lives in the
core. The shared contract test suite for new adapters is
`runHostContractTests` (the `packages/contract` package of agents-web-search,
12 checks).

## Configuration reference

Full type — `CoreConfig` (`src/types.ts`); every field is validated
(`resolveCoreConfig` → `WEB_BAD_REQUEST` on violation). Out-of-the-box
defaults (empty config = keyless ddg+bing):

| Block | Key fields (default) |
|---|---|
| `search` | `engines` (ddg, bing), `mode` (fallback), `region`, `freshness`, `rateLimitPerSec` (1), `timeoutMs` (30 s), `cacheTtlMs` (15 min), `maxSerpBytes` (2 MB), `enrich` (6/5/10 s), `embed` (off) |
| `fetch` | `cacheTtlMs` (24 h), `revalidate` (true), `maxBodyBytes` (5 MB), `maxOutputChars` (100 k), `timeoutMs` (30 s), `maxRedirects` (5), `allowPrivateNetworks` (false) |
| `fetch.pdf` | `enabled` (true), `maxSizeBytes` (20 MB), `maxPages` (50) |
| `fetch.video` | `enabled` (true) — YouTube: oEmbed + description + timed transcript |
| `fetch.github` | `enabled` (true), `maxCloneBytes` (200 MB), `maxTreeEntries` (500) |
| `platforms` | `enabled` (true), `maxResults` (20), `timeoutMs` (30 s), `maxBytes` (5 MB), `platforms[]` (custom), `rulePackPaths[]` |
| `store` | `path` (`<stateDir>/web.db`), `evictLimits` (1000/500) |
| `ssrf` | `trustEnvProxy` (false) |
| `browser` | `enabled` (false), `headless` (true), `approval` (navigate), `allowPrivateNetworks` (false), `maxConcurrentTabs` (1), `timeoutMs` (30 s) |
| `providers.<engine>` | `apiKey`, `baseUrl` (provider-native), `model` — see the engines table |
| `extended.curator` | `enabled` (false), `bind` (127.0.0.1), `host` (localhost), `remote` (false, deferred) |
| `extended.contentCache` | 128 / 128 MiB / 1 h — **no-op in v0.1** (reserved, see Limits) |

## Limits (roadmap 6.5)

All limits live in `config` (validated at `resolveCoreConfig`; a violation is
`WEB_BAD_REQUEST`); see the Russian [`README.md`](README.md) «Лимиты» table
for the full defaults (search 30 s / 1 rps token-bucket / 15 min / 2 MB;
fetch 24 h / 5 MB / 100 k / 30 s / 5 redirects; pdf 20 MB / 50 pages;
github 200 MB / 500 entries; platforms 20 / 30 s / 5 MB; store eviction
1000 / 500; browser 1 tab / 30 s; `web_search.max_results` 5 (1–20); curator
20 k / 512 tokens / 1 MiB / 50 entries; engine cooldown 30 s → ×2 → 1 h).

## Security

Security review 2026-09-21 (roadmap 6.3):

- **SSRF guard**: literal + post-DNS (anti-rebinding) checks, IPv4/IPv6
  private/reserved blocklist (including embedded-IPv4 forms `::ffff:a.b.c.d`
  / NAT64), ≤5 redirect hops — **every hop is re-checked** (`fetchPublic`
  for enrichment/platforms/video sub-requests; `web_fetch` uses a
  same-origin redirect policy plus a literal check of the target).
  `ssrf.trustEnvProxy` — opt-in for proxied hostnames;
  `fetch.allowPrivateNetworks` — explicit opt-in for private networks
  (off by default).
- **Credentials**: engine API keys only via config
  (`providers.*.apiKey`), host credentials (`host.credential`) or env;
  values never appear in error messages, logs or tool output (no `console.*`
  in `src/`; errors only report the absence of a key).
- **Curator UI**: loopback-only server (127.0.0.1; unsafe binds are
  forced to loopback), random 128-bit Bearer token (in the URL, not in the
  HTML), plain HTTP without TLS — remote access is deferred in v0.1 (with
  `curator.remote: true` the tool prints a loopback/TLS warning).
- **Browser module** (Playwright, optional dependency) is off by default;
  `navigate`/`open` pass the SSRF check; approvals are fail-closed (no
  `host.approve` → the operation is denied).
- **Logs/output**: the core writes nothing to stdout/stderr and stores no
  request/response bodies; the local SQLite store (`web.db`) lives in the
  host's state dir.

## Privacy model

- **Local**: all history/cache lives in the SQLite `web.db` in the host's
  state dir (`$DSH_HOME/web.db`, `~/.pi/agent/web-search/` for Pi). No
  telemetry.
- **Keyless engines** (ddg/bing/searxng/ollama): requests go to the public
  SERPs or the user's own instance; no keys involved.
- **API/provider-native engines**: a configured key is sent only to the
  provider at its `baseUrl`; it never appears in errors, logs or output (6.3).
- **LLM**: invoked only through `HostAdapter.llm` (the host's client); the
  core knows no LLM endpoint of its own.
- **Curator UI**: loopback-only, 128-bit token, plain HTTP (TLS deferred) —
  never expose the token URL.
- **Browser**: headless by default; private networks only via explicit
  `browser.allowPrivateNetworks`; actions follow `approval` (fail-closed).

## Browser module

An optional core module (Q8): Playwright is an optional dependency
(installed only with `browser.enabled: true`). Tools: `browser_open`,
`browser_navigate`, `browser_snapshot` (interactive elements with refs +
text), `browser_screenshot` (PNG in the state dir, optionally
inlined), `browser_click`/`browser_type`/`browser_evaluate` (per
`approval`), `browser_close`. Configuration — the `browser` block (see the
reference). SSRF check on open/navigate; timeouts on `page.goto` and
operations; one tab by default (`maxConcurrentTabs`). v0.1 limits: basic
auth profiles only (`browser.authProfiles`); multi-tab and persistent
profiles are on the v1.1 plan.

## License

MIT. A significant part of the code is ported from the `dsh-web-automation`
project (MIT).
