import AuthManager from '../services/auth/AuthManager.js';

/**
 * Transcribe a public YouTube video with Gemini, from its URL.
 *
 * WHY THIS EXISTS
 * ---------------
 * YouTube now answers anonymous caption and audio requests with "Sign in to
 * confirm you're not a bot" — from cloud servers and home connections alike
 * (measured 2026-10-31 on Hetzner, DigitalOcean and a residential line). The
 * Data API only downloads captions for videos the signed-in account owns. So
 * yt-dlp and Whisper (which needs the audio) fail for most videos. Gemini takes
 * the YouTube URL itself: Google fetches the video, there is no bot wall.
 *
 * The key is the caller's: AuthManager gives a team member their own Gemini key,
 * or the team's when the owner pays for members' AI; never someone else's apps.
 */
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODEL = 'gemini-2.5-flash';
const TIMEOUT_MS = 5 * 60 * 1000;

const PROMPT = [
  'Transcribe everything that is said in this video, verbatim, in the language it is spoken.',
  'Output only the transcript as plain text paragraphs: no timestamps, no speaker labels, no headings, no commentary.',
  'Do not summarise or skip anything.',
].join(' ');

export default class YouTubeGeminiTranscriber {
  constructor(userId, { fetchImpl = fetch, getKey = (id) => AuthManager.getValidAccessToken(id, 'gemini'), model = DEFAULT_MODEL } = {}) {
    this.userId = userId;
    this.fetch = fetchImpl;
    this.getKey = getKey;
    this.model = model;
  }

  async transcribe(youtubeUrl) {
    if (!this.userId) throw new Error('A signed-in user is required to transcribe with Gemini');
    if (!/^https:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)[\w-]{6,}/.test(String(youtubeUrl))) {
      throw new Error('Gemini transcription needs a YouTube video URL');
    }
    let key;
    try {
      key = await this.getKey(this.userId);
    } catch (error) {
      throw new Error(`Gemini is not available for this account: ${error.message}`);
    }
    if (!key) throw new Error('Gemini is not connected. Connect a Gemini API key in Settings > Connections to transcribe videos.');

    const response = await this.fetch(`${ENDPOINT}/${this.model}:generateContent`, {
      method: 'POST',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ parts: [{ file_data: { file_uri: youtubeUrl } }, { text: PROMPT }] }],
        // Low video resolution: the words come from the audio track; this keeps long videos affordable.
        generationConfig: { mediaResolution: 'MEDIA_RESOLUTION_LOW', maxOutputTokens: 65536, temperature: 0 },
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const reason = body?.error?.message || `HTTP ${response.status}`;
      throw new Error(`Gemini could not transcribe this video: ${reason}`);
    }
    const candidate = body.candidates?.[0];
    const content = (candidate?.content?.parts || []).map((part) => part.text || '').join('').trim();
    if (!content) {
      throw new Error(`Gemini returned no transcript${candidate?.finishReason ? ` (${candidate.finishReason})` : ''}`);
    }
    return {
      success: true,
      content,
      length: content.length,
      method: `Gemini (${this.model})`,
      truncated: candidate?.finishReason === 'MAX_TOKENS',
      promptTokens: body.usageMetadata?.promptTokenCount || null,
    };
  }
}
