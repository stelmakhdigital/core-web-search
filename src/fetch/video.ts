/**
 * YouTube video → markdown (extended fetch, roadmap 5.2, v0.1 scope).
 *
 * Everything here is keyless and agent-agnostic (Q9): the pipeline composes
 * the public YouTube surfaces —
 *   1. oEmbed (`https://www.youtube.com/oembed`) — title / author / thumbnail,
 *   2. the watch page `meta description`,
 *   3. the public transcript endpoint (`/api/timedtext`) — manual captions,
 *      then ASR (`kind=asr`),
 * into one markdown document that flows through the regular fetch pipeline
 * (byte/char caps, `text` page cache, `web_fetch` `question` mode via
 * `HostAdapter.llm` — a fetched video is just a document to the LLM).
 *
 * Each stage fails independently (fallback chains): the document carries
 * whatever stages succeeded; only when ALL of them fail does the provider
 * reject with `WEB_NOT_AVAILABLE`. `youtu.be/<id>` short links are parsed
 * but resolved by following their redirect (the provider's redirect loop).
 *
 * v0.1 known limitations (documented): local video files, frame extraction
 * via ffmpeg, and Gemini/Datalab video understanding are out of scope —
 * they need a binary runtime or a multimodal LLM channel the core contract
 * does not carry.
 *
 * @module @agents-web-search/core/fetch/video
 */

/** A parsed YouTube video target. */
export interface VideoTarget {
  /** The 11-character video id. */
  readonly videoId: string
  /** The canonical watch URL (used for oEmbed and display). */
  readonly watchUrl: string
}

const VIDEO_HOSTS = new Set(['www.youtube.com', 'm.youtube.com', 'youtube.com'])
const ID_PATTERN = /^[A-Za-z0-9_-]{11}$/

/**
 * Parse a YouTube watch URL into a video target, or `undefined` when the URL
 * is not a video page (channel/about/playlist pages, non-YouTube hosts).
 * Supported shapes: `/watch?v=ID` (any extra query params), `/embed/ID`,
 * `/shorts/ID`, `/live/ID`, `/v/ID`, and `youtu.be/ID`.
 */
