import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CoreError, errorCodeOf } from '../src/errors.ts'
import { PlaywrightProvider } from '../src/browser/playwright.ts'
import type { BrowserSession } from '../src/browser/types.ts'

/**
 * A fake playwright module (chromium.launch → fake browser/page/frames).
 * Behavior is driven by `mock.state`; call logs live in mock.gotos/clicks/fills.
 */
const mock = vi.hoisted(() => {
  const defaults = () => ({
    title: 'Test Page',
    url: 'about:blank',
    gotoFinalUrl: undefined as string | undefined,
    gotoError: undefined as Error | undefined,
    mainEvaluate: {
      elements: [
        { role: 'link', name: 'Home', tag: 'a', href: 'https://example.com/' },
        { role: 'textbox', name: 'q', tag: 'input', href: null },
      ],
      text: 'Main text here',
    } as unknown,
    childEvaluate: { elements: [{ role: 'button', name: 'verify', tag: 'button', href: null }], text: 'child text' } as unknown,
    childUrl: 'https://iframe.example.com',
    evaluateResult: null as unknown,
    evaluateError: undefined as Error | undefined,
    screenshotBuffer: Buffer.from('fake-png'),
    screenshotError: undefined as Error | undefined,
    executablePath: () => '/fake/chromium' as string | (() => string),
    launchError: undefined as Error | undefined,
  })
  const state = { ...defaults(), launched: 0, browserClosed: 0 }
  const gotos: string[] = []
  const clicks: string[] = []
  const fills: { selector: string; text: string }[] = []
  const screenshots: { fullPage?: boolean; selector?: string }[] = []

  function makeLocator(selector: string) {
    return {
      click: async (): Promise<void> => {
        clicks.push(selector)
      },
      fill: async (text: string): Promise<void> => {
        fills.push({ selector, text })
      },
      screenshot: async (): Promise<Buffer> => state.screenshotBuffer,
    }
  }

  const childFrame = {
    url: () => state.childUrl,
    evaluate: async (): Promise<unknown> => {
      if (state.childEvaluate instanceof Error) throw state.childEvaluate
      return state.childEvaluate
    },
    locator: (selector: string) => makeLocator(`child:${selector}`),
  }

  const mainFrame = {
    url: () => state.url,
    evaluate: async (): Promise<unknown> => {
      if (state.mainEvaluate instanceof Error) throw state.mainEvaluate
      return state.mainEvaluate
    },
    locator: (selector: string) => makeLocator(selector),
  }

  const page = {
    url: () => state.url,
    title: async () => state.title,
    frames: () => [mainFrame, childFrame],
    mainFrame: () => mainFrame,
    goto: async (target: string): Promise<void> => {
      gotos.push(target)
      if (state.gotoError !== undefined) throw state.gotoError
      state.url = state.gotoFinalUrl ?? target
    },
    evaluate: async (): Promise<unknown> => {
      if (state.evaluateError !== undefined) throw state.evaluateError
      return state.evaluateResult
    },
    locator: (selector: string) => makeLocator(selector),
    screenshot: async (options: { fullPage?: boolean; selector?: string } = {}): Promise<Buffer> => {
      screenshots.push(options)
      if (state.screenshotError !== undefined) throw state.screenshotError
      return state.screenshotBuffer
    },
  }

  const browser = {
    newContext: async (_options: Record<string, unknown>) => ({ newPage: async () => page }),
    close: async (): Promise<void> => {
      state.browserClosed += 1
    },
  }

  const chromium = {
    executablePath: () => (state.executablePath as () => string)(),
    launch: async (): Promise<unknown> => {
      state.launched += 1
      if (state.launchError !== undefined) throw state.launchError
      return browser
    },
  }

  return {
    state,
    defaults,
    gotos,
    clicks,
    fills,
    screenshots,
    reset(): void {
      Object.assign(state, defaults(), { launched: 0, browserClosed: 0 })
      gotos.length = 0
      clicks.length = 0
      fills.length = 0
      screenshots.length = 0
    },
    module: { chromium },
  }
})

vi.mock('playwright', () => mock.module)

