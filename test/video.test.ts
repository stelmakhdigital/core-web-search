import { describe, expect, it } from 'vitest'

import {
  buildVideoDocument,
  extractMetaDescription,
  parseOEmbed,
  parseVideoUrl,
  unescapeHtmlEntities,
  vttToTranscript,
} from '../src/fetch/video.ts'

describe('parseVideoUrl (5.2)', () => {
  it('parses the supported watch URL shapes', () => {
    const id = 'dQw4w9WgXcQ'
    const cases = [
      `https://www.youtube.com/watch?v=${id}`,
      `https://www.youtube.com/watch?v=${id}&t=42s`,
      `https://m.youtube.com/watch?v=${id}`,
      `https://youtube.com/embed/${id}`,
      `https://www.youtube.com/shorts/${id}`,
      `https://www.youtube.com/live/${id}`,
      `https://www.youtube.com/v/${id}`,
      `https://youtu.be/${id}`,
    ]
    for (const url of cases) {
      const target = parseVideoUrl(url)
      expect(target, url).toEqual({ videoId: id, watchUrl: `https://www.youtube.com/watch?v=${id}` })
    }
  })

  it('rejects non-video and malformed URLs', () => {
    const cases = [
      'https://www.youtube.com/@channel',
      'https://www.youtube.com/watch',
      'https://www.youtube.com/watch?x=abc',
      'https://www.youtube.com/playlist?list=PL123',
      'https://youtu.be/too-short',
      'https://example.com/watch?v=dQw4w9WgXcQ',
      'https://www.youtube.com/watch?v=short!id',
      'file:///tmp/video.mp4',
      'not a url',
    ]
    for (const url of cases) {
      expect(parseVideoUrl(url), url).toBeUndefined()
    }
  })
})

describe('vttToTranscript (5.2)', () => {
  it('converts cues to [MM:SS] lines (text joined, tags stripped)', () => {
    const vtt = [
      'WEBVTT',
      '',
      '00:00:01.280 --> 00:00:04.000',
      'line one',
      '<c>line two</c>',
      '',
      '00:01:05.500 --> 00:01:08.000',
      'second minute',
      '',
    ].join('\n')
    expect(vttToTranscript(vtt)).toBe('[00:01] line one line two\n[01:05] second minute')
  })

  it('keeps hours when present and tolerates CRLF + missing header', () => {
    const vtt = '01:02:03.000 --> 01:02:04.000\ncue with hours\r\n\r\n00:00:01.000 --> 00:00:02.000\nplain cue'
    const result = vttToTranscript(vtt)
    expect(result).toBe('[01:02:03] cue with hours\n[00:01] plain cue')
  })

  it('returns an empty string for headerless junk', () => {
    expect(vttToTranscript('WEBVTT\n\n')).toBe('')
  })
})

describe('buildVideoDocument (5.2)', () => {
  const full = {
    oembed: { title: 'Test Video', authorName: 'Test Author', thumbnailUrl: 'https://i.ytimg.com/vi/x/hqdefault.jpg' },
    description: 'The description.',
    transcript: '[00:01] hello',
  }

  it('composes title, meta, description, and transcript', () => {
    const doc = buildVideoDocument(full, 'https://www.youtube.com/watch?v=abcde12345F')
    expect(doc).toContain('# Test Video (video)')
    expect(doc).toContain('by Test Author')
    expect(doc).toContain('https://www.youtube.com/watch?v=abcde12345F')
    expect(doc).toContain('thumbnail: https://i.ytimg.com/vi/x/hqdefault.jpg')
    expect(doc).toContain('## Description')
    expect(doc).toContain('The description.')
    expect(doc).toContain('## Transcript')
    expect(doc).toContain('[00:01] hello')
  })

  it('degrades gracefully with partial stages', () => {
    const doc = buildVideoDocument({ transcript: '[00:01] only transcript' }, 'https://www.youtube.com/watch?v=x')
    expect(doc).toContain('# YouTube video (video)')
    expect(doc).toContain('## Transcript')
    expect(doc).not.toContain('## Description')
  })

  it('returns undefined when no stage succeeded', () => {
    expect(buildVideoDocument({}, 'https://www.youtube.com/watch?v=x')).toBeUndefined()
  })
})

describe('extractMetaDescription (5.2)', () => {
  it('prefers name=description and unescapes entities', () => {
    const html = '<html><head><meta name="description" content="A &amp; B — &quot;quoted&quot;"></head></html>'
    expect(extractMetaDescription(html)).toBe('A & B — "quoted"')
  })

  it('handles reversed attribute order', () => {
    const html = '<meta content="reversed" name="description">'
    expect(extractMetaDescription(html)).toBe('reversed')
  })

  it('falls back to og:description', () => {
    const html = '<meta property="og:description" content="og fallback">'
    expect(extractMetaDescription(html)).toBe('og fallback')
  })

  it('returns undefined when no description meta exists', () => {
    expect(extractMetaDescription('<html><head><meta name="viewport" content="width=device-width"></head></html>')).toBeUndefined()
  })
})

describe('parseOEmbed + unescapeHtmlEntities (5.2)', () => {
  it('parses a valid oEmbed body', () => {
    expect(
      parseOEmbed({ title: '  Title  ', author_name: 'Author', thumbnail_url: 'https://i.ytimg.com/x.jpg' }),
    ).toEqual({ title: 'Title', authorName: 'Author', thumbnailUrl: 'https://i.ytimg.com/x.jpg' })
  })

  it('rejects a body without a title and defaults the author', () => {
    expect(parseOEmbed({ author_name: 'a' })).toBeUndefined()
    expect(parseOEmbed({ title: 't' })).toEqual({ title: 't', authorName: 'unknown author' })
  })

  it('unescapeHtmlEntities handles the common set (amp last)', () => {
    expect(unescapeHtmlEntities('a &amp; b &lt;c&gt; &#39;d&#39; &quot;e&quot;')).toBe("a & b <c> 'd' \"e\"")
  })
})
