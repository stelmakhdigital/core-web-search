/**
 * GitHub repository → markdown (extended fetch, roadmap 5.3).
 *
 * Strategy (v0.1): **clone instead of scrape**. Repository/tree/file URLs are
 * served from a shallow local clone (`git clone --depth 1 --no-tags`) cached
 * under `<stateDir>/github-clones`; pull-request and issue URLs are served
 * from the keyless GitHub REST API (`api.github.com`, public rate limit).
 *
 * Security: only `github.com` URLs are accepted and `owner`/`repo` are
 * validated against a strict pattern, so the clone command line cannot be
 * injected. Clone directories are name-sanitized; file paths are resolved
 * inside the clone root (no traversal). Clones exceeding `maxCloneBytes` are
 * deleted and rejected with `WEB_FETCH_TOO_LARGE`.
 *
 * v0.1 known limitations (documented): no `commits`/`compare` pages, no PR
 * file diffs, no authenticated access (GITHUB_TOKEN), default-branch
 * resolution for branch names containing `/` (first path segment is used).
 *
 * @module @agents-web-search/core/fetch/github
 */

import { execFile } from 'node:child_process'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

import { CoreError } from '../errors.ts'

const execFileAsync = promisify(execFile)

/** A parsed GitHub URL target. */
export interface GitHubTarget {
  readonly owner: string
  readonly repo: string
  readonly kind: 'repo' | 'tree' | 'blob' | 'pull' | 'issue'
  /** Branch/tag/commit (first path segment; may be `undefined` → default branch). */
  readonly ref?: string
  /** Repository-relative path (tree root or blob path). */
  readonly repoPath?: string
  /** PR/issue number. */
  readonly number?: number
  /** The canonical repository URL. */
  readonly repoUrl: string
}

const NAME_PATTERN = /^[A-Za-z0-9_.-]{1,39}$/
const GITHUB_HOSTS = new Set(['github.com', 'www.github.com'])

/**
 * Parse a GitHub repository URL. Supports `/{owner}/{repo}`,
 * `/tree/{ref}[/path]`, `/blob/{ref}/{path}`, `/pull/{n}`, and `/issues/{n}`.
 * Returns `undefined` for everything else (user profiles, marketplace, …).
 */
export function parseGitHubUrl(rawUrl: string): GitHubTarget | undefined {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return undefined
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
  if (!GITHUB_HOSTS.has(url.hostname)) return undefined

  const segments = url.pathname.split('/').filter(Boolean)
  if (segments.length < 2) return undefined
  const owner = segments[0]!
  const repo = segments[1]!
  if (!NAME_PATTERN.test(owner) || !NAME_PATTERN.test(repo)) return undefined
  const repoUrl = `https://github.com/${owner}/${repo}`
  const rest = segments.slice(2).map((segment) => {
    try {
      return decodeURIComponent(segment)
    } catch {
      return undefined
    }
  })
  if (rest.some((segment) => segment === undefined || /(^|\/)\.\.(\/|$)/.test(segment))) return undefined

  if (rest[0] === 'tree' && rest.length >= 2) {
    return { owner, repo, kind: 'tree', ref: rest[1], repoPath: rest.slice(2).join('/'), repoUrl }
  }
  if (rest[0] === 'blob' && rest.length >= 3) {
    return { owner, repo, kind: 'blob', ref: rest[1], repoPath: rest.slice(2).join('/'), repoUrl }
  }
  if ((rest[0] === 'pull' || rest[0] === 'issues') && rest.length === 2 && /^\d{1,9}$/.test(rest[1]!)) {
    return {
      owner,
      repo,
      kind: rest[0] === 'pull' ? 'pull' : 'issue',
      number: Number(rest[1]),
      repoUrl,
    }
  }
  if (rest.length === 0) return { owner, repo, kind: 'repo', repoUrl }
  return undefined
}

