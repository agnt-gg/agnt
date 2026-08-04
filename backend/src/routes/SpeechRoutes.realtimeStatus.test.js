/**
 * The capability probe must agree with the capability.
 *
 * `GET /api/speech/realtime/status` is what the client asks before it decides
 * whether to OFFER speech-to-speech at all. It used to answer a DIFFERENT
 * question — "does the OpenAI *TTS* engine have a platform API key?" — which
 * meant a user signed in with ChatGPT/Codex was told voice did not exist while
 * the call would in fact have succeeded (POST /v1/realtime/calls -> 201).
 *
 * That is why fixing the SDP exchange alone would have changed nothing the user
 * could see: the feature would work and never be offered. So this boots the
 * REAL router over a REAL socket and pins the property that matters — the probe
 * and the call read the same credential resolver, and TTS engine availability
 * has no say in it.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import http from 'http';
import jwt from 'jsonwebtoken';

const hasOpenAiVoiceCredential = vi.fn();
const resolveOpenAiVoiceCredential = vi.fn();
vi.mock('../services/auth/openAiVoiceCredential.js', () => ({
  hasOpenAiVoiceCredential: (...a) => hasOpenAiVoiceCredential(...a),
  resolveOpenAiVoiceCredential: (...a) => resolveOpenAiVoiceCredential(...a),
  isBorrowedCredential: (s) => s === 'openai-codex',
  VOICE_CREDENTIAL_SOURCE: { PLATFORM: 'openai', CHATGPT: 'openai-codex' },
}));

// Neither of these may influence realtime availability; they are mocked so the
// test cannot accidentally pass because a real key happens to exist, and so the
// suite never loads the local Whisper model.
const availableEngines = vi.fn(async () => []);
vi.mock('../services/ttsService.js', () => ({
  synthesize: vi.fn(),
  listEngines: () => [],
  availableEngines: (...a) => availableEngines(...a),
  MAX_TTS_CHARS: 4000,
}));
vi.mock('../services/whisperService.js', () => ({ whisperService: { transcribe: vi.fn() } }));

const SECRET = 'speech-realtime-status-secret';
let server;
let base;
let prevSecret;

const token = (id = 'u1') => jwt.sign({ id, email: 'a@b.c' }, SECRET, { expiresIn: '1h' });
const status = (auth = true) =>
  fetch(`${base}/api/speech/realtime/status`, {
    headers: auth ? { Authorization: `Bearer ${token()}` } : {},
  });

beforeAll(async () => {
  prevSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = SECRET;

  const SpeechRoutes = (await import('./SpeechRoutes.js')).default;
  const app = express();
  app.use('/api/speech', SpeechRoutes);

  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (prevSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = prevSecret;
});

beforeEach(() => {
  hasOpenAiVoiceCredential.mockReset();
  availableEngines.mockClear();
  availableEngines.mockResolvedValue([]);
});

describe('GET /api/speech/realtime/status', () => {
  it('offers voice to a user whose only OpenAI credential is a ChatGPT sign-in', async () => {
    // THE REGRESSION. No TTS engine is available (no platform key anywhere),
    // yet realtime is reachable — which is exactly the ChatGPT-only user.
    hasOpenAiVoiceCredential.mockResolvedValue(true);

    const res = await status();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.available).toBe(true);
    expect(hasOpenAiVoiceCredential).toHaveBeenCalledWith('u1');
  });

  it('does not offer voice when there is no OpenAI credential at all', async () => {
    hasOpenAiVoiceCredential.mockResolvedValue(false);
    const body = await (await status()).json();
    expect(body.available).toBe(false);
  });

  it('does not consult TTS engine availability', async () => {
    // The old implementation was `(await availableEngines(user)).includes('openai')`.
    // If that ever comes back, this fails.
    hasOpenAiVoiceCredential.mockResolvedValue(true);
    await status();
    expect(availableEngines).not.toHaveBeenCalled();
  });

  it('still reports the model and voice list the client needs', async () => {
    hasOpenAiVoiceCredential.mockResolvedValue(true);
    const body = await (await status()).json();

    expect(body.success).toBe(true);
    expect(body.model).toBe('gpt-realtime-2.1');
    expect(Array.isArray(body.voices)).toBe(true);
    expect(body.voices).toContain(body.defaultVoice);
  });

  it('a resolver failure is a 500, not a false "unavailable"', async () => {
    // Silently reporting "no voice" on an infrastructure error would send the
    // user hunting for a credential problem they do not have.
    hasOpenAiVoiceCredential.mockRejectedValue(new Error('vault exploded'));
    const res = await status();
    expect(res.status).toBe(500);
  });

  it('stays behind auth', async () => {
    hasOpenAiVoiceCredential.mockResolvedValue(true);
    const res = await status(false);
    expect(res.status).toBe(401);
    expect(hasOpenAiVoiceCredential).not.toHaveBeenCalled();
  });
});
