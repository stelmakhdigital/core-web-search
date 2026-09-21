# @agents-web-search/core

Агностичное к агентам ядро веб-поиска: 14 поисковых движков (безключевые SERP,
API и provider-native), кешированный fetch с SSRF-защитой, platform-поиск,
web store (история/кэш) и модельные инструменты. Хост-агенты (DSH, Pi, другие)
интегрируются через единственный контракт `HostAdapter` — ядро не зависит ни
от одного агента (Q9) и не содержит host-импортов.

> English: An agent-agnostic web-search core. Hosts integrate via the
> `HostAdapter` contract; the core has zero agent dependencies.

## Быстрый старт

```ts
import { createWebStack } from '@agents-web-search/core'

const host = {
  identity: { name: 'my-agent', version: '1.0.0' },
  config: {}, // пустой конфиг = безключевой стек (ddg + bing)
  paths: { stateDir: '/home/user/.my-agent' },
  async credential() { return undefined },
  registerTools(specs) { /* зарегистрировать в механизме хоста */ return () => {} },
  toHostError(error) { return error },
}

const stack = createWebStack(host)
const result = await stack.search({ query: 'node 22 release notes', maxResults: 5 })
console.log(result.sources.map((s) => s.url))

// или модельные инструменты (ToolSpec с JSON-Schema-параметрами):
for (const tool of stack.tools()) {
  console.log(tool.name) // web_search, web_fetch, web_platform_search, ...
  const out = await tool.execute({ queries: ['vitest 4'] }, { signal: new AbortController().signal })
}
await stack.dispose()
```

## Движки (14)

| Идентификатор | Тип | Ключ | По умолчанию |
|---|---|---|---|
| `ddg`, `bing` | HTML SERP | нет | да (`search.engines`) |
| `searxng`, `ollama` | локальные инстансы | нет | по конфигу endpoint |
| `exa`, `jina`, `tavily`, `brave` | поисковые API | API-ключ | по наличию ключа |
| `openai`, `xai` | provider-native (Responses API) | API-ключ | xai — только явно |
| `anthropic`, `deepseek` | provider-native (Messages API) | API-ключ | — |
| `gemini` | provider-native (generateContent) | API-ключ | — |
| `perplexity` | provider-native (синтез + цитаты) | API-ключ | — |

Ключи: `config.providers.<engine>.apiKey` → `host.credential('websearch:<engine>')`
→ env (`OPENAI_API_KEY`, `EXA_API_KEY`, ...). Provider-native = хостовый
web-search внутри LLM-вызова (один LLM-запрос на поиск, 60-с дедлайн на роутере).

## Инструменты (v1.0)

`web_search` (1–4 запросов, max_results ≤ 20, recency, domains, engine),
`web_fetch` (readable→markdown / raw), `web_platform_search`
(github, reddit, youtube, bilibili, v2ex, rss + настраиваемые),
`web_history`, `web_search_stats`, `web_cache_clear`, `web_curator`
(`extended.curator.enabled`, roadmap 5.4), `get_search_content` (5.5).

Phase 5 (выполнено 5.1–5.5): расширенный fetch — PDF (локальный unpdf,
`fetch.pdf`), YouTube-документы (oEmbed + description + транскрипт,
`fetch.video`), GitHub (клонирование вместо скрейпинга: repo/tree/blob —
shallow clone с кэшем и порогом размера, PR/issue — keyless REST API,
`fetch.github`), curator UI (локальный HTTP-сервер 127.0.0.1 + token:
ревизия поисков/страниц, LLM-саммари через `HostAdapter.llm`, discard —
`extended.curator`), `get_search_content` (5.5: чтение полного закэшированного
контента по id записи — `findText`/`offset`/`limit`; id печатаются в выводах
`web_search`/`web_fetch`; `SearchResult.searchId`/`FetchResult.pageId`).

## Конфигурация

Полная схема — `CoreConfig` (типизация в `src/types.ts`). Все поля
заведены значениями по умолчанию: пустой конфиг даёт рабочий безключевой
стек. Ключевые блоки: `search` (engines, mode fallback|fuse, enrich, embed),
`fetch` (кэш 24ч, maxBody 5 MiB, SSRF), `platforms`, `store`, `ssrf`
(trustEnvProxy), `browser` (Playwright, по умолчанию off), `providers`,
`extended` (phase 5: curator UI), `fetch.pdf` / `fetch.video` /
`fetch.github` (расширенный fetch, phase 5). LLM-возможности (question-режим
web_fetch, curator-саммари) требуют `HostAdapter.llm` — без него fail-closed
`WEB_NOT_AVAILABLE`.

