import { it, expect, vi } from 'vitest';
import { createPcmPlaybackSink } from './pcmPlaybackSink.js';
function harness() {
  const sources = [];
  const ctx = { resume: vi.fn(async () => {}), close: vi.fn(async () => {}), destination: {},
    createBuffer: vi.fn(() => ({ copyToChannel: vi.fn() })),
    createGain: () => ({ gain: {}, connect: vi.fn(), disconnect: vi.fn() }),
    createBufferSource: () => { const s = { connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn() }; sources.push(s); return s; },
  };
  const capture = vi.fn();
  return { ctx, sources, capture, sink: createPcmPlaybackSink({ createContext: () => ctx, onPostGatePcm: capture }) };
}
it('waits for actual source-ended before accepting another chunk, then closes context', async () => {
  const h = harness(); let ended = false;
  const started = vi.fn();
  const p = h.sink.write(new Float32Array([0.1]), 24000, { onStarted: started }).then(() => { ended = true; });
  await Promise.resolve(); expect(started).toHaveBeenCalledTimes(1); expect(h.sources[0].start).toHaveBeenCalledTimes(1); expect(ended).toBe(false);
  await expect(h.sink.write(new Float32Array([0.2]), 24000)).rejects.toThrow('stale');
  h.sources[0].onended(); await p; await h.sink.drain(); expect(h.ctx.close).toHaveBeenCalledTimes(1);
  expect(h.capture.mock.calls[0][0].stage).toBe('scheduled-post-gate');
});
it('stop synchronously stops/disconnects and rejects in-flight playback', async () => {
  const h = harness(); const p = h.sink.write(new Float32Array([0.1]), 24000); const rejection = expect(p).rejects.toThrow('cancelled');
  await Promise.resolve(); h.sink.stop();
  expect(h.sources[0].stop).toHaveBeenCalledTimes(1); expect(h.sources[0].disconnect).toHaveBeenCalled();
  expect(h.sources[0].onended).toBe(null); await rejection; expect(h.ctx.close).toHaveBeenCalledTimes(1);
});
it('does not start or capture when permission changes during context resume', async () => {
  const h = harness(); let resume; h.ctx.resume.mockImplementation(() => new Promise(r => { resume = r; }));
  let allowed = true; const p = h.sink.write(new Float32Array([0.1]), 24000, { isAllowed: () => allowed });
  allowed = false; resume(); await expect(p).rejects.toThrow('stale');
  expect(h.sources).toHaveLength(0); expect(h.capture).not.toHaveBeenCalled(); h.sink.stop();
});
it('does not revive a context when stopped during resume', async () => {
  const h = harness(); let resume; h.ctx.resume.mockImplementation(() => new Promise(r => { resume = r; }));
  const p = h.sink.write(new Float32Array([0.1]), 24000); h.sink.stop(); resume();
  await expect(p).rejects.toThrow('stale'); expect(h.sources).toHaveLength(0); expect(h.ctx.close).toHaveBeenCalledTimes(1);
});
