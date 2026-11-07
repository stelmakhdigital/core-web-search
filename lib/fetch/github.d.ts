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
/** A parsed GitHub URL target. */
export interface GitHubTarget {
    readonly owner: string;
    readonly repo: string;
    readonly kind: 'repo' | 'tree' | 'blob' | 'pull' | 'issue';
    /** Branch/tag/commit (first path segment; may be `undefined` → default branch). */
    readonly ref?: string;
    /** Repository-relative path (tree root or blob path). */
    readonly repoPath?: string;
    /** PR/issue number. */
    readonly number?: number;
    /** The canonical repository URL. */
    readonly repoUrl: string;
}
/**
 * Parse a GitHub repository URL. Supports `/{owner}/{repo}`,
 * `/tree/{ref}[/path]`, `/blob/{ref}/{path}`, `/pull/{n}`, and `/issues/{n}`.
 * Returns `undefined` for everything else (user profiles, marketplace, …).
 */
export declare function parseGitHubUrl(rawUrl: string): GitHubTarget | undefined;
/** Resolved GitHub feature limits. */
export interface GitHubLimits {
    /** Enable GitHub enrichment. */
    readonly enabled: boolean;
    /** Maximum clone size (bytes); oversized clones are deleted. */
    readonly maxCloneBytes: number;
    /** Maximum tree listing entries. */
    readonly maxTreeEntries: number;
    /** Maximum single-file content (bytes). */
    readonly maxFileBytes: number;
    /** The clone cache directory (under the host state dir). */
    readonly clonesDir: string;
    /** User-Agent for API requests. */
    readonly userAgent: string;
    /** Override for the git clone source (tests: local repository paths). */
    readonly sourceResolver?: (t: GitHubTarget) => string;
}
/** A tree listing entry. */
export interface TreeEntry {
    readonly name: string;
    readonly isDir: boolean;
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
export declare function fetchGitHubDocument(target: GitHubTarget, limits: GitHubLimits, signal?: AbortSignal): Promise<string>;
/** Build a pull-request document from the API JSON. */
export declare function buildPullMarkdown(target: GitHubTarget, json: Record<string, unknown>): string;
/** Build an issue document from the API JSON. */
export declare function buildIssueMarkdown(target: GitHubTarget, json: Record<string, unknown>): string;
