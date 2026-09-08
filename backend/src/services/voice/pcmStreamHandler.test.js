import { it, expect, vi, afterEach } from 'vitest';
import express from 'express';
import http from 'node:http';
import { createPcmStreamHandler } from './pcmStreamHandler.js';
import { consumePcmStream } from '../../../../frontend/src/voice/pcmStream.js';
const servers = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(s => new Promise(r => s.close(r)))); });
async function server(adapter, options = {}) {
  const app = express(); app.use(express.json());
  // Explicit isolated test identity seam, not real account authentication.
  app.post('/stream', (req, res, next) => {
    if (req.headers['x-unit-user'] !== 'unit') return res.status(401).end();
    req.user = { id: 'unit' }; next();
  }, createPcmStreamHandler({ resolveAdapter: () => adapter, ...options }));
  const s = http.createServer(app); servers.push(s); await new Promise(r => s.listen(0, '127.0.0.1', r));
  return (body = {}, auth = true, signal) => fetch(`http://127.0.0.1:${s.address().port}/stream`, {
    method: 'POST', signal, headers: { 'content-type': 'application/json', ...(auth ? { 'x-unit-user': 'unit' } : {}) },
    body: JSON.stringify({ text: 'Do not move the file.', requestId: 'test-r1', engine: 'faster-qwen-candidate', ...body }),
  });
}
function adapter(generate) { return { id: 'faster-qwen-candidate', sampleRate: 24000, generate }; }
it('streams real HTTP into production parser before generation completes, with authenticated user binding', async () => {
  let finish; const gate = new Promise(r => { finish = r; });
  const generate = vi.fn(async function* () { yield Buffer.from([0, 0, 255, 127]); await gate; yield Buffer.from([0, 128]); });
  const post = await server(adapter(generate)); const response = await post();
  const sink = { write: vi.fn(async () => {}), drain: vi.fn(async () => {}), stop: vi.fn() };
  const p = consumePcmStream({ body: response.body, sink, requestId: 'test-r1' });
  await vi.waitFor(() => expect(sink.write).toHaveBeenCalledTimes(1));
  expect(generate.mock.calls[0][0]).toMatchObject({ userId: 'unit', text: 'Do not move the file.' });
  finish(); expect(await p).toMatchObject({ ok: true, chunks: 2, receivedSamples: 3 });
});
it('requires identity before generation', async () => {
  const generate = vi.fn(); const post = await server(adapter(generate));
  expect((await post({}, false)).status).toBe(401); expect(generate).not.toHaveBeenCalled();
});
it('is unavailable with no registered owner adapter', async () => {
  const post = await server(null); const r = await post(); expect(r.status).toBe(503);
  expect(await r.json()).toMatchObject({ code: 'stream-candidate-unavailable' });
});
it.each([{ requestId: '' }, { text: 'x'.repeat(4097) }, { engine: 'openai' }, { voice: { bad: true } }])('rejects invalid or different destination request %j', async body => {
  const generate = vi.fn(); const post = await server(adapter(generate));
  expect((await post(body)).status).toBe(400); expect(generate).not.toHaveBeenCalled();
});
it.each([
  ['zero', async function* () {}],
  ['odd PCM', async function* () { yield Buffer.from([0]); }],
  ['oversize', async function* () { yield Buffer.alloc(48002); }],
  ['exception', async function* () { throw new Error('PRIVATE CONTENT'); }],
])('reports %s failure without successful done or raw error contents', async (_name, generate) => {
  const post = await server(adapter(generate)); const r = await post(); const text = await r.text();
  expect(text).toContain('"type":"error"'); expect(text).not.toContain('"type":"done"'); expect(text).not.toContain('PRIVATE CONTENT');
});
it('times out blocked generation, retains busy ownership until compute settles, no overlap', async () => {
  let release; const gate = new Promise(r => { release = r; });
  const generate = vi.fn(async function* () { await gate; yield Buffer.from([0, 0]); });
  const post = await server(adapter(generate), { timeoutMs: 40 });
  const first = await post(); const text = await first.text(); expect(text).toContain('"code":"timeout"');
  expect((await post()).status).toBe(429); expect(generate).toHaveBeenCalledTimes(1);
  release(); await new Promise(r => setTimeout(r, 10));
  expect((await (await post()).text())).toContain('"type":"done"');
});
