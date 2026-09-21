import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { startCuratorServer, isLoopback } from '../src/curator/index.ts'
import { WebStore } from '../src/store/index.ts'
import { resolveCoreConfig, type ResolvedCoreConfig } from '../src/config.ts'
import { buildCoreTools, type ToolHost } from '../src/tools/index.ts'
import type { LlmClient } from '../src/types.ts'
import { CoreError } from '../src/errors.ts'
import { searchCacheKey } from '../src/search/provider.ts'
import { normalizeUrl } from '../src/search/url.ts'

/** A deterministic fake LLM (echoes a fixed summary). */
function fakeLlm(text = 'SUMMARY-TEXT') {
  return {
    complete: vi.fn(async () => ({ text, model: 'fake-model', usage: { in: 10, out: 5 } })),
  } as LlmClient
}

describe('curator server (5.4)', () => {
  let store: WebStore
  let handles: Array<{ close: () => Promise<void> }> = []
  let searchId: number
  let pageId: number

  afterEach(async () => {
    for (const handle of handles.splice(0)) await handle.close()
    await store.close()
  })

  async function seed() {
    searchId = await store.recordSearch({
      cacheKey: searchCacheKey('curl test', ['curl'], 'multi'),
      query: 'curl test',
      engines: ['curl'],
      createdAt: Date.now(),
      sources: [
        { url: 'https://example.com/a', title: 'Example A', snippet: 'snippet a' },
        { url: 'https://example.com/b', title: 'Example B', snippet: 'snippet b' },
      ],
      truncated: false,
      content: 'merged answer text',
    })
    pageId = await store.recordPage({
      url: 'https://example.com/a',
      normalizedUrl: normalizeUrl('https://example.com/a'),
      fetchedAt: Date.now(),
      statusCode: 200,
      bodyKind: 'text',
      body: 'page body content',
      truncated: false,
    })
  }

  async function start(options: { llm?: LlmClient } = {}) {
    store = new WebStore({ path: ':memory:' })
    await seed()
    const handle = await startCuratorServer({ store, llm: options.llm, port: 0 })
    handles.push(handle)
    return { handle, searchId, pageId }
  }

  it('lists entries (searches + pages) with previews', async () => {
    const { handle, searchId: sid, pageId: pid } = await start()
    const base = handle.url.split('/?token=')[0]
    const res = await fetch(`${base}/api/entries`, {
      headers: { authorization: `Bearer ${handle.token}` },
    })
    expect(res.status).toBe(200)
    const data = (await res.json()) as Array<{ kind: string; entries: Array<{ id: number; title: string }> }>
    const searches = data.find((g) => g.kind === 'search')!
    const pages = data.find((g) => g.kind === 'page')!
    expect(searches.entries.map((e) => e.id)).toContain(sid)
    expect(searches.entries[0]!.title).toBe('curl test')
    expect(pages.entries.map((e) => e.id)).toContain(pid)
    expect(pages.entries[0]!.title).toBe('https://example.com/a')
  })

  it('rejects requests without a token (401)', async () => {
    const { handle } = await start()
    const base = handle.url.split('/?token=')[0]
    const res = await fetch(`${base}/api/entries`)
    expect(res.status).toBe(401)
    const bad = await fetch(`${base}/api/entries`, { headers: { authorization: 'Bearer wrong' } })
    expect(bad.status).toBe(401)
  })

  it('serves the HTML page with the correct token', async () => {
    const { handle } = await start()
    const res = await fetch(handle.url)
    expect(res.status).toBe(200)
    expect((res.headers.get('content-type') ?? '').includes('text/html')).toBe(true)
    const html = await res.text()
    expect(html).toContain('Web Search Curator')
    // The token travels in the URL query, not in the page body.
    expect(handle.url).toContain(handle.token)
    expect(html).not.toContain(handle.token)
  })

  it('summarizes through the LLM and caches the summary', async () => {
    const llm = fakeLlm()
    const { handle, searchId: sid } = await start({ llm })
    const base = handle.url.split('/?token=')[0]
    const res = await fetch(`${base}/api/summarize`, {
      method: 'POST',
      headers: { authorization: `Bearer ${handle.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ id: sid, kind: 'search' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { summary: string }
    expect(body.summary).toBe('SUMMARY-TEXT')
    // Second call: served from the in-memory summary cache (one LLM call total).
    await fetch(`${base}/api/summarize`, {
      method: 'POST',
      headers: { authorization: `Bearer ${handle.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ id: sid, kind: 'search' }),
    })
    expect(llm.complete).toHaveBeenCalledTimes(1)
    const prompt = (llm.complete as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0] as { prompt: string }
    expect(prompt.prompt).toContain('curl test')
    expect(prompt.prompt).toContain('https://example.com/a')
  })

  it('fails closed (501) without an LLM client', async () => {
    const { handle, searchId: sid } = await start()
    const base = handle.url.split('/?token=')[0]
    const res = await fetch(`${base}/api/summarize`, {
      method: 'POST',
      headers: { authorization: `Bearer ${handle.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ id: sid, kind: 'search' }),
    })
    expect(res.status).toBe(501)
    const body = (await res.json()) as { code: string }
    expect(body.code).toBe('WEB_NOT_AVAILABLE')
  })

  it('discards entries (and their summaries)', async () => {
    const { handle, searchId: sid, pageId: pid } = await start()
    const base = handle.url.split('/?token=')[0]
    const res = await fetch(`${base}/api/discard`, {
      method: 'POST',
      headers: { authorization: `Bearer ${handle.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ id: sid, kind: 'search' }),
    })
    expect(res.status).toBe(200)
    expect(await store.deleteSearch(sid)).toBe(false) // already gone
    const missing = await fetch(`${base}/api/discard`, {
      method: 'POST',
      headers: { authorization: `Bearer ${handle.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ id: pid + 999, kind: 'page' }),
    })
    expect(missing.status).toBe(404)
    // The remaining page is still listed.
    const entries = await fetch(`${base}/api/entries`, { headers: { authorization: `Bearer ${handle.token}` } })
    const data = (await entries.json()) as Array<{ kind: string; entries: Array<{ id: number }> }>
    expect(data.find((g) => g.kind === 'page')!.entries.map((e) => e.id)).toContain(pid)
  })

  it('ignores invalid bodies (400)', async () => {
    const { handle } = await start()
    const base = handle.url.split('/?token=')[0]
    const res = await fetch(`${base}/api/discard`, {
      method: 'POST',
      headers: { authorization: `Bearer ${handle.token}`, 'content-type': 'application/json' },
      body: 'not json',
    })
    expect(res.status).toBe(500) // invalid JSON → WEB_INTERNAL guard (500)
    const bad = await fetch(`${base}/api/summarize`, {
      method: 'POST',
      headers: { authorization: `Bearer ${handle.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'x', kind: 'search' }),
    })
    expect(bad.status).toBe(400)
  })
})

