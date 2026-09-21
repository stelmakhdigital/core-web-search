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

## Установка в агентов

### DSH (DeepSeek Harness)

Адаптер — [`@agents-web-search/dsh`](https://github.com/stelmakhdigital/agents-web-search/tree/master/packages/dsh)
(cordis-плагин):

```sh
# в DSH-профиле (профиль = каталог с package.json + pnpm-workspace.yaml):
dsh plugin --profile <профиль> add npm:@agents-web-search/dsh
# dev-режим (до публикации core, фаза 7.3): file: на каталог адаптера
dsh plugin --profile <профиль> add file:../agents-web-search/packages/dsh
dsh --profile <профиль> --dump-config   # проверка: web seam patched (multi/cached-http)
```

Плагин регистрирует провайдеры в seam `web` (id `multi`/`cached-http`) +
адаптерские инструменты (`get_search_content`, `web_platform_search`,
`web_history`, `web_search_stats`, `web_cache_clear`, `browser_*`).
`web_search`/`web_fetch` принадлежат хостовому `tool-web` — пин
`searchProvider: multi`/`fetchProvider: cached-http` включает их на ядре.
Built-in web-пакеты DSH (id `http`/`deepseek`/…) сосуществуют безопасно:
пин снимает `WEB_PROVIDER_AMBIGUOUS`; `WEB_DUPLICATE_PROVIDER` возможен
только при двойной загрузке плагина (6.4).

### Pi (earendil-works)

Адаптер — [`@agents-web-search/pi`](https://github.com/stelmakhdigital/agents-web-search/tree/master/packages/pi)
(Pi package с extension):

```sh
pi install npm:@agents-web-search/pi      # user scope (~/.pi/agent/npm/)
pi install -l npm:@agents-web-search/pi   # project scope (.pi/npm/)
pi list                                   # проверка
```

Extension регистрирует все инструменты ядра (включая `web_search`/
`web_fetch`), конфиг — `~/.pi/agent/web-search.json` (опционально),
state — `~/.pi/agent/web-search/`. Конфликт имён инструментов с другим
extension → fail-fast при старте Pi (6.4).

## Как написать свой адаптер (HostAdapter)

Ядро агностично (Q9): любой агент подключается через единственный контракт
`HostAdapter` (`createWebStack(host)`). Поля:

| Поле | Роль |
|---|---|
| `identity: {name, version?}` | метаданные хоста (история/статистика) |
| `config: CoreConfig` | конфиг ядра (частичный допустим — есть дефолты) |
| `paths: {stateDir, tempDir?}` | где лежат `web.db` и временные файлы |
| `credential(name) → string?` | секреты (например, `websearch:<engine>` для API-ключей) |
| `registerTools(specs) → disposer` | регистрация `ToolSpec` в механизме хоста; **ядро само registerTools не вызывает — адаптер делает это** |
| `toHostError(error) → unknown` | перевод `CoreError` в формат ошибок хоста |
| `approve?(request) → boolean?` | подтверждения (browser); absent → fail-closed |
| `llm?(client)` | LLM-клиент (`complete({prompt, model?, maxTokens?, signal?})`): question-режим `web_fetch`, curator-саммари; absent → эти функции fail-closed |
| `log?`, `dispose?` | опциональные хуки |

`ToolSpec` = `{name, description, parameters (JSON Schema), maxOutputChars?,
execute(args, {signal, onUpdate?}) → Promise<{text, isError?}>}`. Ошибки
инструментов возвращаются как `{text: 'Error (<CODE>): <message>',
isError: true}`.

Правила адаптера (ADR-002): тонкий слой — только маппинг типов/конфигов/
путей/ошибок; вся логика (движки, кэш, SSRF, store, tools) — в ядре. Общий
контракт тестов для новых адаптеров — `runHostContractTests` (пакет
`packages/contract` в agents-web-search, 12 проверок).

## Конфигурация: референс

Полный тип — `CoreConfig` (`src/types.ts`); все поля валидируются
(`resolveCoreConfig` → `WEB_BAD_REQUEST` при нарушении). Дефолты «из коробки»
(пустой конфиг = безключевой ddg+bing):

| Блок | Ключевые поля (дефолт) |
|---|---|
| `search` | `engines` (ddg, bing), `mode` (fallback), `region`, `freshness`, `rateLimitPerSec` (1), `timeoutMs` (30 s), `cacheTtlMs` (15 min), `maxSerpBytes` (2 MB), `enrich` (6/5/10 s), `embed` (off) |
| `fetch` | `cacheTtlMs` (24 h), `revalidate` (true), `maxBodyBytes` (5 MB), `maxOutputChars` (100 k), `timeoutMs` (30 s), `maxRedirects` (5), `allowPrivateNetworks` (false) |
| `fetch.pdf` | `enabled` (true), `maxSizeBytes` (20 MB), `maxPages` (50) |
| `fetch.video` | `enabled` (true) — YouTube: oEmbed + description + таймcoded-транскрипт |
| `fetch.github` | `enabled` (true), `maxCloneBytes` (200 MB), `maxTreeEntries` (500) |
| `platforms` | `enabled` (true), `maxResults` (20), `timeoutMs` (30 s), `maxBytes` (5 MB), `platforms[]` (custom), `rulePackPaths[]` |
| `store` | `path` (`<stateDir>/web.db`), `evictLimits` (1000/500) |
| `ssrf` | `trustEnvProxy` (false) |
| `browser` | `enabled` (false), `headless` (true), `approval` (navigate), `allowPrivateNetworks` (false), `maxConcurrentTabs` (1), `timeoutMs` (30 s) |
| `providers.<engine>` | `apiKey`, `baseUrl` (для provider-native), `model` — см. таблицу движков |
| `extended.curator` | `enabled` (false), `bind` (127.0.0.1), `host` (localhost), `remote` (false, отложен) |
| `extended.contentCache` | 128/128 MiB/1 h — **no-op в v0.1** (резерв, см. «Лимиты») |

## Privacy-модель

- **Локально**: вся история/кэш — SQLite `web.db` в state dir хоста
  (`$DSH_HOME/web.db`, `~/.pi/agent/web-search/` у Pi). Телеметрии нет.
- **Ключевые движки** (ddg/bing/searxng/ollama): запросы идут на публичные
  SERP/инстанс пользователя; ключи не используются.
- **API/provider-native движки**: ключ (если задан) отправляется только
  провайдеру на `baseUrl`; в сообщениях об ошибках, логах и выводах ключ
  никогда не появляется (6.3).
- **LLM**: вызывается только через `HostAdapter.llm` (клиент хоста); ядро
  не знает ни одного LLM-эндпоинта само.
- **Curator UI**: только loopback, 128-бит токен, plain HTTP (TLS отложен) —
  не публикуйте токен-URL наружу.
- **Браузер**: headless по умолчанию; приватные сети — только явным
  `browser.allowPrivateNetworks`; действия — по `approval` (fail-closed).

## Browser-модуль

Опциональный модуль ядра (Q8): Playwright — optional dependency (ставится
только при `browser.enabled: true`). Инструменты: `browser_open`,
`browser_navigate`, `browser_screenshot` (PNG в state dir, опционально
inline), `browser_click`/`browser_type`/`browser_evaluate` (по
`approval`), `browser_close`. Настройки — блок `browser` (см. референс).
SSRF-проверка на open/navigate; таймаут на `page.goto` и операции;
одна вкладка по умолчанию (`maxConcurrentTabs`). Ограничения v0.1:
auth-профили — базовые (`browser.authProfiles`), мульти-вкладки и
персистентные профили — в план v1.1.

## Лицензия

MIT. Значительная часть кода перенесена из проекта `dsh-web-automation` (MIT).