/** Resolved GitHub feature limits. */
export interface GitHubLimits {
  /** Enable GitHub enrichment. */
  readonly enabled: boolean
  /** Maximum clone size (bytes); oversized clones are deleted. */
  readonly maxCloneBytes: number
  /** Maximum tree listing entries. */
  readonly maxTreeEntries: number
  /** Maximum single-file content (bytes). */
  readonly maxFileBytes: number
  /** The clone cache directory (under the host state dir). */
  readonly clonesDir: string
  /** User-Agent for API requests. */
  readonly userAgent: string
  /** Override for the git clone source (tests: local repository paths). */
  readonly sourceResolver?: (t: GitHubTarget) => string
}

/** A tree listing entry. */
export interface TreeEntry {
  readonly name: string
  readonly isDir: boolean
}

/**
 * Fetch the markdown document for a parsed GitHub target.
 * @param target - the parsed URL target.
 * @param limits - the resolved limits.
 * @param sourceResolver - override for the git clone source (tests: local repo).
 * @param signal - abort signal.
 * @returns the markdown document.
 * @throws {CoreError} `WEB_NOT_AVAILABLE` (git missing / API 404 / rate limit detail),
 *   `WEB_FETCH_TOO_LARGE` (clone over cap), `WEB_BAD_REQUEST` (path traversal).
 */
export async function fetchGitHubDocument(
  target: GitHubTarget,
  limits: GitHubLimits,
  signal?: AbortSignal,
): Promise<string> {
  if (target.kind === 'pull' || target.kind === 'issue') {
    const json = await fetchApiJson(
      `https://api.github.com/repos/${target.owner}/${target.repo}/${target.kind === 'pull' ? 'pulls' : 'issues'}/${target.number}`,
      limits,
      signal,
    )
    return target.kind === 'pull' ? buildPullMarkdown(target, json) : buildIssueMarkdown(target, json)
  }

  const cloneDir = await ensureClone(target, limits, signal)
  const root = cloneDir
  switch (target.kind) {
    case 'repo':
      return buildRepoOverview(target, root, limits)
    case 'tree':
      return buildTreeMarkdown(target, root, limits)
    case 'blob':
      return buildFileMarkdown(target, root, limits)
  }
}

/**
 * Ensure a shallow clone exists for the target (cache: one directory per
 * owner/repo/ref). Returns the clone root. `WEB_NOT_AVAILABLE` when the git
 * binary is unavailable; `WEB_FETCH_TOO_LARGE` when the clone exceeds the cap
 * (the clone is deleted).
 */
