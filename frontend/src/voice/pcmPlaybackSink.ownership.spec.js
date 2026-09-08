import { it, expect, vi } from 'vitest';
import { createPcmPlaybackSink } from './pcmPlaybackSink.js';
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function harness(options = {}) {
  const resume = deferred(), sources = [], gains = [];
  const ctx = { resume: vi.fn(() => resume.promise), close: vi.fn(async () => {}), destination: {},
    createBuffer: () => ({ copyToChannel() {} }),
    createGain: () => { const g = { gain: {}, connect: vi.fn(), disconnect: vi.fn() }; gains.push(g); return g; },
    createBufferSource: () => { const s = { connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn() }; sources.push(s); return s; },
  };
  const capture = vi.fn();
  const sink = createPcmPlaybackSink({ createContext: () => ctx, onPostGatePcm: capture, ...options });
  const write = (o) => sink.write(new Float32Array([0.2]), 24000, o);
  return { resume, sources, gains, ctx, capture, sink, write };
}
it('reserves the slot before resume: concurrent write and drain reject', async () => {
  const h = harness(); const first = h.write().catch(e => e.message);
  const second = h.write().catch(e => e.message);
  const drain = h.sink.drain().catch(e => e.message);
  h.resume.resolve(); await new Promise(r => setTimeout(r, 0));
  const started = h.sources.length; h.sink.stop();
  // Retain deterministic cleanup even against the original two-source mutant.
  for (const s of h.sources) s.onended?.();
  expect(await second).toBe('stale'); expect(await drain).toBe('not-drained');
  expect(started).toBe(1); expect(await first).toBe('cancelled');
  expect(h.sources.every(s => s.stop.mock.calls.length === 1)).toBe(true);
  expect(h.gains.every(g => g.disconnect.mock.calls.length > 0)).toBe(true);
});
it('stop settles immediately even if resume never resolves', async () => {
  const h = harness(); const p = h.write().catch(e => e.message);
  h.sink.stop();
  expect(await Promise.race([p, new Promise(r => setTimeout(() => r('hung'), 25))])).toBe('stale');
  expect(h.ctx.close).toHaveBeenCalledTimes(1); expect(h.sources).toHaveLength(0);
  h.resume.reject(new Error('late resume failure')); await Promise.resolve();
});
it('resume rejection releases ownership and permits a fresh write', async () => {
  const h = harness(); const first = h.write().catch(e => e.message);
  h.resume.reject(new Error('resume denied')); expect(await first).toBe('resume denied');
  h.ctx.resume.mockResolvedValue(); const next = h.write();
  await new Promise(r => setTimeout(r, 0)); expect(h.sources).toHaveLength(1);
  h.sources[0].onended(); await next; await h.sink.drain();
});
it('drain reserves context closure until it settles', async () => {
  const h = harness(); h.resume.resolve(); const p = h.write();
  await new Promise(r => setTimeout(r, 0)); h.sources[0].onended(); await p;
  const closing = deferred(); h.ctx.close.mockReturnValue(closing.promise);
  const drain = h.sink.drain(); const write = h.write().catch(e => e.message);
  const secondDrain = h.sink.drain().catch(e => e.message);
  closing.resolve(); await drain; h.sink.stop(); for (const s of h.sources) s.onended?.();
  expect(await write).toBe('stale'); expect(await secondDrain).toBe('not-drained');
  expect(h.ctx.close).toHaveBeenCalledTimes(1);
});
it('stop from onStarted suppresses scheduled capture and settles once', async () => {
  const h = harness(); h.resume.resolve();
  const p = h.write({ onStarted: () => h.sink.stop() }).catch(e => e.message);
  expect(await p).toBe('cancelled'); expect(h.capture).not.toHaveBeenCalled();
  expect(h.sources[0].stop).toHaveBeenCalledTimes(1);
});
it('cleans allocated nodes when graph setup throws, then allows recovery', async () => {
  const h = harness(); h.resume.resolve();
  h.ctx.createGain = () => { throw new Error('gain failed'); };
  expect(await h.write().catch(e => e.message)).toBe('gain failed');
  expect(h.sources[0].stop).toHaveBeenCalledTimes(1);
  expect(h.sources[0].disconnect).toHaveBeenCalledTimes(1);
  await h.sink.drain(); expect(h.ctx.close).toHaveBeenCalledTimes(1);
});
it('stop from rendered tap setup never starts or captures and ends tracks', async () => {
  let h; const track = { stop: vi.fn() }; const tap = { stream: { getTracks: () => [track] }, disconnect: vi.fn() };
  h = harness({ onRenderedStream: () => h.sink.stop() });
  h.ctx.createMediaStreamDestination = () => tap; h.resume.resolve();
  expect(await h.write().catch(e => e.message)).toBe('cancelled');
  expect(h.sources[0].start).not.toHaveBeenCalled(); expect(h.capture).not.toHaveBeenCalled();
  expect(track.stop).toHaveBeenCalledTimes(1); expect(tap.disconnect).toHaveBeenCalledTimes(1);
  expect(h.gains[0].disconnect).toHaveBeenCalledTimes(1);
});
it('a stale ended callback cannot release a newer write owner', async () => {
  const h = harness(); h.resume.resolve(); const first = h.write();
  await new Promise(r => setTimeout(r, 0)); const oldEnded = h.sources[0].onended;
  oldEnded(); await first;
  const next = h.write().catch(e => e.message); oldEnded();
  expect(await h.write().catch(e => e.message)).toBe('stale');
  h.sink.stop(); expect(await next).toBe('cancelled');
});
it('permission revocation releases the slot without source or capture', async () => {
  const h = harness(); let allowed = true;
  const p = h.write({ isAllowed: () => allowed }).catch(e => e.message);
  allowed = false; h.resume.resolve(); expect(await p).toBe('stale');
  expect(h.sources).toHaveLength(0); expect(h.capture).not.toHaveBeenCalled();
  const next = h.write(); await new Promise(r => setTimeout(r, 0)); h.sources[0].onended(); await next; await h.sink.drain();
});
