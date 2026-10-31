import { describe, it, expect, vi } from 'vitest';

vi.mock('../services/auth/AuthManager.js', () => ({ default: { getValidAccessToken: vi.fn() } }));
const { default: YouTubeGeminiTranscriber } = await import('./youtube-gemini-transcriber.js');

const URL = 'https://www.youtube.com/watch?v=wHJb4vblgOg';
const reply = (status, body) => vi.fn(async () => ({ ok: status < 400, status, json: async () => body }));

// YouTube blocks anonymous caption and audio fetches (yt-dlp, Whisper) from servers and homes alike;
// Gemini fetches the video itself from its URL. This is the step that makes transcripts work on cloud.
describe('YouTube transcription with Gemini', () => {
  it('sends the video URL with the caller\u2019s own key and returns the transcript', async () => {
    const fetchImpl = reply(200, { candidates: [{ content: { parts: [{ text: 'So Neil Patel just published ' }, { text: 'the five rules.' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 99815 } });
    const getKey = vi.fn(async () => 'member-gemini-key');
    const result = await new YouTubeGeminiTranscriber('member-2', { fetchImpl, getKey }).transcribe(URL);
    expect(getKey).toHaveBeenCalledWith('member-2');
    const [endpoint, init] = fetchImpl.mock.calls[0];
    expect(endpoint).toMatch(/gemini-2\.5-flash:generateContent$/);
    expect(init.headers['x-goog-api-key']).toBe('member-gemini-key');
    expect(JSON.parse(init.body).contents[0].parts[0]).toEqual({ file_data: { file_uri: URL } });
    expect(result).toMatchObject({ success: true, content: 'So Neil Patel just published the five rules.', method: 'Gemini (gemini-2.5-flash)', truncated: false, promptTokens: 99815 });
  });

  it('says plainly when Gemini is not connected, and never calls the API', async () => {
    const fetchImpl = vi.fn();
    await expect(new YouTubeGeminiTranscriber('member-2', { fetchImpl, getKey: async () => null }).transcribe(URL)).rejects.toThrow(/Gemini is not connected/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('passes Gemini\u2019s own error through, and treats an empty answer as a failure', async () => {
    const getKey = async () => 'k';
    await expect(new YouTubeGeminiTranscriber('u', { fetchImpl: reply(400, { error: { message: 'Video is private' } }), getKey }).transcribe(URL)).rejects.toThrow(/Video is private/);
    await expect(new YouTubeGeminiTranscriber('u', { fetchImpl: reply(200, { candidates: [{ content: { parts: [] }, finishReason: 'SAFETY' }] }), getKey }).transcribe(URL)).rejects.toThrow(/no transcript \(SAFETY\)/);
  });

  it('marks a transcript cut off at the output limit', async () => {
    const fetchImpl = reply(200, { candidates: [{ content: { parts: [{ text: 'long…' }] }, finishReason: 'MAX_TOKENS' }] });
    expect((await new YouTubeGeminiTranscriber('u', { fetchImpl, getKey: async () => 'k' }).transcribe(URL)).truncated).toBe(true);
  });

  it('refuses anything that is not a YouTube video URL, and needs a user', async () => {
    await expect(new YouTubeGeminiTranscriber('u', { getKey: async () => 'k' }).transcribe('https://evil.example/x')).rejects.toThrow(/YouTube video URL/);
    await expect(new YouTubeGeminiTranscriber(null).transcribe(URL)).rejects.toThrow(/signed-in user/);
  });
});