## Лимиты (roadmap 6.5, проверено 2026-09-21)

Все лимиты — в `config` (валидируются при `resolveCoreConfig`; нарушение →
`WEB_BAD_REQUEST`), значения по умолчанию:

| Область | Лимит | Дефолт | Примечание |
|---|---|---|---|
| search | `timeoutMs` | 30 s | таймаут одного запроса к движку |
| search | `rateLimitPerSec` | 1 | token-bucket на движок (burst = perSec) |
| search | `cacheTtlMs` | 15 min | кэш результатов поиска (WebStore) |
| search | `maxSerpBytes` | 2 MB | потолок тела SERP |
| search | enrich `fetchLimit`/`keep`/`fetchTimeoutMs` | 6/5/10 s | fetch-обогащение сниппетов |
| search | cooldown | 30 s → ×2 → 1 h | экспоненциальный backoff упавшего движка (константы стека, не конфиг) |
| fetch | `cacheTtlMs` | 24 h | кэш страниц (WebStore) |
| fetch | `maxBodyBytes` / `maxOutputChars` | 5 MB / 100 k | обрезка тела / вывода |
| fetch | `timeoutMs` / `maxRedirects` | 30 s / 5 | редиректы — same-origin + SSRF-хоп-гард |
| fetch.pdf | `maxSizeBytes` / `maxPages` | 20 MB / 50 | |
| fetch.github | `maxCloneBytes` / `maxTreeEntries` | 200 MB / 500 | shallow-клон кэш |
| platforms | `maxResults` / `timeoutMs` / `maxBytes` | 20 / 30 s / 5 MB | |
| store | `evictLimits` | 1000 / 500 | eviction старых записей (searches/pages) |
| browser | `maxConcurrentTabs` / `timeoutMs` | 1 / 30 s | таймаут — на `page.goto` и операции |
| tools | `web_search.max_results` | 5 (1–20) | выход за диапазон → `WEB_BAD_REQUEST` |
| curator | prompt / `maxTokens` / body / entries | 20 k / 512 / 1 MiB / 50 | лимиты LLM-вывода: 512 токена (advisory для хоста) |

**Зарезервировано (no-op в v0.1):** `extended.contentCache` (128 записей /
128 MiB / 1 ч) — in-memory-кэш `get_search_content` отложен; конфиг
валидируется, эффекта пока нет (контент приходит из WebStore). Коoldown
движков — константы стека (30 s / 1 h), в конфиг не вынесены.

## Безопасность

Security-ревью 2026-09-21 (roadmap 6.3) — состояние:

- **SSRF-гард**: литерал + post-DNS (rebinding), блок-список IPv4/IPv6
  приватных и зарезервированных диапазонов (включая embedded-IPv4 формы
  `::ffff:a.b.c.d` / NAT64), `≤5` редирект-хопов — **каждый хоп проходит
  повторную проверку** (`fetchPublic`: search-enrichment, platforms,
  video-subrequests с 6.3; `web_fetch` — same-origin-политика на хопы +
  литеральная проверка цели). `ssrf.trustEnvProxy` — оп-ин для
  проксированных хостнеймов; `fetch.allowPrivateNetworks` — явный оп-ин на
  приватные сети (по умолчанию выключено).
- **Креденшалы**: API-ключи движков — только через конфиг
  (`providers.*.apiKey`), host-креденшалы (`host.credential`) или env;
  значения никогда не попадают в сообщения об ошибок, логи и вывод
  инструментов (в `src/` нет `console.*`; ошибки сообщают лишь факт
  отсутствия ключа).
- **Curator UI**: сервер только на loopback (`127.0.0.1`; небезопасный bind
  принудительно заменяется), случайный 128-бит Bearer-токен (в URL-запросе,
  не в HTML), plain HTTP без TLS — remote-доступ отложен в v0.1 (при
  `curator.remote: true` инструмент выводит предупреждение о loopback/TLS).
- **Browser-модуль** (Playwright, опциональная зависимость) по умолчанию
  отключён; `navigate`/`open` проходят SSRF-проверку; подтверждения —
  fail-closed (нет `host.approve` → операция отклонена).
- **Логи/вывод**: ядро не пишет в stdout/stderr и не сохраняет тела
  запросов/ответов; локальный SQLite-store (`web.db`) — в host state dir.

## Лицензия

MIT. Значительная часть кода перенесена из проекта `dsh-web-automation` (MIT).
