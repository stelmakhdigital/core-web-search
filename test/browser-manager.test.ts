import { describe, expect, it, vi } from 'vitest'
import { createBrowserManager } from '../src/browser/manager.ts'
import type { BrowserSession } from '../src/browser/types.ts'
import type { CoreBrowserProvider } from '../src/browser/playwright.ts'
import { errorCodeOf } from '../src/errors.ts'

function makeFakeSession() {
  return {
    providerId: 'fake',
    url: () => 'about:blank',
    navigate: vi.fn(async (): Promise<{ url: string }> => ({ url: 'https://example.com/' })),
    snapshot: vi.fn(),
    click: vi.fn(async (): Promise<void> => undefined),
    type: vi.fn(async (): Promise<void> => undefined),
    evaluate: vi.fn(async (): Promise<unknown> => null),
    screenshot: vi.fn(async (): Promise<{ buffer: Buffer; mimeType: 'image/png' }> => ({ buffer: Buffer.from('png'), mimeType: 'image/png' })),
    close: vi.fn(async (): Promise<void> => undefined),
  }
}

function makeFakeProvider() {
  const opened: BrowserSession[] = []
  const provider: CoreBrowserProvider = {
    id: 'fake',
    available: () => true,
    open: async (): Promise<BrowserSession> => {
      const session = makeFakeSession() as unknown as BrowserSession
      opened.push(session)
      return session
    },
  }
  return { provider, opened }
}

describe('createBrowserManager (fake provider)', () => {
  it('opens one anonymous session and tracks it by key', async () => {
    const { provider, opened } = makeFakeProvider()
    const manager = createBrowserManager({ provider })
    const session = await manager.open()
    expect(manager.session()).toBe(session)
    expect(manager.session(undefined)).toBe(session)
    expect(opened).toHaveLength(1)
    expect(manager.providerId).toBe('fake')
    expect(manager.available()).toBe(true)
  })

  it('rejects a second session for the same agent key', async () => {
    const { provider } = makeFakeProvider()
    const manager = createBrowserManager({ provider, maxConcurrentTabs: 3 })
    await manager.open('agent-a')
    const error = await manager.open('agent-a').catch((value: unknown) => value)
    expect(errorCodeOf(error)).toBe('BROWSER_ALREADY_OPEN')
    expect(manager.session('agent-a')).toBeDefined()
  })

  it('enforces the concurrent-tab cap across agent keys', async () => {
    const { provider } = makeFakeProvider()
    const manager = createBrowserManager({ provider, maxConcurrentTabs: 2 })
    await manager.open('agent-a')
    await manager.open('agent-b')
    const error = await manager.open('agent-c').catch((value: unknown) => value)
    expect(errorCodeOf(error)).toBe('BROWSER_ALREADY_OPEN')
    expect((error as Error).message).toContain('tab limit')
  })

  it('defaults to a single concurrent tab', async () => {
    const { provider } = makeFakeProvider()
    const manager = createBrowserManager({ provider })
    await manager.open('agent-a')
    const error = await manager.open('agent-b').catch((value: unknown) => value)
    expect(errorCodeOf(error)).toBe('BROWSER_ALREADY_OPEN')
  })

  it('closes one session by key and frees the slot', async () => {
    const { provider, opened } = makeFakeProvider()
    const manager = createBrowserManager({ provider, maxConcurrentTabs: 1 })
    const session = await manager.open('agent-a')
    await manager.close('agent-a')
    expect((session as unknown as { close: ReturnType<typeof vi.fn> }).close).toHaveBeenCalledTimes(1)
    expect(manager.session('agent-a')).toBeUndefined()
    const second = await manager.open('agent-b')
    expect(manager.session('agent-b')).toBe(second)
    expect(opened).toHaveLength(2)
  })

  it('close() is a no-op for unknown keys', async () => {
    const { provider } = makeFakeProvider()
    const manager = createBrowserManager({ provider })
    await manager.close('nobody')
    await manager.close()
  })

  it('closeAll() closes every session (disposal)', async () => {
    const { provider, opened } = makeFakeProvider()
    const manager = createBrowserManager({ provider, maxConcurrentTabs: 3 })
    await manager.open('agent-a')
    await manager.open('agent-b')
    await manager.closeAll()
    expect(manager.session('agent-a')).toBeUndefined()
    expect(manager.session('agent-b')).toBeUndefined()
    for (const session of opened) {
      expect((session as unknown as { close: ReturnType<typeof vi.fn> }).close).toHaveBeenCalledTimes(1)
    }
    // Slots are freed after closeAll.
    await manager.open('agent-c')
  })
})
