import { describe, expect, it } from 'vitest'
import { browserReadiness } from '../src/browser/readiness.ts'

// Real environment (playwright is a dev/optional dependency). The Chromium
// binary may or may not be downloaded on a given machine — the test asserts
// the invariant parts and the hint content for the actual state.
describe('browserReadiness (real environment)', () => {
  it('reports playwright resolvable and a hint consistent with the chromium state', async () => {
    const readiness = await browserReadiness()
    expect(readiness.playwright).toBe(true)
    if (readiness.chromium) {
      expect(readiness.hint).toBeUndefined()
    } else {
      expect(readiness.hint).toContain('playwright install chromium')
    }
  })

  it('never launches a browser or touches the network (returns a plain shape)', async () => {
    const readiness = await browserReadiness()
    expect(Object.keys(readiness).sort()).toEqual(expect.arrayContaining(['chromium', 'playwright']))
    expect(['chromium', 'hint', 'playwright'].sort()).toEqual(Object.keys(readiness).sort())
  })
})
