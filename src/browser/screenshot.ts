/**
 * Screenshot file output for the `browser_screenshot` tool. Screenshots are
 * written to a per-deployment directory (default: `<stateDir>/browser-screenshots`);
 * the directory is created lazily so the default path works out of the box.
 * @module @agents-web-search/core/browser/screenshot
 */

import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Write one PNG screenshot to `dir` (created recursively when absent) and
 * return the file path. The file name is a UUID so concurrent sessions never
 * collide.
 */
export async function writeScreenshot(buffer: Buffer, dir: string): Promise<string> {
  await mkdir(dir, { recursive: true })
  const path = join(dir, `browser-${randomUUID()}.png`)
  await writeFile(path, buffer)
  return path
}