async function openSession(options: { allowPrivateNetworks?: boolean } = {}): Promise<BrowserSession> {
  const provider = new PlaywrightProvider({ headless: true, timeoutMs: 1000, allowPrivateNetworks: options.allowPrivateNetworks })
  return await provider.open({}, undefined)
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<CoreError> {
  const error = await promise.catch((value: unknown) => value)
  expect(error).toBeInstanceOf(CoreError)
  expect(errorCodeOf(error)).toBe(code)
  return error as CoreError
}

beforeEach(() => {
  mock.reset()
})

describe('PlaywrightProvider session (mocked playwright)', () => {
  it('opens a session and navigates to a public URL (normalized, title included)', async () => {
    const session = await openSession()
    const result = await session.navigate('https://example.com/?a=1')
    expect(result).toEqual({ url: 'https://example.com/?a=1', title: 'Test Page' })
    expect(mock.gotos).toEqual(['https://example.com/?a=1'])
    expect(mock.state.launched).toBe(1)
  })

  it('blocks a literal private navigation before any browser work (SSRF)', async () => {
    const session = await openSession()
    const error = await expectCode(session.navigate('http://127.0.0.1/'), 'BROWSER_SSRF_BLOCKED')
    expect(mock.gotos).toHaveLength(0)
    expect(error.message).toContain('SSRF guard')
  })

  it('re-checks the FINAL url after redirects (public → private is blocked)', async () => {
    mock.state.gotoFinalUrl = 'http://169.254.169.254/latest/meta-data'
    const session = await openSession()
    await expectCode(session.navigate('https://example.com/redirect'), 'BROWSER_SSRF_BLOCKED')
    expect(mock.gotos).toHaveLength(1)
  })

  it('allows a private navigation when allowPrivateNetworks is set', async () => {
    mock.state.gotoFinalUrl = 'http://127.0.0.1:8080/'
    const session = await openSession({ allowPrivateNetworks: true })
    const result = await session.navigate('http://127.0.0.1:8080/')
    expect(result.url).toBe('http://127.0.0.1:8080/')
  })

  it('rejects non-http(s) navigation targets', async () => {
    const session = await openSession()
    await expectCode(session.navigate('file:///etc/passwd'), 'BROWSER_INVALID_URL')
  })

  it('snapshots elements across frames with contiguous refs and frame labels', async () => {
    const session = await openSession()
    await session.navigate('https://example.com/')
    const snapshot = await session.snapshot()
    expect(snapshot.url).toBe('https://example.com/')
    expect(snapshot.title).toBe('Test Page')
    expect(snapshot.text).toBe('Main text here')
    expect(snapshot.truncated).toBe(false)
    expect(snapshot.elements).toHaveLength(3)
    const [first, second, third] = snapshot.elements
    expect(first).toEqual({ ref: '@e1', role: 'link', name: 'Home', tag: 'a', href: 'https://example.com/' })
    expect(second).toEqual({ ref: '@e2', role: 'textbox', name: 'q', tag: 'input' })
    expect(third).toEqual({ ref: '@e3', role: 'button', name: 'verify', tag: 'button', frame: 'https://iframe.example.com' })
  })

  it('truncates the snapshot to the requested bounds', async () => {
    const session = await openSession()
    await session.navigate('https://example.com/')
    const snapshot = await session.snapshot({ maxElements: 1 })
    expect(snapshot.elements).toHaveLength(1)
    expect(snapshot.truncated).toBe(true)
  })

  it('routes click/type by ref into the owning frame', async () => {
    const session = await openSession()
    await session.navigate('https://example.com/')
    await session.snapshot()
    await session.click({ kind: 'ref', ref: '@e3' })
    await session.type({ kind: 'ref', ref: '@e1' }, 'hello')
    await session.click({ kind: 'selector', selector: 'a.main' })
    expect(mock.clicks).toEqual(['child:[data-aws-ref="@e3"]', 'a.main'])
    expect(mock.fills).toEqual([{ selector: '[data-aws-ref="@e1"]', text: 'hello' }])
  })

  it('evaluates page expressions and classifies failures', async () => {
    const session = await openSession()
    await session.navigate('https://example.com/')
    mock.state.evaluateResult = { a: 1 }
    expect(await session.evaluate('document.title')).toEqual({ a: 1 })
    mock.state.evaluateError = new Error('page.evaluate: Timeout 5000 exceeded')
    await expectCode(session.evaluate('x'), 'BROWSER_TIMEOUT')
    mock.state.evaluateError = new Error('something else failed')
    await expectCode(session.evaluate('x'), 'BROWSER_ACTION_FAILED')
  })

  it('captures screenshots (page and fullPage)', async () => {
    const session = await openSession()
    await session.navigate('https://example.com/')
    const shot = await session.screenshot({ fullPage: true })
    expect(shot.buffer.equals(Buffer.from('fake-png'))).toBe(true)
    expect(shot.mimeType).toBe('image/png')
    expect(mock.screenshots).toEqual([{ fullPage: true, timeout: 1000 }])
  })

  it('closes idempotently and refuses further actions', async () => {
    const session = await openSession()
    await session.close()
    await session.close()
    expect(mock.state.browserClosed).toBe(1)
    await expectCode(session.navigate('https://example.com/'), 'BROWSER_NOT_OPEN')
    await expectCode(session.snapshot(), 'BROWSER_NOT_OPEN')
  })

  it('available() reflects the executable path resolution', async () => {
    const provider = new PlaywrightProvider()
    expect(provider.available()).toBe(true)
    mock.state.executablePath = () => {
      throw new Error('no executable')
    }
    expect(provider.available()).toBe(false)
  })
})

describe('aborted signals', () => {
  it('navigate with a pre-aborted signal throws BROWSER_ABORTED', async () => {
    const session = await openSession()
    const controller = new AbortController()
    controller.abort()
    await expectCode(session.navigate('https://example.com/', controller.signal), 'BROWSER_ABORTED')
  })

  it('snapshot with a pre-aborted signal throws BROWSER_ABORTED', async () => {
    const session = await openSession()
    const controller = new AbortController()
    controller.abort()
    await expectCode(session.snapshot(undefined, controller.signal), 'BROWSER_ABORTED')
  })
})