export function parseVideoUrl(rawUrl: string): VideoTarget | undefined {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return undefined
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined

  let id: string | null = null
  if (VIDEO_HOSTS.has(url.hostname)) {
    const queryId = url.searchParams.get('v')
    if (url.pathname === '/watch' && queryId !== null) {
      id = queryId
    } else {
      const match = /^\/(embed|shorts|live|v)\/([^/?#]+)/.exec(url.pathname)
      if (match?.[2] !== undefined) id = match[2]
    }
  } else if (url.hostname === 'youtu.be') {
    id = url.pathname.split('/')[1] ?? null
  }
  if (id === null || !ID_PATTERN.test(id)) return undefined

  return { videoId: id, watchUrl: `https://www.youtube.com/watch?v=${id}` }
}

/** The oEmbed fields the pipeline consumes. */
export interface VideoOEmbed {
  readonly title: string
  readonly authorName: string
  readonly thumbnailUrl?: string
}

/** The raw stage results (all optional — the caller decides on failure). */
export interface VideoStages {
  readonly oembed?: VideoOEmbed
  readonly description?: string
  /** The transcript as `[MM:SS] line` paragraphs, or `undefined` when none. */
  readonly transcript?: string
}

/**
 * Compose the markdown document from the successful stages.
 * @returns the markdown, or `undefined` when no stage succeeded (the caller
 *   rejects with `WEB_NOT_AVAILABLE`).
 */
export function buildVideoDocument(stages: VideoStages, watchUrl: string): string | undefined {
  if (stages.oembed === undefined && stages.description === undefined && stages.transcript === undefined) {
    return undefined
  }
  const lines: string[] = []
  lines.push(`# ${stages.oembed?.title ?? 'YouTube video'} (video)`)
  const meta: string[] = []
  if (stages.oembed?.authorName !== undefined) meta.push(`by ${stages.oembed.authorName}`)
  meta.push(watchUrl)
  if (stages.oembed?.thumbnailUrl !== undefined) meta.push(`thumbnail: ${stages.oembed.thumbnailUrl}`)
  lines.push(`_${meta.join(' · ')}_`)
  if (stages.description !== undefined && stages.description.trim().length > 0) {
    lines.push('## Description', '', stages.description.trim())
  }
  if (stages.transcript !== undefined && stages.transcript.trim().length > 0) {
    lines.push('## Transcript', '', stages.transcript.trim())
  }
  return lines.join('\n')
}

/**
 * Convert a WebVTT transcript to `[MM:SS] text` lines (cue text joined by
 * spaces, cue numbering and tags stripped). Tolerates a missing `WEBVTT`
 * header and CRLF line endings.
 */
export function vttToTranscript(vtt: string): string {
  const normalized = vtt.replace(/\r\n?/g, '\n')
  const cues = normalized.split(/\n\n+/)
  const out: string[] = []
  for (const cue of cues) {
    const cueLines = cue.split('\n')
    const timeIndex = cueLines.findIndex((line) => CUE_TIME_PATTERN.test(line))
    if (timeIndex === -1) continue
    const match = CUE_TIME_PATTERN.exec(cueLines[timeIndex]!)!
    const text = cueLines
      .slice(timeIndex + 1)
      .map((line) => line.replace(HTML_TAG_PATTERN, '').trim())
      .filter((line) => line.length > 0)
      .join(' ')
    if (text.length === 0) continue
    out.push(`[${formatTimestamp(match[1], match[2], match[3])}] ${text}`)
  }
  return out.join('\n')
}

const CUE_TIME_PATTERN = /^(?:(\d{1,2}):)?(\d{2}):(\d{2})\.\d{3}/
const HTML_TAG_PATTERN = /<[^>]+>/g

/** `HH:MM:SS` parts → `[HH:]MM:SS` (zero hours are omitted). */
function formatTimestamp(hours: string | undefined, minutes: string | undefined, seconds: string | undefined): string {
  if (hours !== undefined && hours !== '00' && minutes !== undefined && seconds !== undefined) return `${hours}:${minutes}:${seconds}`
  return `${minutes ?? '00'}:${seconds ?? '00'}`
}

/** Minimal HTML entity unescape for `<meta content="…">` values. */
export function unescapeHtmlEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d{3,5});/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/** The oEmbed JSON shape YouTube returns. */
export interface OEmbedJson {
  readonly title?: string
  readonly author_name?: string
  readonly thumbnail_url?: string
}

/** Parse + validate an oEmbed response body into {@link VideoOEmbed}. */
export function parseOEmbed(json: OEmbedJson): VideoOEmbed | undefined {
  if (typeof json.title !== 'string' || json.title.trim().length === 0) return undefined
  return {
    title: json.title.trim(),
    authorName: typeof json.author_name === 'string' && json.author_name.trim().length > 0 ? json.author_name.trim() : 'unknown author',
    ...(typeof json.thumbnail_url === 'string' && json.thumbnail_url.length > 0 ? { thumbnailUrl: json.thumbnail_url } : {}),
  }
}

/**
 * Extract the meta description from a watch page HTML.
 * Prefers `meta[name="description"]`, falls back to `meta[property="og:description"]`
 * (attribute order independent). Returns `undefined` when neither is present.
 */
export function extractMetaDescription(html: string): string | undefined {
  const tags = html.match(META_TAG_PATTERN) ?? []
  for (const tag of tags) {
    const name = META_NAME_PATTERN.exec(tag)?.[1]
    const content = META_CONTENT_PATTERN.exec(tag)?.[1]
    if (content === undefined) continue
    if (name === 'description') return unescapeHtmlEntities(content).trim() || undefined
  }
  for (const tag of tags) {
    const name = META_NAME_PATTERN.exec(tag)?.[1]
    const content = META_CONTENT_PATTERN.exec(tag)?.[1]
    if (name === 'og:description' && content !== undefined) {
      const value = unescapeHtmlEntities(content).trim()
      if (value.length > 0) return value
    }
  }
  return undefined
}

const META_TAG_PATTERN = /<meta\b[^>]*>/gi
const META_NAME_PATTERN = /(?:name|property)\s*=\s*["']([^"']+)["']/i
const META_CONTENT_PATTERN = /content\s*=\s*["']([^"']*)["']/i
