import { it, expect, vi } from 'vitest';
import { createLocalAsrClient } from './localAsrClient.js';
const pcm = () => new Uint8Array(640);
const final = (extra = {}) => ({ ok: true, utteranceId: 'test-1', transcript: 'Do not move it before making a backup.', kind: 'local-asr-hard-final', audioBytes: 640, ...extra });
const reply = record => new Response(JSON.stringify(record), { headers: { 'content-type': 'application/json' } });
it('returns typed input for existing native submit without choosing any text model or provider', async () => {
  const fetch = vi.fn(async () => reply(final()));
  const client = createLocalAsrClient({ fetch, getToken: () => 'unit-only' });
  const result = await client.transcribe({ pcm: pcm(), utteranceId: 'test-1' });
  expect(result).toEqual({ ok: true, turn: { text: final().transcript, transcript: final().transcript, commitKind: 'local-asr-hard-final', utteranceId: 'test-1', delegatedInterpretation: null } });
  expect(fetch).toHaveBeenCalledTimes(1);
  const [url, options] = fetch.mock.calls[0];
  expect(url).toBe('/api/speech/transcribe-local'); expect(options.headers.Authorization).toBe('Bearer unit-only');
  expect(options.body).toBeInstanceOf(Uint8Array); expect(options.body.length).toBe(640);
  expect(JSON.stringify(options)).not.toContain('model');
  expect(await client.transcribe({ pcm: pcm(), utteranceId: 'test-1' })).toMatchObject({ ok: false, reason: 'duplicate-utterance' });
});
it.each([
  { kind: 'native-partial' }, { utteranceId: 'other' }, { audioBytes: 638 },
  { transcript: '' }, { transcript: 'x'.repeat(16385) }, { ok: false },
])('rejects unbound or unconfirmed response', async extra => {
  const client = createLocalAsrClient({ fetch: async () => reply(final(extra)), getToken: () => 'unit-only' });
  expect(await client.transcribe({ pcm: pcm(), utteranceId: 'test-1' })).toMatchObject({ ok: false, reason: 'invalid-final' });
});
it('fails unavailable without retry or fallback', async () => {
  const fetch = vi.fn(async () => new Response('', { status: 503 }));
  const client = createLocalAsrClient({ fetch, getToken: () => 'unit-only' });
  expect(await client.transcribe({ pcm: pcm(), utteranceId: 'test-1' })).toMatchObject({ ok: false, reason: 'http-503' });
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('cancel settles hung fetch promptly and old completion cannot affect fresh input', async () => {
  let resolve;
  const fetch = vi.fn().mockImplementationOnce(() => new Promise(r => { resolve = r; })).mockImplementationOnce(async () => reply(final({ utteranceId: 'test-2' })));
  const client = createLocalAsrClient({ fetch, getToken: () => 'unit-only' });
  const pending = client.transcribe({ pcm: pcm(), utteranceId: 'test-1' });
  expect(await client.transcribe({ pcm: pcm(), utteranceId: 'busy' })).toMatchObject({ reason: 'busy' });
  client.stopListening(); expect(await pending).toMatchObject({ ok: false, reason: 'cancelled' });
  expect((await client.transcribe({ pcm: pcm(), utteranceId: 'test-2' })).ok).toBe(true);
  resolve(reply(final()));
});
it('bounds a stalled body and releases its reader', async () => {
  const reader = { read: () => new Promise(() => {}), cancel: vi.fn(() => new Promise(() => {})), releaseLock: vi.fn() };
  const client = createLocalAsrClient({ fetch: async () => ({ ok: true, headers: new Headers({ 'content-type': 'application/json' }), body: { getReader: () => reader } }), getToken: () => 'unit-only', timeoutMs: 15 });
  expect(await client.transcribe({ pcm: pcm(), utteranceId: 'test-1' })).toMatchObject({ ok: false, reason: 'timeout' });
  expect(reader.cancel).toHaveBeenCalled(); expect(reader.releaseLock).toHaveBeenCalled();
});
it('bounds response bytes before JSON decoding', async () => {
  const client = createLocalAsrClient({ fetch: async () => reply({ data: 'x'.repeat(70000) }), getToken: () => 'unit-only' });
  expect(await client.transcribe({ pcm: pcm(), utteranceId: 'test-1' })).toMatchObject({ reason: 'response-limit' });
});
it.each([null, new Uint8Array(0), new Uint8Array(3), new Uint8Array(1920002)])('rejects invalid PCM before network', async audio => {
  const fetch = vi.fn(); const client = createLocalAsrClient({ fetch, getToken: () => 'unit-only' });
  expect(await client.transcribe({ pcm: audio, utteranceId: 'test-1' })).toMatchObject({ ok: false, reason: 'invalid-input' }); expect(fetch).not.toHaveBeenCalled();
});
it('uses the host configured API base without changing model or provider', async () => {
  const fetch = vi.fn(async () => reply(final()));
  const client = createLocalAsrClient({ apiBase: 'http://127.0.0.1:3434/api/', fetch, getToken: () => 'unit-only' });
  expect((await client.transcribe({ pcm: pcm(), utteranceId: 'test-1' })).ok).toBe(true);
  expect(fetch.mock.calls[0][0]).toBe('http://127.0.0.1:3434/api/speech/transcribe-local');
});
it('does not send audio without authentication', async () => {
  const fetch = vi.fn(); const client = createLocalAsrClient({ fetch });
  expect(await client.transcribe({ pcm: pcm(), utteranceId: 'test-1' })).toMatchObject({ reason: 'authentication-required' }); expect(fetch).not.toHaveBeenCalled();
});
