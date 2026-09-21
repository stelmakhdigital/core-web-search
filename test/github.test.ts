import { execFile } from 'node:child_process'
import { mkdir, writeFile, rm, readdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  buildIssueMarkdown,
  buildPullMarkdown,
  fetchGitHubDocument,
  parseGitHubUrl,
  type GitHubTarget,
} from '../src/fetch/github.ts'
import { CachedHttpFetchProvider } from '../src/fetch/provider.ts'
import { normalizeUrl } from '../src/fetch/url.ts'
import { WebStore } from '../src/store/index.ts'
import { resolveCoreConfig } from '../src/config.ts'

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async () => [{ address: '93.184.215.14', family: 4 }]),
}))

const execFileAsync = promisify(execFile)

describe('parseGitHubUrl (5.3)', () => {
  it('parses the supported URL shapes', () => {
    const cases: Array<[string, Partial<GitHubTarget>]> = [
      ['https://github.com/owner/repo', { kind: 'repo', owner: 'owner', repo: 'repo' }],
      ['https://github.com/owner/repo/tree/main', { kind: 'tree', ref: 'main', repoPath: '' }],
      ['https://github.com/owner/repo/tree/main/docs/guide.md', { kind: 'tree', ref: 'main', repoPath: 'docs/guide.md' }],
      ['https://github.com/owner/repo/blob/v1.0/src/app.ts', { kind: 'blob', ref: 'v1.0', repoPath: 'src/app.ts' }],
      ['https://github.com/owner/repo/pull/42', { kind: 'pull', number: 42 }],
      ['https://github.com/owner/repo/issues/7', { kind: 'issue', number: 7 }],
      ['https://www.github.com/owner/repo', { kind: 'repo', owner: 'owner', repo: 'repo' }],
    ]
    for (const [url, expected] of cases) {
      const target = parseGitHubUrl(url)
      expect(target, url).toBeDefined()
      expect(target).toMatchObject(expected)
      expect(target?.repoUrl).toBe('https://github.com/owner/repo')
    }
  })

  it('rejects non-repository URLs and malformed segments', () => {
    const cases = [
      'https://github.com/owner',
      'https://github.com/owner/repo/blob/main',
      'https://github.com/owner/repo/pull/abc',
      'https://github.com/owner/repo/pull/123/files',
      'https://github.com/bad!owner/repo',
      'https://gitlab.com/owner/repo',
      'https://github.com/owner/repo/commits/main',
      'file:///tmp/repo',
      'not a url',
    ]
    for (const url of cases) {
      expect(parseGitHubUrl(url), url).toBeUndefined()
    }
  })
})

describe('buildPullMarkdown / buildIssueMarkdown (5.3)', () => {
  const pull: GitHubTarget = {
    owner: 'o',
    repo: 'r',
    kind: 'pull',
    number: 42,
    repoUrl: 'https://github.com/o/r',
  }
  const issue: GitHubTarget = {
    owner: 'o',
    repo: 'r',
    kind: 'issue',
    number: 7,
    repoUrl: 'https://github.com/o/r',
  }

  it('renders a PR with title, state, user, and body', () => {
    const md = buildPullMarkdown(pull, {
      title: 'Add feature',
      state: 'open',
      user: { login: 'dev', type: 'User' },
      body: 'The body.',
      created_at: '2026-09-21T10:00:00Z',
    })
    expect(md).toContain('PR #42: Add feature (open)')
    expect(md).toContain('opened by dev')
    expect(md).toContain('## Description')
    expect(md).toContain('The body.')
  })

  it('renders a bot user and a body-less issue', () => {
    const md = buildIssueMarkdown(issue, {
      title: 'Bug',
      state: 'closed',
      user: { login: 'ci', type: 'Bot' },
      body: '',
    })
    expect(md).toContain('issue #7: Bug (closed)')
    expect(md).toContain('opened by ci[bot]')
    expect(md).not.toContain('## Body')
  })
})

