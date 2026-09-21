import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createWebStack, type WebStack } from '../src/stack.ts'
import { CoreError, errorCodeOf } from '../src/errors.ts'
import type { HostAdapter, ToolSpec } from '../src/types.ts'

/** Temp state dir inside the workspace (sandbox-safe; gitignored). */
const tmpRoot = join(process.cwd(), '.test-tmp')
let stateDir: string
let host: HostAdapter
let stack: WebStack | undefined
let registered: readonly ToolSpec[] | undefined
let disposed = 0

beforeEach(() => {
  stateDir = join(tmpRoot, `state-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(stateDir, { recursive: true })
  disposed = 0
  registered = undefined
  host = {
    identity: { name: 'test-host', version: '1.2.3' },
    config: {},
    paths: { stateDir },
    credential: async () => undefined,
    registerTools: (specs) => {
      registered = specs
      return () => undefined
    },
    toHostError: (error) => error,
    dispose: async () => {
      disposed += 1
    },
  }
  stack = createWebStack(host)
})

afterEach(async () => {
  if (stack !== undefined) await stack.dispose()
  stack = undefined
  rmSync(stateDir, { recursive: true, force: true })
  rmSync(tmpRoot, { recursive: true, force: true })
})

describe('createWebStack', () => {
  it('resolves the config and composes the user-agent with host identity', () => {
    expect(stack?.config.search.engines).toEqual(['ddg', 'bing'])
    expect(stack?.config.store.path).toBe(join(stateDir, 'web.db'))
    expect(stack?.userAgent).toContain('test-host/1.2.3')
  })

  it('does not auto-register tools (the host registers them from tools())', () => {
    expect(registered).toBeUndefined()
  })

  it('tools() returns the seven v1.0 specs', () => {
    const tools = stack!.tools()
    expect(tools.map((tool) => tool.name)).toEqual([
      'web_search', 'web_fetch', 'get_search_content', 'web_platform_search', 'web_history', 'web_search_stats', 'web_cache_clear',
    ])
  })

  it('keeps the browser module off by default (Q8)', () => {
    expect(stack?.browser).toBeUndefined()
    expect(stack!.tools().some((tool) => tool.name.startsWith('browser_'))).toBe(false)
  })

  it('exposes the full engine map', () => {
    expect(stack!.engines.size).toBe(14)
    expect(stack!.engines.get('ddg')?.id).toBe('ddg')
  })

  it('search rejects empty queries with WEB_BAD_REQUEST', async () => {
    const error = await stack!.search({ query: '   ' }).catch((value: unknown) => value)
    expect(error).toBeInstanceOf(CoreError)
    expect(errorCodeOf(error)).toBe('WEB_BAD_REQUEST')
  })

  it('fetch rejects empty urls with WEB_BAD_REQUEST', async () => {
    const error = await stack!.fetch({ url: '' }).catch((value: unknown) => value)
    expect(error).toBeInstanceOf(CoreError)
    expect(errorCodeOf(error)).toBe('WEB_BAD_REQUEST')
  })

  it('platformSearch rejects unknown platforms with WEB_PROVIDER_ERROR', async () => {
    const error = await stack!.platformSearch({ platform: 'nope', query: 'x' }).catch((value: unknown) => value)
    expect(error).toBeInstanceOf(CoreError)
    expect(errorCodeOf(error)).toBe('WEB_PROVIDER_ERROR')
    expect((error as CoreError).message).toContain('unknown platform')
  })

  it('dispose() releases host resources and is idempotent', async () => {
    await stack!.dispose()
    await stack!.dispose()
    expect(disposed).toBe(1)
  })
})

describe('createWebStack with the browser module (browser.enabled)', () => {
  let browserStack: WebStack | undefined
  let browserStateDir: string

  beforeEach(() => {
    browserStateDir = join(tmpRoot, `browser-state-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(browserStateDir, { recursive: true })
    const browserHost: HostAdapter = {
      identity: { name: 'test-host', version: '1.2.3' },
      config: { browser: { enabled: true, approval: 'never' } },
      paths: { stateDir: browserStateDir },
      credential: async () => undefined,
      registerTools: (specs) => {
        return () => {
          void specs
        }
      },
      toHostError: (error) => error,
    }
    browserStack = createWebStack(browserHost)
  })

  afterEach(async () => {
    if (browserStack !== undefined) await browserStack.dispose()
    browserStack = undefined
    rmSync(browserStateDir, { recursive: true, force: true })
  })

  it('exposes stack.browser (playwright backend) and 14 tools', () => {
    expect(browserStack?.browser).toBeDefined()
    expect(browserStack!.browser!.providerId).toBe('playwright')
    const names = browserStack!.tools().map((tool) => tool.name)
    expect(names).toHaveLength(15)
    expect(names).toContain('browser_open')
    expect(names).toContain('browser_close')
    expect(names.slice(0, 7)).toEqual([
      'web_search', 'web_fetch', 'get_search_content', 'web_platform_search', 'web_history', 'web_search_stats', 'web_cache_clear',
    ])
  })

  it('resolves the browser config (headless default true, approval default navigate)', () => {
    expect(browserStack!.config.browser.enabled).toBe(true)
    expect(browserStack!.config.browser.headless).toBe(true)
    expect(browserStack!.config.browser.approval).toBe('never')
    expect(browserStack!.config.browser.maxConcurrentTabs).toBe(1)
    expect(browserStack!.config.browser.screenshotInlineDefault).toBe(false)
  })
})
