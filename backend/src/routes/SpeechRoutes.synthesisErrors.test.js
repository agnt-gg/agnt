import { it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import http from 'node:http';

// Unit-only identity seam; never signs a token or connects to a running AGNT.
vi.mock('../utils/authGuard.js', () => ({ requireAuthHeader: (req, res, next) => {
  if (req.headers['x-unit-user'] !== 'unit-user') return res.status(401).end();
  req.user = { id: 'unit-user' }; next();
} }));
vi.mock('../services/auth/AuthManager.js', () => ({ default: {
  getValidAccessToken: async () => 'unit-only-not-a-credential',
} }));
vi.mock('../services/whisperService.js', () => ({ whisperService: {} }));
vi.mock('../services/realtimeVoiceService.js', () => ({ createRealtimeCall: vi.fn(), REALTIME_VOICES: [], DEFAULT_VOICE: '', REALTIME_MODEL: '' }));
vi.mock('../services/auth/openAiVoiceCredential.js', () => ({ hasOpenAiVoiceCredential: vi.fn() }));
vi.mock('./codexVoiceRoutes.js', () => ({ createCodexVoiceRouter: () => express.Router() }));
const networkFetch = globalThis.fetch;
let server, base, provider;
beforeAll(async () => {
  const app = express(); app.use(express.json());
  app.use('/api/speech', (await import('./SpeechRoutes.js')).default);
  server = http.createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(async () => {
  globalThis.fetch = networkFetch;
  if (server) await new Promise(r => server.close(r));
});
beforeEach(() => {
  provider = vi.fn(); globalThis.fetch = provider;
});
const post = (auth = true) => networkFetch(`${base}/api/speech/synthesize`, {
  method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { 'x-unit-user': 'unit-user' } : {}) },
  body: JSON.stringify({ text: 'No, do not do it.', engine: 'openai' }),
});

it.each([401, 403, 429])('preserves typed provider status %s through real service + HTTP route', async status => {
  provider.mockResolvedValue(new Response('private provider diagnostics', { status }));
  const response = await post(); const body = await response.json();
  expect(response.status).toBe(status);
  expect(body).toMatchObject({ success: false, code: 'tts-provider-rejected', providerStatus: status, demote: true });
  expect(JSON.stringify(body)).not.toContain('private provider diagnostics');
  expect(provider).toHaveBeenCalledTimes(1);
});
it('does not echo provider response content on 500', async () => {
  provider.mockResolvedValue(new Response('private provider diagnostics', { status: 500 }));
  const response = await post(); const body = await response.json();
  expect(response.status).toBe(502);
  expect(body).toMatchObject({ code: 'tts-provider-rejected', providerStatus: 500, demote: false });
  expect(JSON.stringify(body)).not.toContain('private provider diagnostics');
});
it('reports zero audio as a typed failure, not successful empty playback', async () => {
  provider.mockResolvedValue(new Response(new Uint8Array()));
  const response = await post();
  expect(response.status).toBe(502);
  expect(await response.json()).toMatchObject({ code: 'tts-empty-audio', demote: false });
});
it('normalizes network errors without leaking arbitrary messages', async () => {
  provider.mockRejectedValue(new Error('private connection diagnostics'));
  const response = await post(); const body = await response.json();
  expect(response.status).toBe(502);
  expect(body.code).toBe('tts-network-error');
  expect(JSON.stringify(body)).not.toContain('private connection diagnostics');
});
it.each([401, 403, 429])('production browser output demotes once through actual HTTP %s', async status => {
  const { createSpeechOut } = await import('../../../../frontend/src/voice/speechOut.js');
  provider.mockResolvedValue(new Response('private diagnostics', { status }));
  const clientFetch = vi.fn((url, options) => networkFetch(url, {
    ...options, headers: { ...options.headers, 'x-unit-user': 'unit-user' },
  }));
  const spoken = [];
  const out = createSpeechOut({ engine: 'provider', apiBase: `${base}/api` }, {
    fetch: clientFetch,
    SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
    speechSynthesis: { speak(u) { spoken.push(u.text); queueMicrotask(() => u.onend()); }, cancel() {} },
  });
  await Promise.all([out.speak('No, do not do it.'), out.speak('Wait for a backup.')]);
  out.reset(); await out.speak('A fresh turn.');
  expect(clientFetch).toHaveBeenCalledTimes(1);
  expect(provider).toHaveBeenCalledTimes(1);
  expect(spoken).toEqual(['No, do not do it.', 'Wait for a backup.', 'A fresh turn.']);
  expect(out.config.providerEngine).toBe('openai');
});

it('keeps the actual candidate route authenticated and unavailable without owner registration', async () => {
  const request = auth => networkFetch(`${base}/api/speech/synthesize-stream`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { 'x-unit-user': 'unit-user' } : {}) },
    body: JSON.stringify({ requestId: 'unit-r1', text: 'Do not move it.', engine: 'faster-qwen-candidate' }),
  });
  expect((await request(false)).status).toBe(401);
  const response = await request(true); expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ code: 'stream-candidate-unavailable' });
  expect(provider).not.toHaveBeenCalled();
});

it('local ASR route requires auth and stays unavailable without owner registration', async () => {
  const request = auth => networkFetch(`${base}/api/speech/transcribe-local`, {
    method: 'POST', headers: { 'content-type': 'audio/pcm', 'x-asr-utterance-id': 'asr-unit-1', ...(auth ? { 'x-unit-user': 'unit-user' } : {}) }, body: Buffer.alloc(640),
  });
  expect((await request(false)).status).toBe(401);
  const response = await request(true); expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ ok: false, reason: 'local-asr-unavailable' });
  expect(provider).not.toHaveBeenCalled();
});

it('requires route identity before provider invocation', async () => {
  expect((await post(false)).status).toBe(401);
  expect(provider).not.toHaveBeenCalled();
});
