import { describe, it, expect, vi } from 'vitest';
import { consumePcmStream } from './pcmStream.js';
import { createSpeechOut } from './speechOut.js';
const encoder = new TextEncoder();
const start = { type: 'start', version: 1, requestId: 'r1', format: 's16le', sampleRate: 24000, channels: 1 };
const chunk = { type: 'audio', requestId: 'r1', sequence: 0, pcm: 'AAD/fwCA' };
const done = { type: 'done', requestId: 'r1', chunks: 1, samples: 3 };
function harness(records = [start, chunk, done]) {
  let controller;
  const body = new ReadableStream({ start(c) { controller = c; } });
  const push = r => controller.enqueue(encoder.encode(JSON.stringify(r) + '\n'));
  const sink = { write: vi.fn(async () => {}), drain: vi.fn(async () => {}), stop: vi.fn() };
  return { body, sink, push, close: () => controller.close(), fill: () => { records.forEach(push); controller.close(); } };
}
const run = h => consumePcmStream({ body: h.body, sink: h.sink, requestId: 'r1' });
describe('bounded explicit PCM wire', () => {
  it('delivers PCM before EOF and distinguishes received from played counters', async () => {
    const h = harness(); const pending = run(h);
    h.push(start); h.push(chunk);
    await vi.waitFor(() => expect(h.sink.write).toHaveBeenCalledTimes(1));
    expect(h.sink.write.mock.calls[0][0]).toEqual(new Float32Array([0, 32767/32768, -1]));
    expect(h.sink.drain).not.toHaveBeenCalled();
    h.push(done); h.close();
    expect(await pending).toMatchObject({ ok: true, receivedSamples: 3, allowedSamples: 3, playbackDrained: true });
  });
  it.each([
    ['EOF', [start, chunk]],
    ['zero audio', [start, { ...done, chunks: 0, samples: 0 }]],
    ['sequence gap', [start, { ...chunk, sequence: 1 }, done]],
    ['foreign identity', [start, { ...chunk, requestId: 'other' }, done]],
    ['contradictory count', [start, chunk, { ...done, samples: 30 }]],
    ['invalid base64', [start, { ...chunk, pcm: '!!!!' }, done]],
    ['odd PCM byte', [start, { ...chunk, pcm: 'AA==' }, done]],
    ['duplicate terminal', [start, chunk, done, done]],
    ['provider error', [start, chunk, { type: 'error', requestId: 'r1', code: 'generation' }]],
    ['unsupported format', [{ ...start, sampleRate: 0 }, chunk, done]],
  ])('fails closed on %s and stops queued media', async (_name, records) => {
    const h = harness(records); h.fill();
    expect((await run(h)).ok).toBe(false); expect(h.sink.stop).toHaveBeenCalled();
  });
  it('rejects stale permission before writing any audio', async () => {
    const h = harness(); h.fill();
    expect(await consumePcmStream({ body: h.body, sink: h.sink, requestId: 'r1', isAllowed: () => false })).toMatchObject({ ok: false });
    expect(h.sink.write).not.toHaveBeenCalled();
  });
  it('aborts a stalled read promptly and releases the reader', async () => {
    const h = harness(); const ac = new AbortController();
    const p = consumePcmStream({ body: h.body, sink: h.sink, requestId: 'r1', signal: ac.signal });
    ac.abort(); expect(await p).toMatchObject({ ok: false, reason: 'cancelled' });
    expect(h.body.locked).toBe(false); expect(h.sink.stop).toHaveBeenCalled();
  });
  it('accepts byte-fragmented UTF-8 records without whole-response buffering', async () => {
    const bytes = encoder.encode([start, chunk, done].map(r => JSON.stringify(r) + '\n').join(''));
    const body = new ReadableStream({ start(c) { for (const byte of bytes) c.enqueue(new Uint8Array([byte])); c.close(); } });
    const h = harness();
    expect(await consumePcmStream({ body, sink: h.sink, requestId: 'r1' })).toMatchObject({ ok: true, receivedSamples: 3 });
  });
  it('bounds incomplete records', async () => {
    const h = harness(); const writer = h.body.getReader(); writer.releaseLock();
    h.push({ padding: 'x'.repeat(140000) }); h.close();
    expect(await run(h)).toMatchObject({ ok: false, reason: 'record-limit' });
  });
  it('applies backpressure before reading the next audio record', async () => {
    const h = harness(); let release;
    h.sink.write.mockImplementationOnce(() => new Promise(r => { release = r; }));
    const p = run(h); h.push(start); h.push(chunk); h.push({ ...chunk, sequence: 1 });
    await vi.waitFor(() => expect(h.sink.write).toHaveBeenCalledTimes(1));
    expect(h.sink.write).toHaveBeenCalledTimes(1); release();
    h.push({ ...done, chunks: 2, samples: 6 }); h.close(); expect((await p).ok).toBe(true);
  });
});
describe('production speechOut candidate integration', () => {
  it('bounds queued text and promptly settles cancelled active plus pending work', async () => {
    const h = harness();
    const fetch = vi.fn(async () => ({ ok: true, headers: { get: () => 'application/x-ndjson' }, body: h.body }));
    const out = createSpeechOut({ engine: 'local-stream' }, { fetch, createPcmSink: () => h.sink });
    const first = out.speak('First.'); const second = out.speak('Second.');
    expect(await out.speak('Third.')).toMatchObject({ ok: false, reason: 'queue-full' });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    out.cancel();
    expect(await first).toMatchObject({ ok: false, reason: 'stale' });
    expect(await second).toMatchObject({ ok: false, reason: 'stale' });
    expect(fetch).toHaveBeenCalledTimes(1); expect(h.sink.stop).toHaveBeenCalled();
  });
  it('uses incremental body, auth and generated correlation, never blob or fallback', async () => {
    const h = harness(); const blob = vi.fn(() => { throw Error('whole buffering'); });
    const fetch = vi.fn(async (_url, opts) => {
      const id = JSON.parse(opts.body).requestId;
      [start, chunk, done].forEach(r => h.push({ ...r, requestId: id })); h.close();
      return { ok: true, headers: { get: () => 'application/x-ndjson' }, body: h.body, blob };
    });
    const synth = { speak: vi.fn(), cancel: vi.fn() };
    const out = createSpeechOut({ engine: 'local-stream' }, { fetch, getToken: () => 'fixture-only', createPcmSink: () => h.sink, speechSynthesis: synth });
    expect(await out.speak('Do not move the file.')).toMatchObject({ ok: true });
    expect(fetch.mock.calls[0][0]).toBe('/api/speech/synthesize-stream');
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer fixture-only');
    expect(blob).not.toHaveBeenCalled(); expect(synth.speak).not.toHaveBeenCalled();
  });
  it('never falls back to a different audio destination after stream failure', async () => {
    const synth = { speak: vi.fn(), cancel: vi.fn() };
    const out = createSpeechOut({ engine: 'local-stream' }, { fetch: async () => ({ ok: false, status: 503 }), speechSynthesis: synth });
    expect(await out.speak('Not approved.')).toMatchObject({ ok: false, reason: 'http-503' });
    expect(synth.speak).not.toHaveBeenCalled(); expect(out.config.engine).toBe('local-stream');
  });
});
