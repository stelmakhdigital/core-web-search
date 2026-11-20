// Live browser e2e (real Chromium, local HTTP fixture): the full open →
// snapshot → click → close flow through the real tool specs. Opt-in, not part
// of CI:
//   WEB_SEARCH_LIVE=1 npx vitest run test/live-browser.local.test.ts
// Skips cleanly when the browser is not launchable on this host. The page is
// served by an in-process http server (loopback allowed via
// browser.allowPrivateNetworks) so the test depends on neither the network
// nor third-party page content.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

import { browserReadiness, createWebStack } from '../src/index.ts'
import type { HostAdapter, ToolSpec } from '../src/index.ts'

const LIVE = process.env.WEB_SEARCH_LIVE === '1'
const readiness = await browserReadiness()
const READY = readiness.hint === undefined

const PAGE_ONE = `<!doctype html><html><head><title>Live Fixture</title></head>
<body><h1>Live Fixture</h1><a href="/two.html">Go to two</a></body></html>`
const PAGE_TWO = '<!doctype html><html><head><title>Page Two</title></head><body><p>second page</p></body></html>'

describe.skipIf(!LIVE || !READY)('live browser e2e (real Chromium)', () => {
  let stateDir: string
  let server: Server
  let port = 0
  const approvals: string[] = []
  let tools: Record<string, ToolSpec>

  beforeAll(async () => {
    stateDir = await mkdtemp(join(tmpdir(), 'aws-live-browser-'))
    server = createServer((req, res) => {
      res.setHeader('content-type', 'text/html')
      res.end(req.url?.startsWith('/two') ? PAGE_TWO : PAGE_ONE)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as AddressInfo).port
    const host: HostAdapter = {
      identity: { name: 'live-test', version: '0.0.0' },
      // loopback fixture: the SSRF guard must be explicitly opened here
      config: { browser: { enabled: true, allowPrivateNetworks: true } },
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
    server.close()
    await rm(stateDir, { recursive: true, force: true })
  })

  const run = async (name: keyof typeof tools, args: Record<string, unknown>) => {
    const spec = tools[name]
    if (spec === undefined) throw new Error(`tool ${name} not registered`)
    return spec.execute(args, { signal: new AbortController().signal })
  }

  it('opens a page, snapshots refs, clicks a link, closes', async () => {
    const open = await run('browser_open', { url: `http://127.0.0.1:${port}/one.html` })
    expect(open.text).toContain('Live Fixture')
    expect(approvals).toContain('browser_navigate')

    const snapshot = await run('browser_snapshot', {})
    expect(snapshot.text).toMatch(/Live Fixture/)
    expect(snapshot.text).toMatch(/@e\d+ \[link\]/)

    const clicked = await run('browser_click', { ref: '@e1' })
    expect(clicked.text).toContain('Clicked @e1')

    const after = await run('browser_snapshot', {})
    // navigation happened; refs were re-numbered for the new document
    expect(after.text).toContain('Page Two')

    const closed = await run('browser_close', {})
    expect(closed.text).toContain('closed')
  }, 90_000)
})
