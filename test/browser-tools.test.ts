import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveCoreConfig } from '../src/config.ts'
import type { ApprovalRequest, HostAdapter, ToolOutput, ToolSpec } from '../src/types.ts'
import { buildBrowserTools } from '../src/browser/tools.ts'
import type { BrowserManager } from '../src/browser/manager.ts'
import type { BrowserSession } from '../src/browser/types.ts'

const tmpRoot = join(process.cwd(), '.test-tmp')

function makeFakeSession() {
  return {
    providerId: 'fake',
    url: () => 'about:blank',
    navigate: vi.fn(async (url: string): Promise<{ url: string; title?: string }> => ({ url, title: 'Example' })),
    snapshot: vi.fn(async (): Promise<unknown> => ({
      url: 'https://example.com/',
      title: 'Example',
      elements: [{ ref: '@e1', role: 'link', name: 'Home', tag: 'a' }],
      text: 'Example Domain',
      truncated: false,
    })),
    click: vi.fn(async (): Promise<void> => undefined),
    type: vi.fn(async (): Promise<void> => undefined),
    evaluate: vi.fn(async (): Promise<unknown> => ({ ok: true })),
    screenshot: vi.fn(async (): Promise<{ buffer: Buffer; mimeType: 'image/png' }> => ({ buffer: Buffer.from('png-bytes'), mimeType: 'image/png' })),
    close: vi.fn(async (): Promise<void> => undefined),
  }
}

function makeManager(session: BrowserSession | undefined) {
  const manager = {
    providerId: 'fake',
    session: (): BrowserSession | undefined => session,
    open: vi.fn(async (): Promise<BrowserSession> => {
      if (session === undefined) throw new Error('no session in fake')
      return session
    }),
    close: vi.fn(async (): Promise<void> => undefined),
    closeAll: vi.fn(async (): Promise<void> => undefined),
    available: () => true,
  }
  return manager as unknown as BrowserManager
}

function makeHost(approveResult: boolean | undefined, stateDir: string) {
  const approvals: ApprovalRequest[] = []
  const host: HostAdapter = {
    identity: { name: 'test', version: '1.0.0' },
    config: {},
    paths: { stateDir },
    credential: async () => undefined,
    registerTools: () => () => undefined,
    toHostError: (error) => error,
    ...(approveResult === undefined
      ? {}
      : { approve: (request: ApprovalRequest) => { approvals.push(request); return Promise.resolve(approveResult) } }),
  }
  return { host, approvals }
}

function asTool(tools: ToolSpec[], name: string): ToolSpec {
  const tool = tools.find((candidate) => candidate.name === name)
  if (tool === undefined) throw new Error(`tool ${name} not found`)
  return tool
}

async function run(tool: ToolSpec, args: Record<string, unknown> = {}): Promise<ToolOutput> {
  return await tool.execute(args, { signal: new AbortController().signal })
}

let stateDir: string
let session: ReturnType<typeof makeFakeSession>
let manager: BrowserManager

