import { describe, it, expect } from 'vitest';
import { youtubeVideoId, youtubeTranscriptHint } from './youtubeTranscriptHint.js';

const ID = '3199TC7Pt_o';

describe('youtubeVideoId', () => {
  it.each([
    [`https://www.youtube.com/watch?v=${ID}`],
    // The exact link that went unread: a playlist URL whose page web_scrape could not transcribe.
    [`https://www.youtube.com/watch?v=${ID}&list=PL5Y2vlXT60eRaQ3CtoC-zm_lRb7GtUfFw`],
    [`https://youtube.com/watch?feature=share&v=${ID}&t=80s`],
    [`https://m.youtube.com/watch?v=${ID}`],
    [`https://music.youtube.com/watch?v=${ID}`],
    [`http://www.youtube.com/watch?v=${ID}`],
    [`https://WWW.YouTube.com/watch?v=${ID}`],
    [`https://youtu.be/${ID}`],
    [`https://youtu.be/${ID}?t=42`],
    [`https://www.youtube.com/shorts/${ID}`],
    [`https://www.youtube.com/live/${ID}?si=abc`],
    [`https://www.youtube.com/embed/${ID}`],
    [`https://www.youtube-nocookie.com/embed/${ID}`],
  ])('finds the video in %s', (url) => {
    expect(youtubeVideoId(url)).toBe(ID);
  });

  it.each([
    ['https://www.youtube.com/'],
    ['https://www.youtube.com/@DaveShap'],
    ['https://www.youtube.com/playlist?list=PL5Y2vlXT60eRaQ3CtoC-zm_lRb7GtUfFw'],
    ['https://www.youtube.com/results?search_query=scion'],
    ['https://www.youtube.com/watch'],
    ['https://www.youtube.com/watch?v=short'],
    [`https://www.youtube.com/watch?v=${ID}x`],
    [`https://notyoutube.com/watch?v=${ID}`],
    [`https://youtube.com.evil.test/watch?v=${ID}`],
    [`https://evil.test/?u=https://www.youtube.com/watch?v=${ID}`],
    [`ftp://www.youtube.com/watch?v=${ID}`],
    ['not a url'],
    [''],
    [undefined],
    [null],
  ])('is null for %s', (url) => {
    expect(youtubeVideoId(url)).toBeNull();
  });
});

describe('youtubeTranscriptHint', () => {
  it('names the tool, the action, the video and how to load the plugin', () => {
    const hint = youtubeTranscriptHint(`https://www.youtube.com/watch?v=${ID}&list=PL5Y2vlXT60eRaQ3CtoC-zm_lRb7GtUfFw`);
    expect(hint).toContain('youtube_api');
    expect(hint).toContain('"GET_TRANSCRIPTION"');
    expect(hint).toContain(`videoId "${ID}"`);
    expect(hint).toContain('plugin:youtube-plugin');
  });

  it('is null for any page that is not a single video', () => {
    expect(youtubeTranscriptHint('https://example.com/article')).toBeNull();
    expect(youtubeTranscriptHint('https://www.youtube.com/@DaveShap')).toBeNull();
  });
});
