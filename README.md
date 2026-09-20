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
`web_history`, `web_search_stats`, `web_cache_clear`.
Phase 5 добавит `get_search_content`, расширенный fetch (PDF/YouTube/GitHub)
и curator UI (ADR-006).

## Конфигурация

Полная схема — `CoreConfig` (типизация в `src/types.ts`). Все поля
заведены значениями по умолчанию: пустой конфиг даёт рабочий безключевой
стек. Ключевые блоки: `search` (engines, mode fallback|fuse, enrich, embed),
`fetch` (кэш 24ч, maxBody 5 MiB, SSRF), `platforms`, `store`, `ssrf`
(trustEnvProxy), `browser` (Playwright, по умолчанию off), `providers`,
`extended` (phase 5).

## Безопасность

- SSRF-гард: литерал + post-DNS (rebinding), блокlist IPv4/IPv6 приватных и
  зарезервированных диапазонов, ≤5 редирект-хопов (каждый — повторная проверка).
  `ssrf.trustEnvProxy` — оп-ин для проксированных хостнеймов.
- Секреты никогда не попадают в сообщения об ошибках или логи.
- Browser-модуль (Playwright, опциональная зависимость) по умолчанию отключён;
  подтверждения — fail-closed (нет `host.approve` → операция отклонена).

## Лицензия

MIT. Значительная часть кода перенесена из проекта `dsh-web-automation` (MIT).