beforeEach(() => {
  stateDir = join(tmpRoot, `browser-tools-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(stateDir, { recursive: true })
  session = makeFakeSession()
  manager = makeManager(session as unknown as BrowserSession)
})

afterEach(() => {
  rmSync(stateDir, { recursive: true, force: true })
  rmSync(tmpRoot, { recursive: true, force: true })
})

describe('buildBrowserTools', () => {
  it('exposes the eight browser_* specs', () => {
    const { host } = makeHost(true, stateDir)
    const config = resolveCoreConfig({ browser: { enabled: true } }, stateDir)
    const tools = buildBrowserTools({ manager, host, config })
    expect(tools.map((tool) => tool.name)).toEqual([
      'browser_open', 'browser_navigate', 'browser_snapshot', 'browser_click',
      'browser_type', 'browser_evaluate', 'browser_screenshot', 'browser_close',
    ])
  })

  it('fails closed when the host has no approval channel (policy navigate)', async () => {
    const { host } = makeHost(undefined, stateDir)
    const config = resolveCoreConfig({ browser: { enabled: true, approval: 'navigate' } }, stateDir)
    const tools = buildBrowserTools({ manager, host, config })
    const output = await run(asTool(tools, 'browser_navigate'), { url: 'https://example.com/' })
    expect(output.isError).toBe(true)
    expect(output.text).toContain('BROWSER_APPROVAL_UNAVAILABLE')
    expect(session.navigate).not.toHaveBeenCalled()
  })

  it('denies when the approver declines', async () => {
    const { host, approvals } = makeHost(false, stateDir)
    const config = resolveCoreConfig({ browser: { enabled: true, approval: 'navigate' } }, stateDir)
    const tools = buildBrowserTools({ manager, host, config })
    const output = await run(asTool(tools, 'browser_navigate'), { url: 'https://example.com/' })
    expect(output.isError).toBe(true)
    expect(output.text).toContain('BROWSER_APPROVAL_DENIED')
    expect(approvals).toHaveLength(1)
    expect(session.navigate).not.toHaveBeenCalled()
  })

  it('runs the action after approval and reports the result', async () => {
    const { host, approvals } = makeHost(true, stateDir)
    const config = resolveCoreConfig({ browser: { enabled: true, approval: 'navigate' } }, stateDir)
    const tools = buildBrowserTools({ manager, host, config })
    const output = await run(asTool(tools, 'browser_navigate'), { url: 'https://example.com/' })
    expect(output.isError).not.toBe(true)
    expect(output.text).toContain('https://example.com/')
    expect(approvals[0]?.kind).toBe('browser_navigate')
    expect(approvals[0]?.description).toContain('https://example.com/')
    expect(session.navigate).toHaveBeenCalledTimes(1)
  })

  it('skips approval entirely in policy "never"', async () => {
    const { host, approvals } = makeHost(true, stateDir)
    const config = resolveCoreConfig({ browser: { enabled: true, approval: 'never' } }, stateDir)
    const tools = buildBrowserTools({ manager, host, config })
    await run(asTool(tools, 'browser_navigate'), { url: 'https://example.com/' })
    await run(asTool(tools, 'browser_click'), { ref: '@e1' })
    await run(asTool(tools, 'browser_evaluate'), { expression: '1 + 1' })
    expect(approvals).toHaveLength(0)
    expect(session.navigate).toHaveBeenCalledTimes(1)
    expect(session.click).toHaveBeenCalledTimes(1)
    expect(session.evaluate).toHaveBeenCalledTimes(1)
  })

  it('gates clicks/types only in policy "all", evaluate in "navigate"', async () => {
    const all = makeHost(true, stateDir)
    const configAll = resolveCoreConfig({ browser: { enabled: true, approval: 'all' } }, stateDir)
    const toolsAll = buildBrowserTools({ manager, host: all.host, config: configAll })
    await run(asTool(toolsAll, 'browser_click'), { ref: '@e1' })
    await run(asTool(toolsAll, 'browser_type'), { ref: '@e1', text: 'x' })
    expect(all.approvals.map((request) => request.kind)).toEqual(['browser_click', 'browser_type'])

    const neverAll = makeHost(true, stateDir)
    const configNav = resolveCoreConfig({ browser: { enabled: true, approval: 'navigate' } }, stateDir)
    const toolsNav = buildBrowserTools({ manager, host: neverAll.host, config: configNav })
    await run(asTool(toolsNav, 'browser_click'), { ref: '@e1' })
    await run(asTool(toolsNav, 'browser_evaluate'), { expression: '1 + 1' })
    await run(asTool(toolsNav, 'browser_snapshot'))
    expect(neverAll.approvals.map((request) => request.kind)).toEqual(['browser_evaluate'])
  })

  it('reports BROWSER_NOT_OPEN when no session is open', async () => {
    const empty = makeManager(undefined)
    const { host } = makeHost(true, stateDir)
    const config = resolveCoreConfig({ browser: { enabled: true, approval: 'never' } }, stateDir)
    const tools = buildBrowserTools({ manager: empty, host, config })
    const output = await run(asTool(tools, 'browser_snapshot'))
    expect(output.isError).toBe(true)
    expect(output.text).toContain('BROWSER_NOT_OPEN')
  })

  it('renders the snapshot for the model', async () => {
    const { host } = makeHost(true, stateDir)
    const config = resolveCoreConfig({ browser: { enabled: true, approval: 'never' } }, stateDir)
    const tools = buildBrowserTools({ manager, host, config })
    const output = await run(asTool(tools, 'browser_snapshot'))
    expect(output.text).toContain('URL: https://example.com/')
    expect(output.text).toContain('@e1 [link] "Home"')
    expect(output.text).toContain('Example Domain')
  })

  it('returns an inline data URI when inline: true', async () => {
    const { host } = makeHost(true, stateDir)
    const config = resolveCoreConfig({ browser: { enabled: true, approval: 'never' } }, stateDir)
    const tools = buildBrowserTools({ manager, host, config })
    const output = await run(asTool(tools, 'browser_screenshot'), { inline: true })
    expect(output.text).toBe(`data:image/png;base64,${Buffer.from('png-bytes').toString('base64')}`)
  })

  it('writes a PNG file by default under <stateDir>/browser-screenshots', async () => {
    const { host } = makeHost(true, stateDir)
    const config = resolveCoreConfig({ browser: { enabled: true, approval: 'never' } }, stateDir)
    const tools = buildBrowserTools({ manager, host, config })
    const output = await run(asTool(tools, 'browser_screenshot'))
    expect(output.isError).not.toBe(true)
    const dir = join(stateDir, 'browser-screenshots')
    const files = readdirSync(dir)
    expect(files).toHaveLength(1)
    expect(output.text).toBe(`Screenshot saved to ${join(dir, files[0]!)}.`)
    expect(existsSync(join(dir, files[0]!))).toBe(true)
  })

  it('opens a session and navigates in browser_open (policy never)', async () => {
    const { host } = makeHost(true, stateDir)
    const config = resolveCoreConfig({ browser: { enabled: true, approval: 'never' } }, stateDir)
    const tools = buildBrowserTools({ manager, host, config })
    const output = await run(asTool(tools, 'browser_open'), { url: 'https://example.com/' })
    expect(output.isError).not.toBe(true)
    expect((manager.open as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1)
    expect(session.navigate).toHaveBeenCalledTimes(1)
    expect(output.text).toContain('Browser session opened')
  })

  it('closes the session in browser_close', async () => {
    const { host } = makeHost(true, stateDir)
    const config = resolveCoreConfig({ browser: { enabled: true, approval: 'never' } }, stateDir)
    const tools = buildBrowserTools({ manager, host, config })
    const output = await run(asTool(tools, 'browser_close'))
    expect(output.isError).not.toBe(true)
    expect((manager.close as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1)
  })

  it('validates click/type targets (exactly one of ref/selector)', async () => {
    const { host } = makeHost(true, stateDir)
    const config = resolveCoreConfig({ browser: { enabled: true, approval: 'never' } }, stateDir)
    const tools = buildBrowserTools({ manager, host, config })
    const both = await run(asTool(tools, 'browser_click'), { ref: '@e1', selector: 'a' })
    expect(both.isError).toBe(true)
    expect(both.text).toContain('exactly one')
    const none = await run(asTool(tools, 'browser_click'), {})
    expect(none.isError).toBe(true)
    const noText = await run(asTool(tools, 'browser_type'), { ref: '@e1' })
    expect(noText.isError).toBe(true)
  })

  it('rejects empty navigation urls', async () => {
    const { host } = makeHost(true, stateDir)
    const config = resolveCoreConfig({ browser: { enabled: true, approval: 'never' } }, stateDir)
    const tools = buildBrowserTools({ manager, host, config })
    const output = await run(asTool(tools, 'browser_navigate'), { url: '' })
    expect(output.isError).toBe(true)
    expect(output.text).toContain('url is required')
  })
})