describe('isLoopback (5.4)', () => {
  it('accepts loopback values and rejects the rest', () => {
    expect(isLoopback(undefined)).toBe(true)
    expect(isLoopback('127.0.0.1')).toBe(true)
    expect(isLoopback('::1')).toBe(true)
    expect(isLoopback('localhost')).toBe(true)
    expect(isLoopback('0.0.0.0')).toBe(false)
    expect(isLoopback('10.0.0.1')).toBe(false)
  })
})

describe('web_curator tool (5.4)', () => {
  function makeHost(config: ResolvedCoreConfig, llm?: LlmClient): ToolHost {
    const store = new WebStore({ path: ':memory:' })
    return {
      config,
      store,
      search: async () => {
        throw new CoreError('not wired in this test', 'WEB_NOT_AVAILABLE')
      },
      fetch: async () => {
        throw new CoreError('not wired in this test', 'WEB_NOT_AVAILABLE')
      },
      platformSearch: async () => {
        throw new CoreError('not wired in this test', 'WEB_NOT_AVAILABLE')
      },
      llm,
    }
  }

  it('is not registered when extended.curator.enabled is false (default)', () => {
    const host = makeHost(resolveCoreConfig(undefined, path.join(tmpdir(), 'curator-off')))
    const tools = buildCoreTools(host)
    expect(tools.map((tool) => tool.name)).not.toContain('web_curator')
  })

  it('starts/status/stops the curator server', async () => {
    const host = makeHost(resolveCoreConfig({ extended: { curator: { enabled: true } } }, path.join(tmpdir(), 'curator-on')))
    const tool = buildCoreTools(host).find((spec) => spec.name === 'web_curator')!
    const ctx = { signal: new AbortController().signal }

    const started = await tool.execute({ action: 'start' }, ctx)
    expect(started.isError).toBeUndefined()
    expect(started.text).toContain('http://127.0.0.1:')
    expect(started.text).toContain('token=')
    const url = (started.text.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[a-f0-9]+/) ?? [])[0]
    expect(url).toBeDefined()
    const fullUrl = url!

    const again = await tool.execute({ action: 'start' }, ctx)
    expect(again.text).toContain('already running')

    const status = await tool.execute({ action: 'status' }, ctx)
    expect(status.text).toContain('running at')

    // The URL is actually reachable.
    const token = fullUrl.split('token=')[1]!
    const res = await fetch(`${fullUrl.split('/?token=')[0]}/api/entries`, {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)

    const stopped = await tool.execute({ action: 'stop' }, ctx)
    expect(stopped.text).toContain('stopped')
    const statusAfter = await tool.execute({ action: 'status' }, ctx)
    expect(statusAfter.text).toContain('No curator server')

    const badAction = await tool.execute({ action: 'explode' }, ctx)
    expect(badAction.isError).toBe(true)
    expect(badAction.text).toContain('WEB_BAD_REQUEST')

    const stopEmpty = await tool.execute({ action: 'stop' }, ctx)
    expect(stopEmpty.text).toContain('No curator server')
    await host.store.close()
  })
})
