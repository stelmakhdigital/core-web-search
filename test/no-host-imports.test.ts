import { execFile } from 'node:child_process'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)

const CLEAN = [
  `// A comment may mention host packages — only quoted specifiers count:
// @deepseek-ai/dsh-web-fetch-http and @earendil-works/pi-coding-agent are fine here.
export const x = 1
`,
  `import fs from 'node:fs'
import { somethingElse } from 'cheerio'
export function ok(): string {
  return require ? 'x' : 'y'
}
`,
]

const DIRTY = [
  `import { createWebStack } from '@deepseek-ai/dsh-web-core'
export const stack = createWebStack
`,
  `export async function load() {
  const pi = await import('@earendil-works/pi-coding-agent')
  return pi
}
`,
  `const host = require('deepseek-harness/packages/web')
export default host
`,
]

const tmpDirs: string[] = []

async function runLint(sourceDir: string): Promise<{ code: number; out: string; err: string }> {
  try {
    const { stdout } = await execFileAsync(process.execPath, [path.join(process.cwd(), 'scripts/no-host-imports.mjs'), sourceDir], { cwd: process.cwd() })
    return { code: 0, out: stdout, err: '' }
  } catch (error: unknown) {
    const result = error as { code?: number | null; stdout?: string; stderr?: string }
    return { code: typeof result.code === 'number' ? result.code : 1, out: result.stdout ?? '', err: result.stderr ?? '' }
  }
}

afterEach(async () => {
  for (const dir of tmpDirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

describe('no-host-imports lint (6.1, Q9)', () => {
  it('accepts a clean source tree (the real src/)', async () => {
    const result = await runLint(path.join(process.cwd(), 'src'))
    expect(result.code).toBe(0)
    expect(result.out).toContain('no-host-imports: OK')
    expect(result.out).toContain('no host imports')
  })

  it('accepts comments that mention host package names', async () => {
    const dir = path.join(tmpdir(), `wsh-lint-clean-${Math.random().toString(16).slice(2)}`)
    tmpDirs.push(dir)
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, 'a.ts'), CLEAN[0]!)
    const result = await runLint(dir)
    expect(result.code).toBe(0)
  })

  it('rejects a quoted @deepseek-ai/* specifier', async () => {
    const dir = path.join(tmpdir(), `wsh-lint-dsh-${Math.random().toString(16).slice(2)}`)
    tmpDirs.push(dir)
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, 'bad.ts'), DIRTY[0]!)
    const result = await runLint(dir)
    expect(result.code).toBe(1)
    expect(result.err).toContain('Q9 violation')
    expect(result.err).toContain('bad.ts')
    expect(result.err).toContain('@deepseek-ai/dsh-web-core')
  })

  it('rejects a dynamic import() of an @earendil-works/* package', async () => {
    const dir = path.join(tmpdir(), `wsh-lint-pi-${Math.random().toString(16).slice(2)}`)
    tmpDirs.push(dir)
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, 'bad.ts'), DIRTY[1]!)
    const result = await runLint(dir)
    expect(result.code).toBe(1)
    expect(result.err).toContain('@earendil-works/pi-coding-agent')
  })

  it('rejects a require() of a host checkout path', async () => {
    const dir = path.join(tmpdir(), `wsh-lint-path-${Math.random().toString(16).slice(2)}`)
    tmpDirs.push(dir)
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, 'bad.ts'), DIRTY[2]!)
    const result = await runLint(dir)
    expect(result.code).toBe(1)
    expect(result.err).toContain('deepseek-harness/packages/web')
  })

  it('fails on a missing source directory', async () => {
    const result = await runLint(path.join(tmpdir(), 'definitely-missing-wsh-lint'))
    expect(result.code).toBe(1)
  })
})