describe('fetchGitHubDocument + provider integration (5.3)', () => {
  let repoDir: string
  let clonesDir: string
  let branch: string

  async function git(dir: string, ...args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', ['-C', dir, ...args])
    return stdout.trim()
  }

  beforeEach(async () => {
    repoDir = path.join(tmpdir(), `web-search-git-test-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    clonesDir = path.join(repoDir, 'clones')
    await mkdir(repoDir, { recursive: true })
    await mkdir(clonesDir, { recursive: true })
    await git(repoDir, 'init', '-q')
    await git(repoDir, 'checkout', '-q', '-b', 'main')
    await writeFile(path.join(repoDir, 'README.md'), '# Fixture repo\n\nThe readme body.\n')
    await mkdir(path.join(repoDir, 'docs'), { recursive: true })
    await writeFile(path.join(repoDir, 'docs/guide.md'), 'Guide content here.\n')
    await mkdir(path.join(repoDir, 'src'), { recursive: true })
    await writeFile(path.join(repoDir, 'src/app.ts'), 'export const app = true\n')
    await git(repoDir, '-c', 'user.email=t@t.t', '-c', 'user.name=t', 'add', '-A')
    await git(repoDir, '-c', 'user.email=t@t.t', '-c', 'user.name=t', 'commit', '-q', '-m', 'fixture')
    branch = await git(repoDir, 'rev-parse', '--abbrev-ref', 'HEAD')
  })

  afterEach(async () => {
    await rm(repoDir, { recursive: true, force: true })
  })

  function limits(overrides: Partial<Parameters<typeof fetchGitHubDocument>[1]> = {}) {
    return {
      enabled: true,
      maxCloneBytes: 10 * 1024 * 1024,
      maxTreeEntries: 500,
      maxFileBytes: 1024 * 1024,
      clonesDir,
      userAgent: 'test',
      sourceResolver: () => repoDir,
      ...overrides,
    }
  }

  it('serves the repository overview (README + top-level listing)', async () => {
    const target = parseGitHubUrl('https://github.com/owner/repo')!
    const doc = await fetchGitHubDocument(target, limits())
    expect(doc).toContain('# owner/repo (GitHub repository)')
    expect(doc).toContain('- README.md')
    expect(doc).toContain('- docs/')
    expect(doc).toContain('## README')
    expect(doc).toContain('The readme body.')
    // The clone is cached for reuse.
    const entries = await readdir(clonesDir)
    expect(entries).toHaveLength(1)
  })

  it('serves tree listings with relative paths', async () => {
    const target = parseGitHubUrl(`https://github.com/owner/repo/tree/${branch}`)!
    const doc = await fetchGitHubDocument(target, limits())
    expect(doc).toContain('# owner/repo (tree @ main)')
    expect(doc).toContain('- docs/')
    expect(doc).toContain('- src/')
    expect(doc).toContain('- src/app.ts')
    expect(doc).toContain('- docs/guide.md')
  })

  it('serves file contents for blob URLs', async () => {
    const target = parseGitHubUrl(`https://github.com/owner/repo/blob/${branch}/docs/guide.md`)!
    const doc = await fetchGitHubDocument(target, limits())
    expect(doc).toContain('# owner/repo/docs/guide.md (file,')
    expect(doc).toContain('Guide content here.')
  })

  it('rejects path traversal with WEB_BAD_REQUEST', async () => {
    const target = parseGitHubUrl(`https://github.com/owner/repo/blob/${branch}/../../etc/passwd`)
    if (target !== undefined) {
      await expect(fetchGitHubDocument(target, limits())).rejects.toMatchObject({ code: 'WEB_BAD_REQUEST' })
    } else {
      // The parser may normalize the URL — either way, traversal never reads the file.
      expect(parseGitHubUrl(`https://github.com/owner/repo/blob/${branch}/..%2F..%2Fetc%2Fpasswd`)).toBeUndefined()
    }
  })

  it('serves PRs from the (mocked) keyless API', async () => {
    const fetchMock = vi.fn(async (input: string) => {
      expect(input).toContain('api.github.com/repos/owner/repo/pulls/42')
      return new Response(JSON.stringify({ title: 'API PR', state: 'open', user: { login: 'x', type: 'User' }, body: 'b' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      const target = parseGitHubUrl('https://github.com/owner/repo/pull/42')!
      const doc = await fetchGitHubDocument(target, limits())
      expect(doc).toContain('PR #42: API PR (open)')
      expect(doc).toContain('opened by x')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('maps API rate limits to WEB_QUOTA and 404 to WEB_NOT_AVAILABLE', async () => {
    const target = parseGitHubUrl('https://github.com/owner/repo/issues/7')!
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('rate limited', { status: 429 })),
    )
    await expect(fetchGitHubDocument(target, limits())).rejects.toMatchObject({ code: 'WEB_QUOTA' })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 404 })),
    )
    await expect(fetchGitHubDocument(target, limits())).rejects.toMatchObject({ code: 'WEB_NOT_AVAILABLE' })
    vi.unstubAllGlobals()
  })

  it('serves a /tree/ URL whose path is a file (tree→file fallback)', async () => {
    const target = parseGitHubUrl(`https://github.com/owner/repo/tree/${branch}/docs/guide.md`)!
    expect(target).toMatchObject({ kind: 'tree', repoPath: 'docs/guide.md' })
    const doc = await fetchGitHubDocument(target, limits())
    expect(doc).toContain('# owner/repo/docs/guide.md (file,')
    expect(doc).toContain('Guide content here.')
  })

  it('caps a tree listing at maxTreeEntries (with a note)', async () => {
    const target = parseGitHubUrl(`https://github.com/owner/repo/tree/${branch}`)!
    const doc = await fetchGitHubDocument(target, limits({ maxTreeEntries: 2 }))
    expect(doc).toContain('listing capped at 2 entries')
    // Only two entries (plus the cap note) are listed.
    const entryLines = doc.split('\n').filter((line) => line.startsWith('- ')).filter((line) => !line.includes('capped'))
    expect(entryLines).toHaveLength(2)
  })

  it('rejects a blob for a missing file with WEB_NOT_AVAILABLE', async () => {
    const target = parseGitHubUrl(`https://github.com/owner/repo/blob/${branch}/nope/absent.md`)!
    await expect(fetchGitHubDocument(target, limits())).rejects.toMatchObject({ code: 'WEB_NOT_AVAILABLE' })
  })

  it('rejects files larger than maxFileBytes with WEB_FETCH_TOO_LARGE', async () => {
    const target = parseGitHubUrl(`https://github.com/owner/repo/blob/${branch}/src/app.ts`)!
    await expect(fetchGitHubDocument(target, limits({ maxFileBytes: 10 }))).rejects.toMatchObject({
      code: 'WEB_FETCH_TOO_LARGE',
    })
  })

  it('maps a 403 to WEB_QUOTA and a transport failure to WEB_NETWORK', async () => {
    const target = parseGitHubUrl('https://github.com/owner/repo/pull/1')!
    vi.stubGlobal('fetch', vi.fn(async () => new Response('forbidden', { status: 403 })))
    await expect(fetchGitHubDocument(target, limits())).rejects.toMatchObject({ code: 'WEB_QUOTA' })
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('fetch failed'))))
    await expect(fetchGitHubDocument(target, limits())).rejects.toMatchObject({ code: 'WEB_NETWORK' })
    vi.unstubAllGlobals()
  })

  it('deletes and rejects clones that exceed maxCloneBytes', async () => {
    const bigDir = path.join(repoDir, 'big')
    await mkdir(bigDir, { recursive: true })
    await writeFile(path.join(bigDir, 'big.bin'), Buffer.alloc(2_000_000, 1))
    await git(bigDir, 'init', '-q')
    await git(bigDir, 'checkout', '-q', '-b', 'main')
    await writeFile(path.join(bigDir, 'big.bin'), Buffer.alloc(2_000_000, 1))
    await git(bigDir, '-c', 'user.email=t@t.t', '-c', 'user.name=t', 'add', '-A')
    await git(bigDir, '-c', 'user.email=t@t.t', '-c', 'user.name=t', 'commit', '-q', '-m', 'big')
    const target = parseGitHubUrl('https://github.com/owner/big')!
    await expect(
      fetchGitHubDocument(target, limits({ sourceResolver: () => bigDir, maxCloneBytes: 1_000_000 })),
    ).rejects.toMatchObject({ code: 'WEB_FETCH_TOO_LARGE' })
    const entries = await readdir(clonesDir)
    expect(entries.filter((entry) => entry.includes('owner__big'))).toHaveLength(0)
  })

  it('provider: a github URL is served from the pipeline and cached as text', async () => {
    const store = new WebStore({ path: ':memory:' })
    const provider = new CachedHttpFetchProvider({
      maxUrlLength: 2048,
      maxResponseBytes: 5_000_000,
      maxBodyChars: 100_000,
      timeoutMs: 10_000,
      maxRedirects: 5,
      userAgent: 'test',
      cacheTtlMs: 60_000,
      store,
      revalidate: true,
      allowPrivateNetworks: false,
      pdf: { enabled: true, maxSizeBytes: 2_000_000, maxPages: 5 },
      video: { enabled: true },
      github: {
        enabled: true,
        maxCloneBytes: 10 * 1024 * 1024,
        maxTreeEntries: 500,
        maxFileBytes: 1024 * 1024,
        clonesDir,
        sourceResolver: () => repoDir,
      },
    })
    const result = await provider.fetch({ url: 'https://github.com/owner/repo' })
    expect(result.body.kind).toBe('text')
    expect(result.body.content).toContain('# owner/repo (GitHub repository)')
    const cached = await store.readPage(normalizeUrl('https://github.com/owner/repo'))
    expect(cached?.bodyKind).toBe('text')
    const again = await provider.fetch({ url: 'https://github.com/owner/repo' })
    expect(again.fromCache).toBe(true)
    expect(again.body.content).toBe(result.body.content)
    await store.close()
  })
})

describe('resolveCoreConfig fetch.github (5.3)', () => {
  it('defaults enabled with 200MiB / 500 entries', () => {
    const config = resolveCoreConfig(undefined, '/tmp/state')
    expect(config.fetch.github).toEqual({ enabled: true, maxCloneBytes: 200 * 1024 * 1024, maxTreeEntries: 500 })
  })

  it('accepts custom values and rejects invalid ones', () => {
    const config = resolveCoreConfig({ fetch: { github: { enabled: false, maxCloneBytes: 1000, maxTreeEntries: 10 } } }, '/tmp')
    expect(config.fetch.github).toEqual({ enabled: false, maxCloneBytes: 1000, maxTreeEntries: 10 })
    expect(() => resolveCoreConfig({ fetch: { github: { maxTreeEntries: 0 } } }, '/tmp')).toThrow(/fetch\.github\.maxTreeEntries/)
  })
})
