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
    readonly videoId: string;
    /** The canonical watch URL (used for oEmbed and display). */
    readonly watchUrl: string;
}
/**
 * Parse a YouTube watch URL into a video target, or `undefined` when the URL
 * is not a video page (channel/about/playlist pages, non-YouTube hosts).
 * Supported shapes: `/watch?v=ID` (any extra query params), `/embed/ID`,
 * `/shorts/ID`, `/live/ID`, `/v/ID`, and `youtu.be/ID`.
 */
export declare function parseVideoUrl(rawUrl: string): VideoTarget | undefined;
/** The oEmbed fields the pipeline consumes. */
export interface VideoOEmbed {
    readonly title: string;
    readonly authorName: string;
    readonly thumbnailUrl?: string;
}
/** The raw stage results (all optional — the caller decides on failure). */
export interface VideoStages {
    readonly oembed?: VideoOEmbed;
    readonly description?: string;
    /** The transcript as `[MM:SS] line` paragraphs, or `undefined` when none. */
    readonly transcript?: string;
}
/**
 * Compose the markdown document from the successful stages.
 * @returns the markdown, or `undefined` when no stage succeeded (the caller
 *   rejects with `WEB_NOT_AVAILABLE`).
 */
export declare function buildVideoDocument(stages: VideoStages, watchUrl: string): string | undefined;
/**
 * Convert a WebVTT transcript to `[MM:SS] text` lines (cue text joined by
 * spaces, cue numbering and tags stripped). Tolerates a missing `WEBVTT`
 * header and CRLF line endings.
 */
export declare function vttToTranscript(vtt: string): string;
/** Minimal HTML entity unescape for `<meta content="…">` values. */
export declare function unescapeHtmlEntities(value: string): string;
/** The oEmbed JSON shape YouTube returns. */
export interface OEmbedJson {
    readonly title?: string;
    readonly author_name?: string;
    readonly thumbnail_url?: string;
}
/** Parse + validate an oEmbed response body into {@link VideoOEmbed}. */
export declare function parseOEmbed(json: OEmbedJson): VideoOEmbed | undefined;
/**
 * Extract the meta description from a watch page HTML.
 * Prefers `meta[name="description"]`, falls back to `meta[property="og:description"]`
 * (attribute order independent). Returns `undefined` when neither is present.
 */
export declare function extractMetaDescription(html: string): string | undefined;