async function ensureClone(
  target: GitHubTarget,
  limits: GitHubLimits,
  signal: AbortSignal | undefined,
): Promise<string> {
  const refSlug = sanitizeRef(target.ref)
  const dir = path.join(limits.clonesDir, `${target.owner}__${target.repo}${refSlug !== undefined ? `@${refSlug}` : ''}`)
  const { existsSync } = await import('node:fs')
  if (!existsSync(dir)) {
    const source = limits.sourceResolver?.(target) ?? `${target.repoUrl}.git`
    const args = ['clone', '--depth', '1', '--no-tags', '--quiet']
    if (target.ref !== undefined) args.push('--branch', target.ref)
    args.push(source, dir)
    try {
      await execFileAsync('git', args, { timeout: 120_000, signal, maxBuffer: 4 * 1024 * 1024 })
    } catch (error: unknown) {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined)
      const code = errorCodeOf(error)
      if (code === 'ENOENT' || code === 'EACCES') {
        throw new CoreError('git binary is not available on this host; GitHub repository fetch is unavailable', 'WEB_NOT_AVAILABLE', { cause: error })
      }
      await rm(dir, { recursive: true, force: true }).catch(() => undefined)
      throw new CoreError(`git clone failed: ${errorMessage(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
  }
  const size = await directorySize(dir)
  if (size > limits.maxCloneBytes) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    throw new CoreError(`GitHub clone exceeds the maximum size of ${limits.maxCloneBytes} bytes (${size} bytes)`, 'WEB_FETCH_TOO_LARGE')
  }
  return dir
}

/** A keyless GitHub REST API GET (404 → WEB_NOT_AVAILABLE, 403/429 → WEB_QUOTA). */
async function fetchApiJson(url: string, limits: GitHubLimits, signal: AbortSignal | undefined): Promise<Record<string, unknown>> {
  let response: Response
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: { 'user-agent': limits.userAgent, accept: 'application/vnd.github+json' },
      signal,
    })
  } catch (error: unknown) {
    throw new CoreError(`GitHub API request failed: ${errorMessage(error)}`, 'WEB_NETWORK', { cause: error })
  }
  if (response.status === 404) {
    await response.body?.cancel()
    throw new CoreError('GitHub object not found (private or deleted?)', 'WEB_NOT_AVAILABLE')
  }
  if (response.status === 403 || response.status === 429) {
    await response.body?.cancel()
    throw new CoreError('GitHub API rate limit reached (public limit: 60 requests/hour)', 'WEB_QUOTA')
  }
  if (response.status < 200 || response.status >= 300) {
    await response.body?.cancel()
    throw new CoreError(`GitHub API returned HTTP ${response.status}`, 'WEB_HTTP_ERROR')
  }
  return (await response.json()) as Record<string, unknown>
}

/* ------------------------------------------------------------------ render */

/** Build the repository overview: top-level listing + README when present. */
async function buildRepoOverview(target: GitHubTarget, root: string, limits: GitHubLimits): Promise<string> {
  const { readdir } = await import('node:fs/promises')
  const entries = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.name !== '.git')
  const names = entries.map((entry) => entry.name)
  const readmeName = ['README.md', 'readme.md', 'README.rst', 'README', 'README.txt'].find((name) => names.includes(name))
  let readme: string | undefined
  if (readmeName !== undefined) {
    const { readFile } = await import('node:fs/promises')
    readme = (await readFile(path.join(root, readmeName), 'utf-8')).slice(0, 20_000)
  }
  const lines: string[] = [
    `# ${target.owner}/${target.repo} (GitHub repository)`,
    `_${target.repoUrl}_`,
    '',
    '## Contents (top level)',
    '',
    ...names.map((name, i) => `- ${entries[i]!.isDirectory() ? `${name}/` : name}`),
  ]
  if (readme !== undefined && readme.trim().length > 0) {
    lines.push('', '## README', '', readme.trim())
  }
  return lines.join('\n')
}

/** Build a tree listing (recursive, capped, relative paths). */
async function buildTreeMarkdown(target: GitHubTarget, root: string, limits: GitHubLimits): Promise<string> {
  const listingPath = resolveInRoot(root, target.repoPath ?? '')
  const { stat } = await import('node:fs/promises')
  if ((await stat(listingPath)).isFile()) return buildFileMarkdown(target, root, limits)
  const listing = await listTree(listingPath, limits.maxTreeEntries)
  const rel = target.repoPath === undefined || target.repoPath.length === 0 ? '' : `/${target.repoPath}`
  const lines: string[] = [
    `# ${target.owner}/${target.repo}${rel} (tree${target.ref !== undefined ? ` @ ${target.ref}` : ''})`,
    `_${target.repoUrl}${rel !== '' ? rel : ''}_`,
    '',
    ...listing.map((entry) => `- ${entry.isDir ? `${entry.name}/` : entry.name}`),
  ]
  if (listing.length >= limits.maxTreeEntries) lines.push(`- …(listing capped at ${limits.maxTreeEntries} entries)`)
  return lines.join('\n')
}

/** Build a single-file document (capped by `maxFileBytes`). */
async function buildFileMarkdown(target: GitHubTarget, root: string, limits: GitHubLimits): Promise<string> {
  const filePath = resolveInRoot(root, target.repoPath ?? '')
  const { readFile } = await import('node:fs/promises')
  const content = await readFile(filePath, 'utf-8').catch((error: unknown) => {
    throw new CoreError(`file not found in the repository: ${target.repoPath}`, 'WEB_NOT_AVAILABLE', { cause: error })
  })
  const size = Buffer.byteLength(content)
  if (size > limits.maxFileBytes) {
    throw new CoreError(`file exceeds the maximum of ${limits.maxFileBytes} bytes (${size} bytes)`, 'WEB_FETCH_TOO_LARGE')
  }
  const rel = target.repoPath ?? ''
  return `# ${target.owner}/${target.repo}/${rel} (file, ${size} bytes)\n\`\`\`\n${content}\n\`\`\``
}

/** Build a pull-request document from the API JSON. */
export function buildPullMarkdown(target: GitHubTarget, json: Record<string, unknown>): string {
  const title = str(json.title) ?? `#${target.number}`
  const state = str(json.state) ?? 'unknown'
  const user = userLabel(json.user)
  const body = str(json.body)
  const lines: string[] = [
    `# ${target.owner}/${target.repo} PR #${target.number}: ${title} (${state})`,
    `_${target.repoUrl}/pull/${target.number} · opened by ${user}${str(json.created_at) !== undefined ? ` · ${str(json.created_at)}` : ''}_`,
  ]
  if (body !== undefined && body.trim().length > 0) {
    lines.push('', '## Description', '', body.trim())
  }
  return lines.join('\n')
}

/** Build an issue document from the API JSON. */
export function buildIssueMarkdown(target: GitHubTarget, json: Record<string, unknown>): string {
  const title = str(json.title) ?? `#${target.number}`
  const state = str(json.state) ?? 'unknown'
  const user = userLabel(json.user)
  const body = str(json.body)
  const lines: string[] = [
    `# ${target.owner}/${target.repo} issue #${target.number}: ${title} (${state})`,
    `_${target.repoUrl}/issues/${target.number} · opened by ${user}${str(json.created_at) !== undefined ? ` · ${str(json.created_at)}` : ''}_`,
  ]
  if (body !== undefined && body.trim().length > 0) {
    lines.push('', '## Body', '', body.trim())
  }
  return lines.join('\n')
}

/* ------------------------------------------------------------------- utils */

/** Recursively list a directory as entries with root-relative names (capped). */
async function listTree(dir: string, maxEntries: number): Promise<TreeEntry[]> {
  const { readdir, stat } = await import('node:fs/promises')
  const out: TreeEntry[] = []
  const stack: string[] = [dir]
  while (stack.length > 0 && out.length < maxEntries) {
    const current = stack.pop()!
    let entries: import('node:fs').Dirent[]
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.name === '.git') continue
      const isDir = entry.isDirectory()
      const relative = path.relative(dir, path.join(current, entry.name))
      out.push({ name: relative, isDir })
      if (isDir && out.length < maxEntries) stack.push(path.join(current, entry.name))
    }
  }
  return out.slice(0, maxEntries)
}

