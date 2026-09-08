import { it, expect, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';
import { createLocalAsrHandler } from './localAsrHandler.js';
import { createLocalAsrClient } from '../../../../frontend/src/voice/localAsrClient.js';
import { nativeVoiceMetadata } from '../../../../frontend/src/voice/nativeVoiceSubmit.js';

async function fixture(options = {}) {
  const wsServer = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise(r => wsServer.once('listening', r));
  const wire = []; let connections = 0;
  wsServer.on('connection', ws => {
    connections++; ws.send(JSON.stringify({ type: 'ready' }));
    ws.on('message', (data, binary) => {
      wire.push(binary ? { bytes: data.length } : JSON.parse(data));
      if (!binary && !options.silent) {
        ws.send(JSON.stringify({ type: 'transcript', text: 'Move it', is_final: true, finalize: false }));
        ws.send(JSON.stringify({ type: 'transcript', text: 'Do not move it before making a backup.', is_final: true, finalize: true }));
      }
    });
  });
  const resolveBinding = vi.fn(() => options.unavailable ? null : ({
    id: 'local-asr-candidate', sampleRate: 16000,
    openSocket: () => new WebSocket(`ws://127.0.0.1:${wsServer.address().port}`, { maxPayload: 65536 }),
  }));
  const app = express();
  // Unit-only identity seam, no fabricated login credential or real provider.
  app.post('/asr', (req, res, next) => {
    if (req.headers['x-unit-user']) req.user = { id: req.headers['x-unit-user'] };
    next();
  }, createLocalAsrHandler({ resolveBinding, timeoutMs: options.timeoutMs || 1000 }));
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/asr`;
  return { url, resolveBinding, wire, connections: () => connections,
    post: (id = 'test-1', body = Buffer.alloc(640), headers = {}, query = '') => fetch(url + query, {
      method: 'POST', headers: { 'x-unit-user': 'unit-a', 'x-asr-utterance-id': id, 'content-type': 'audio/pcm', ...headers }, body,
    }),
    async close() { for (const ws of wsServer.clients) ws.terminate(); server.closeAllConnections(); await Promise.all([new Promise(r => server.close(r)), new Promise(r => wsServer.close(r))]); },
  };
}
it('real HTTP to WebSocket commits only typed hard final with owned identity and exact byte count', async () => {
  const f = await fixture();
  try {
    const r = await f.post(); expect(r.status).toBe(200); expect(r.headers.get('cache-control')).toBe('no-store');
    expect(await r.json()).toEqual({ ok: true, utteranceId: 'test-1', transcript: 'Do not move it before making a backup.', kind: 'local-asr-hard-final', audioBytes: 640 });
    expect(f.resolveBinding).toHaveBeenCalledWith('unit-a');
    expect(f.wire).toEqual([{ bytes: 640 }, { type: 'reset', finalize: true }]);
    expect((await f.post()).status).toBe(409);
    expect((await f.post('test-2')).status).toBe(200);
    expect(f.connections()).toBe(2);
  } finally { await f.close(); }
});
it.each([
  ['unauthenticated', { 'x-unit-user': '' }, '', 401],
  ['wrong format', { 'content-type': 'audio/wav' }, '', 400],
  ['invalid identity', { 'x-asr-utterance-id': '../unsafe' }, '', 400],
  ['client endpoint', {}, '?endpoint=ws://untrusted', 400],
])('rejects %s before resolver or socket', async (_, headers, query, status) => {
  const f = await fixture(); try {
    expect((await f.post('test-1', Buffer.alloc(640), headers, query)).status).toBe(status);
    expect(f.resolveBinding).not.toHaveBeenCalled(); expect(f.connections()).toBe(0);
  } finally { await f.close(); }
});
it('unavailable is explicit, no fallback', async () => {
  const f = await fixture({ unavailable: true }); try {
    const r = await f.post(); expect(r.status).toBe(503); expect(await r.json()).toEqual({ ok: false, reason: 'local-asr-unavailable' });
  } finally { await f.close(); }
});
it.each([0, 3, 1920002])('rejects invalid total PCM length %s', async size => {
  const f = await fixture(); try { expect((await f.post('test-1', Buffer.alloc(size))).status).toBe(400); }
  finally { await f.close(); }
});
it('times out soft/missing final, retains attempt identity, releases active latch', async () => {
  const f = await fixture({ silent: true, timeoutMs: 60 }); try {
    const r = await f.post(); expect(r.status).toBe(504); expect(await r.json()).toMatchObject({ ok: false, reason: 'timeout' });
    expect((await f.post()).status).toBe(409);
    expect((await f.post('test-2')).status).toBe(504);
  } finally { await f.close(); }
});
it('production browser client crosses actual HTTP/session boundary and retains qualifier provenance', async () => {
  const f = await fixture(); try {
    const client = createLocalAsrClient({ getToken: () => 'unit-only', fetch: (_, options) => fetch(f.url, { ...options, headers: { ...options.headers, 'x-unit-user': 'unit-a' } }) });
    const result = await client.transcribe({ pcm: new Uint8Array(640), utteranceId: 'combined-1' });
    expect(result.ok).toBe(true);
    expect(result.turn.text).toBe('Do not move it before making a backup.');
    expect(nativeVoiceMetadata(result.turn)).toEqual([{ type: 'voice-input', kind: 'local-asr-hard-final', utteranceId: 'combined-1', observedTranscript: result.turn.text, delegatedInterpretation: null }]);
    expect(f.connections()).toBe(1);
  } finally { await f.close(); }
});
it('chunked HTTP odd fragments reconstruct exact PCM, but odd total never finalizes', async () => {
  const f = await fixture();
  const stream = chunks => new ReadableStream({ start(c) { for (const chunk of chunks) c.enqueue(chunk); c.close(); } });
  try {
    const send = (id, chunks) => fetch(f.url, { method: 'POST', headers: { 'x-unit-user': 'unit-a', 'x-asr-utterance-id': id, 'content-type': 'audio/pcm' }, body: stream(chunks), duplex: 'half' });
    expect((await send('even-1', [Buffer.alloc(3), Buffer.alloc(637)])).status).toBe(200);
    const resets = () => f.wire.filter(r => r.type === 'reset').length;
    expect(resets()).toBe(1);
    expect((await send('odd-1', [Buffer.alloc(3)])).status).toBe(400);
    expect(resets()).toBe(1);
    expect((await send('over-1', [Buffer.alloc(1920002)])).status).toBe(400);
    expect(resets()).toBe(1);
  } finally { await f.close(); }
});
it('rejects overlapping HTTP input before opening a second socket', async () => {
  const f = await fixture({ silent: true, timeoutMs: 150 }); try {
    const pending = f.post(); await vi.waitFor(() => expect(f.wire.length).toBe(2));
    expect((await f.post('other-1')).status).toBe(429); expect(f.connections()).toBe(1);
    expect((await pending).status).toBe(504);
  } finally { await f.close(); }
});
it('browser cancel terminates transport and releases latch without submitting a transcript', async () => {
  const f = await fixture({ silent: true }); try {
    const abort = new AbortController();
    const pending = fetch(f.url, { method: 'POST', headers: { 'x-unit-user': 'unit-a', 'x-asr-utterance-id': 'cancel-1', 'content-type': 'audio/pcm' }, body: Buffer.alloc(640), signal: abort.signal });
    const rejection = expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(f.wire.length).toBe(2)); abort.abort(); await rejection;
    await new Promise(r => setTimeout(r, 30));
    expect((await f.post('cancel-1')).status).toBe(409);
    expect((await f.post('new-id', Buffer.alloc(3))).status).toBe(400);
  } finally { await f.close(); }
});
