/**
 * One-shot Chromium download for hosts with `browser.autoDownload`: runs the
 * playwright CLI (`playwright install chromium`) as a child process. This is
 * the only part of browser setup a plugin may automate — it writes solely
 * under the user's browser cache, needs no privileges, and is idempotent.
 * System libraries (libnss3, …) are deliberately NOT installed here: they
 * require root, and readiness hints carry the distro-specific command instead.
 * @module @agents-web-search/core/browser/install
 */

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

/** Result of {@link installChromium}. */
export interface InstallChromiumResult {
  readonly ok: boolean
  /** Tail of the CLI output on failure (already bounded, safe for a notice). */
  readonly error?: string
}

/** Test seam: replace the child-process runner (never spawns in tests). */
export interface InstallChromiumDeps {
  readonly run?: (command: string, args: readonly string[], timeoutMs: number) => Promise<void>
  readonly timeoutMs?: number
}

/** Run a command, rejecting with the output tail on failure. Exported for
 * tests; it is the default runner of {@link installChromium}. */
export function runCapturing(command: string, args: readonly string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    let tail = ''
    const keep = (chunk: Buffer | string): void => {
      tail = (tail + String(chunk)).slice(-2_000)
    }
    child.stdout?.on('data', keep)
    child.stderr?.on('data', keep)
    child.once('error', (error) => reject(new Error(`${error.message}\n${tail}`)))
    child.once('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`exit ${String(code)}\n${tail}`))
    })
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    timer.unref()
  })
}

/**
 * Download the Chromium binary through the locally installed playwright CLI
 * (resolved next to the playwright package the core imports). Non-blocking
 * for the caller — hosts fire this in the background and report the result.
 * Never installs system libraries; failure text is user-actionable.
 */
export async function installChromium(deps: InstallChromiumDeps = {}): Promise<InstallChromiumResult> {
  const timeoutMs = deps.timeoutMs ?? 15 * 60_000
  try {
    const req = createRequire(import.meta.url)
    const cli = join(dirname(req.resolve('playwright/package.json')), 'cli.js')
    const run = deps.run ?? runCapturing
    await run(process.execPath, [cli, 'install', 'chromium'], timeoutMs)
    return { ok: true }
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error)
    return { ok: false, error: text.split('\n').slice(-6).join('\n') }
  }
}
