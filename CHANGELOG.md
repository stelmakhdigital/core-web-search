# Changelog — @agents-web-search/core

Формат — Keep a Changelog; даты — по факту коммитов (ветка `master`).

## [1.0.0] — 2026-09-21

Первый стабильный релиз: полный функциональный скоуп (фазы 3–7), security-
ревью, E2E-проверка в реальных хостах (DSH + Pi).

### Добавлено (с 0.1.0)

- **Расширенный fetch (фаза 5)**:
  - PDF — локальное извлечение (`unpdf`), `fetch.pdf` (20 MB / 50 стр.);
  - YouTube-документы — oEmbed + description + таймcoded-транскрипт
    (без ffmpeg), `fetch.video`;
  - GitHub — repo/tree/blob через shallow-клон кэш (200 MB / 500 записей),
    PR/issue — keyless REST API (404 → `WEB_NOT_AVAILABLE`, 403/429 →
    `WEB_QUOTA`), `fetch.github`;
  - curator UI — локальный HTTP-сервер 127.0.0.1 + 128-бит Bearer-токен:
    ревизия поисков/страниц, LLM-саммари через `HostAdapter.llm`
    (fail-closed без LLM), discard; инструмент `web_curator`
    (`extended.curator.enabled`);
  - `get_search_content` — чтение полного закэшированного контента по id
    записи (`findText`/`offset`/`limit`); `SearchResult.searchId` /
    `FetchResult.pageId` печатаются в выводах `web_search`/`web_fetch`.
- **Q9-линт (6.1)**: `lint:no-host-imports` — запрет host-импортов в core
  (автоматически в CI).
- **Security (6.3)**: SSRF-гард на каждый редирект-хоп во всех сетевых
  путях (включая video-субзапросы — ранее `redirect: 'follow'`);
  curator runtime-предупреждение о loopback/TLS при `curator.remote: true`.
- **Несовместимости (6.4)**: документированы и проверены (double-install
  DSH → actionable `WEB_DUPLICATE_PROVIDER`; Pi tool-name conflict →
  fail-fast; core double-install — безопасен: нет мутабельного глобального
  состояния).
- **Лимиты (6.5)**: полная инвентаризация + таблица дефолтов в README;
  `extended.contentCache` задокументирован как reserved/no-op v0.1.
- **README (7.1)**: RU + EN — установка в DSH/Pi, «как написать свой
  адаптер» (HostAdapter), конфиг-референс, privacy-модель, browser-модуль.

### Изменено

- `videoSubFetch` — перенесён на `fetchPublic` (SSRF-повторная проверка
  каждого редирект-хопа; `SsrfBlockedError` → `WEB_SSRF_BLOCKED`).
- `web_curator` (start) — при `curator.remote: true` в ответе заметка:
  «remote access deferred — loopback only, no TLS».

### Тесты и качество

- 298 тестов (база 195 + extended 86 + lint 6 + security 10 + limits 1);
  coverage 68.35/60.44/71.07/71.77 (пороги 55/50/60/58 + per-dir).
- CI: node 22, `npm ci` → typecheck → lint:no-host-imports →
  test:coverage.
- E2E-дым (6.2): DSH-профиль (`dsh plugin add`, `--dump-config`, boot Web
  UI), smoke 6/6 (реальные сети + headless Chromium), provider-native 3/3
  (mock Messages API), Pi + mock LLM (реальный tool-call).

## [0.1.0] — 2026-09-20

Начальная версия (фаза 3): ядро без host-зависимостей —
`createWebStack(host)`; 14 поисковых движков (ddg/bing keyless, searxng/
ollama локальные, exa/jina/tavily/brave API, openai/xai/anthropic/
deepseek/gemini/perplexity provider-native) + multi-роутер (fallback /
fuse+RRF); cached fetch с SSRF-защитой (literal + post-DNS, per-hop);
platform-поиск (github, reddit, youtube, bilibili, v2ex, rss + custom);
web store (SQLite: история + кэш, eviction); инструменты
`web_search`/`web_fetch`/`web_platform_search`/`web_history`/
`web_search_stats`/`web_cache_clear`; browser-модуль (Playwright,
optional, off по умолчанию, fail-closed approvals).
