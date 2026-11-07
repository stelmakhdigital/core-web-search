// Live integration test: the default engine chain against a real local
// SearXNG instance on 127.0.0.1:8080 (installed by agents-web-search
// scripts/searxng/install.sh). Opt-in, not part of CI: run with
//   WEB_SEARCH_LIVE=1 npm test
import { describe, expect, it } from 'vitest'
import { createWebStack } from '../src/index.ts'
import type { HostAdapter } from '../src/index.ts'

const LIVE = process.env.WEB_SEARCH_LIVE === '1'

describe.skipIf(!LIVE)('live local SearXNG (default chain, real instance)', () => {
  it('searches through searxng first and returns results', async () => {
    const host = {
      identity: { name: 'live-test', version: '0.0.0' },
      config: {}, // empty config = searxng, ddg, bing
      paths: { stateDir: '/tmp/agents-web-search-live-test', tempDir: '/tmp/agents-web-search-live-test/temp' },
      async credential() { return undefined },
      registerTools() { return () => {} },
      toHostError(error: unknown) { return error },
    } as unknown as HostAdapter
    const stack = createWebStack(host)
    try {
      const result = await stack.search({ query: 'searxng metasearch', maxResults: 5 })
      expect(result.sources.length).toBeGreaterThan(0)
      console.log('sources:', result.sources.map((s) => s.url).slice(0, 3))
    } finally {
      await stack.dispose()
    }
  }, 30_000)
})
