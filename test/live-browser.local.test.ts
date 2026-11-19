// Live browser e2e (real Chromium, real network): the full open → snapshot →
// click → close flow through the real tool specs. Opt-in, not part of CI:
//   WEB_SEARCH_LIVE=1 npx vitest run test/live-browser.local.test.ts
// Skips cleanly (with a readiness reason printed) when the browser is not
// launchable on this host.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { browserReadiness, createWebStack } from '../src/index.ts'
import type { HostAdapter, ToolSpec } from '../src/index.ts'

const LIVE = process.env.WEB_SEARCH_LIVE === '1'
const readiness = await browserReadiness()
const READY = readiness.hint === undefined

describe.skipIf(!LIVE || !READY)('live browser e2e (real Chromium)', () => {
  let stateDir: string
  const approvals: string[] = []
  let tools: Record<string, ToolSpec>

  beforeAll(async () => {
    stateDir = await mkdtemp(join(tmpdir(), 'aws-live-browser-'))
    const host: HostAdapter = {
      identity: { name: 'live-test', version: '0.0.0' },
      config: { browser: { enabled: true } },
      paths: { stateDir },
      credential: async () => undefined,
      registerTools: () => () => {},
      toHostError: (error) => error,
      approve: async (request) => {
        approvals.push(request.kind)
        return true
      },
    }
    const stack = createWebStack(host)
    tools = Object.fromEntries(stack.tools().map((spec) => [spec.name, spec]))
  })

  afterAll(async () => {
    await tools.browser_close?.execute({}, { signal: new AbortController().signal })
    await rm(stateDir, { recursive: true, force: true })
  })

  const run = async (name: keyof typeof tools, args: Record<string, unknown>) => {
    const spec = tools[name]
    if (spec === undefined) throw new Error(`tool ${name} not registered`)
    return spec.execute(args, { signal: new AbortController().signal })
  }

  it('opens a page, snapshots refs, clicks a link, closes', async () => {
    const open = await run('browser_open', { url: 'https://example.com' })
    expect(open.text).toContain('example.com')
    expect(approvals).toContain('browser_navigate')

    const snapshot = await run('browser_snapshot', {})
    expect(snapshot.text).toMatch(/Example Domain/i)
    expect(snapshot.text).toMatch(/@e\d+ \[link\]/)

    const clicked = await run('browser_click', { ref: '@e1' })
    expect(clicked.text).toContain('Clicked @e1')

    const after = await run('browser_snapshot', {})
    // navigation happened; refs were re-numbered for the new document
    expect(after.text).toContain('URL: http')

    const closed = await run('browser_close', {})
    expect(closed.text).toContain('closed')
  }, 90_000)
})