/** Resolve a repository-relative path strictly inside the clone root. */
function resolveInRoot(root: string, repoPath: string): string {
  if (repoPath.length === 0) return root
  const resolved = path.resolve(root, repoPath)
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new CoreError(`path "${repoPath}" escapes the repository root`, 'WEB_BAD_REQUEST')
  }
  return resolved
}

/** Total size of regular files under a directory. */
async function directorySize(dir: string): Promise<number> {
  const { readdir, stat } = await import('node:fs/promises')
  let total = 0
  const stack: string[] = [dir]
  while (stack.length > 0) {
    const current = stack.pop()!
    let entries: import('node:fs').Dirent[]
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else if (entry.isFile()) total += (await stat(full)).size
    }
  }
  return total
}

/** Sanitize a ref for use in a directory name. */
function sanitizeRef(ref: string | undefined): string | undefined {
  if (ref === undefined) return undefined
  return ref.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 60)
}

/** The `user` field of a GitHub API object → display label. */
function userLabel(value: unknown): string {
  const user = value as { login?: unknown; type?: unknown } | undefined
  if (user !== null && typeof user === 'object' && typeof user.login === 'string' && user.login.length > 0) {
    return user.type === 'Bot' ? `${user.login}[bot]` : user.login
  }
  return 'unknown user'
}

/** A string field or `undefined`. */
function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** A compact one-line error message (safe for CoreError messages). */
function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/** The `code` of an error-like value (node fs/child_process codes). */
function errorCodeOf(error: unknown): string | undefined {
  return (error as { code?: unknown })?.code as string | undefined
}
