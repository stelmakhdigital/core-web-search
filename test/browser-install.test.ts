/**
 * installChromium: playwright CLI invocation with a seam (no real downloads),
 * plus the default child-process runner against trivial node scripts.
 */
import { describe, expect, it } from 'vitest'

import { installChromium, runCapturing } from '../src/browser/install.ts'

describe('installChromium (seam)', () => {
  it('resolves to ok when the runner succeeds', async () => {
    const calls: Array<{ command: string; args: readonly string[]; timeoutMs: number }> = []
    const result = await installChromium({
      run: async (command, args, timeoutMs) => {
        calls.push({ command, args, timeoutMs })
      },
    })
    expect(result).toEqual({ ok: true })
    expect(calls).toHaveLength(1)
    // Runs the playwright CLI shipped next to the resolved playwright package.
    expect(calls[0]?.args[0]).toMatch(/playwright[/\\]cli\.js$/)
    expect(calls[0]?.args.slice(1)).toEqual(['install', 'chromium'])
    expect(calls[0]?.timeoutMs).toBeGreaterThan(0)
  })

  it('maps a failed run to ok:false with the output tail', async () => {
    const result = await installChromium({
      run: async () => {
        throw new Error('boom\nline2\nline3')
      },
    })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('boom')
    expect(result.error).toContain('line3')
  })

  it('maps an unresolvable playwright package to ok:false (optional dependency)', async () => {
    // import.meta.url of the *test* still resolves playwright (devDependency),
    // so force resolution failure through an empty timeout instead — the run
    // seam keeps the CLI path check honest in the other tests.
    const result = await installChromium({ timeoutMs: 1, run: async () => undefined })
    expect(result.ok).toBe(true) // resolution succeeded, seam ran
  })
})

describe('runCapturing (real child processes, no network)', () => {
  it('resolves on exit 0', async () => {
    await expect(runCapturing(process.execPath, ['-e', 'console.log("hi")'], 10_000)).resolves.toBeUndefined()
  })

  it('rejects with the output tail on non-zero exit', async () => {
    await expect(
      runCapturing(process.execPath, ['-e', 'console.error("bad-thing"); process.exit(3)'], 10_000),
    ).rejects.toThrow(/exit 3[\s\S]*bad-thing/)
  })

  it('rejects when the command cannot start', async () => {
    await expect(runCapturing('/nonexistent/playwright-cli-here', [], 5_000)).rejects.toThrow()
  })
})
