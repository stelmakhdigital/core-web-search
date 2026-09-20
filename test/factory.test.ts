import { describe, expect, it } from 'vitest'
import { resolveCoreConfig } from '../src/config.ts'
import { buildEngines, explicitOnlyEngineIds, DEFAULT_BLOCKED_DOMAINS } from '../src/search/engines/factory.ts'
import type { HostAdapter } from '../src/types.ts'

/** A minimal keyless host (no credentials anywhere). */
function makeHost(config = {}): HostAdapter {
  return {
    identity: { name: 'test-host', version: '0.0.0' },
    config,
    paths: { stateDir: '/tmp/web-search-test' },
    credential: async () => undefined,
    registerTools: () => () => undefined,
    toHostError: (error) => error,
  }
}

describe('buildEngines', () => {
  it('builds all 14 known engines', () => {
    const config = resolveCoreConfig({}, '/tmp')
    const engines = buildEngines({ config, host: makeHost(), userAgent: 'test/0.0.0' })
    expect([...engines.keys()].sort()).toEqual([
      'anthropic', 'bing', 'brave', 'ddg', 'deepseek', 'exa', 'gemini', 'jina',
      'ollama', 'openai', 'perplexity', 'searxng', 'tavily', 'xai',
    ])
  })

  it('keyless SERP engines are available; engine ids match their map keys', () => {
    const config = resolveCoreConfig({}, '/tmp')
    const engines = buildEngines({ config, host: makeHost(), userAgent: 'test/0.0.0' })
    for (const [id, engine] of engines) {
      expect(engine.id).toBe(id)
    }
    expect(engines.get('ddg')?.available()).toBe(true)
    expect(engines.get('bing')?.available()).toBe(true)
    expect(engines.get('searxng')?.available()).toBe(true)
    expect(engines.get('ollama')?.available()).toBe(true)
  })

  it('rejects invalid searxng/ollama endpoints at config resolution (fail-fast)', () => {
    expect(() => resolveCoreConfig({ providers: { searxng: { endpoint: 'not-a-url' } } }, '/tmp')).toThrow(
      /providers\.searxng\.endpoint/,
    )
    expect(() => resolveCoreConfig({ providers: { ollama: { endpoint: 'ftp://nope' } } }, '/tmp')).toThrow(
      /providers\.ollama\.endpoint/,
    )
  })

  it('xai is explicitOnly by default; disabling it is allowed', () => {
    const defaultConfig = resolveCoreConfig({}, '/tmp')
    expect(explicitOnlyEngineIds(defaultConfig).has('xai')).toBe(true)
    expect(explicitOnlyEngineIds(defaultConfig).has('ddg')).toBe(false)

    const customConfig = resolveCoreConfig({ providers: { xai: { explicitOnly: false }, perplexity: { explicitOnly: true } } }, '/tmp')
    const explicitOnly = explicitOnlyEngineIds(customConfig)
    expect(explicitOnly.has('xai')).toBe(false)
    expect(explicitOnly.has('perplexity')).toBe(true)
  })

  it('blocked domains default covers search-engine noise', () => {
    expect(DEFAULT_BLOCKED_DOMAINS).toContain('bing.com')
    expect(DEFAULT_BLOCKED_DOMAINS).toContain('duckduckgo.com')
  })
})
