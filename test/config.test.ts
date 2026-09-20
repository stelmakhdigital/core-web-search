import { describe, expect, it } from 'vitest'
import { resolveCoreConfig, DEFAULT_ENGINES, KNOWN_ENGINES } from '../src/config.ts'
import { CoreError } from '../src/errors.ts'
import type { CoreConfig } from '../src/types.ts'

describe('resolveCoreConfig', () => {
  it('empty config yields the keyless default stack', () => {
    const config = resolveCoreConfig(undefined, '/tmp/state')
    expect(config.search.engines).toEqual(['ddg', 'bing'])
    expect(DEFAULT_ENGINES).toEqual(['ddg', 'bing'])
    expect(config.search.mode).toBe('fallback')
    expect(config.search.timeoutMs).toBe(30_000)
    expect(config.search.cacheTtlMs).toBe(900_000)
    expect(config.search.enrich.enabled).toBe(true)
    expect(config.fetch.maxBodyBytes).toBe(5 * 1024 * 1024)
    expect(config.fetch.maxOutputChars).toBe(100_000)
    expect(config.fetch.allowPrivateNetworks).toBe(false)
    expect(config.store.path).toBe('/tmp/state/web.db')
    expect(config.ssrf.trustEnvProxy).toBe(false)
    expect(config.browser.enabled).toBe(false)
    expect(config.browser.approval).toBe('navigate')
    expect(config.platforms.enabled).toBe(true)
    expect(config.providers.xai?.explicitOnly).toBe(true)
  })

  it('trailing slash in stateDir is normalized for the default store path', () => {
    const config = resolveCoreConfig({}, '/tmp/state/')
    expect(config.store.path).toBe('/tmp/state/web.db')
  })

  it('rejects an empty engine list', () => {
    expect(() => resolveCoreConfig({ search: { engines: [] } }, '/tmp')).toThrow(CoreError)
  })

  it('rejects unknown engine ids with the known list in the message', () => {
    expect(() => resolveCoreConfig({ search: { engines: ['ddg', 'nope'] } }, '/tmp')).toThrow(
      /unknown engine "nope".*known:.*ddg/,
    )
  })

  it('accepts every known engine id', () => {
    const config = resolveCoreConfig({ search: { engines: [...KNOWN_ENGINES] } }, '/tmp')
    expect(config.search.engines).toHaveLength(KNOWN_ENGINES.length)
  })

  it('rejects invalid resource values', () => {
    expect(() => resolveCoreConfig({ search: { timeoutMs: 0 } }, '/tmp')).toThrow(/search\.timeoutMs/)
    expect(() => resolveCoreConfig({ fetch: { maxRedirects: -1 } }, '/tmp')).toThrow(/fetch\.maxRedirects/)
    expect(() => resolveCoreConfig({ search: { engines: ['searxng'] }, providers: { searxng: { endpoint: 'not-a-url' } } }, '/tmp')).toThrow(/providers\.searxng\.endpoint/)
    expect(() => resolveCoreConfig({ browser: { approval: 'sometimes' } } as unknown as CoreConfig, '/tmp')).toThrow(/browser\.approval/)
    expect(() => resolveCoreConfig({ store: { evictLimits: { maxPages: 0 } } }, '/tmp')).toThrow(/store\.evictLimits\.maxPages/)
  })
})
