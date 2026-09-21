#!/usr/bin/env node
/**
 * Q9 rule: the core has ZERO host/agent imports.
 *
 * Scans every .ts file under the source directory (default: `src`) for
 * quoted import specifiers belonging to agent-specific packages:
 *   - @deepseek-ai/*  (DSH harness packages)
 *   - @earendil-works/*  (Pi packages)
 *   - bare host checkouts ('deepseek-harness/...', 'pi-coding-agent')
 *
 * Comments and prose may mention these names; only quoted specifiers
 * (static import, dynamic import(), or require()) are violations.
 *
 * Usage: node scripts/no-host-imports.mjs [srcDir]
 * Exit code 0 = clean, 1 = violations found (listed).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const FORBIDDEN = [
  /^@deepseek-ai\//,
  /^@earendil-works\//,
  /^deepseek-harness\//,
  /^pi-coding-agent/,
]

/** Quoted specifiers: single or double quoted tokens in import positions. */
const SPECIFIER = /['"]((?:@deepseek-ai|@earendil-works|deepseek-harness|pi-coding-agent)[^'"]*)['"]/g

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) yield* walk(full)
    else if (entry.endsWith('.ts')) yield full
  }
}

const root = path.resolve(process.argv[2] ?? 'src')
const violations = []
let files = 0
for (const file of walk(root)) {
  files += 1
  const source = readFileSync(file, 'utf-8')
  for (const line of source.split('\n')) {
    let match
    SPECIFIER.lastIndex = 0
    while ((match = SPECIFIER.exec(line)) !== null) {
      const specifier = match[1] ?? ''
      if (FORBIDDEN.some((pattern) => pattern.test(specifier))) {
        violations.push(`${path.relative(process.cwd(), file)}: ${specifier}`)
      }
    }
  }
}

if (violations.length > 0) {
  console.error(`no-host-imports: ${violations.length} host import(s) found under ${root} (Q9 violation):`)
  for (const violation of violations) console.error(`  ${violation}`)
  process.exit(1)
}
console.log(`no-host-imports: OK — ${files} file(s) under ${root}, no host imports (Q9).`)
