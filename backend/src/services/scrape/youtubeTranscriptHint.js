/**
 * Where to get what a YouTube video says, for the chat's web_scrape result.
 *
 * WHY THIS EXISTS
 * ---------------
 * A watch page carries the title, description and chapters, never the words: the transcript
 * panel loads on demand, behind YouTube's "Sign in to confirm you're not a bot" wall. The
 * YouTube plugin's GET_TRANSCRIPTION gets the words (captions first, then Gemini reading the
 * video from its URL). Plugin tools are deferred in the chat, so an agent handed a YouTube
 * link reaches for web_scrape, gets no transcript, and reports the video as unwatchable,
 * while the tool that works sits unloaded one call away. The scrape result is where that
 * agent is looking, so that is where the pointer goes.
 */

// YouTube video IDs are exactly 11 characters from this alphabet.
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com']);
// Paths whose next segment is the video ID: /shorts/<id>, /live/<id>, /embed/<id>, /v/<id>.
const ID_SEGMENT_PATHS = new Set(['shorts', 'live', 'embed', 'v']);

/** The video ID a URL points at, or null when it is not a single YouTube video. Never throws. */
export function youtubeVideoId(url) {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  const host = parsed.hostname.toLowerCase();
  const segments = parsed.pathname.split('/').filter(Boolean);
  let candidate = null;
  if (host === 'youtu.be') candidate = segments[0];
  else if (YOUTUBE_HOSTS.has(host)) {
    if (segments[0] === 'watch') candidate = parsed.searchParams.get('v');
    else if (ID_SEGMENT_PATHS.has(segments[0])) candidate = segments[1];
  }
  return candidate && VIDEO_ID.test(candidate) ? candidate : null;
}

/** The sentence pointing a web_scrape caller at the transcript tool, or null for any other URL. */
export function youtubeTranscriptHint(url) {
  const videoId = youtubeVideoId(url);
  if (!videoId) return null;
  return (
    'This is a YouTube video. Its page has the title and description, not what is said in it. ' +
    `For the transcript, call youtube_api with action "GET_TRANSCRIPTION" and videoId "${videoId}" ` +
    '(if youtube_api is not loaded, load it first: discover_tools, operation "load", categories ["plugin:youtube-plugin"]).'
  );
}
