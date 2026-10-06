import { describe, it, expect, vi } from 'vitest';
import { inBatches } from './inBatches.js';

const ids = (n) => Array.from({ length: n }, (_, i) => 'id-' + i);

describe('inBatches', () => {
  it('covers every id exactly once, in order, in bounded batches', async () => {
    const seen = [];
    const { done, stopped } = await inBatches(ids(120), 50, async (batch) => {
      seen.push(batch.length);
      return batch;
    });
    expect(seen).toEqual([50, 50, 20]);
    expect(done).toBe(120);
    expect(stopped).toBe(false);
  });

  it('runs one batch at a time', async () => {
    let inFlight = 0;
    let peak = 0;
    await inBatches(ids(10), 3, async () => {
      peak = Math.max(peak, ++inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
    });
    expect(peak).toBe(1);
  });

  it('stops between batches and says how far it got', async () => {
    let calls = 0;
    const { done, stopped } = await inBatches(ids(10), 4, async () => calls++, { shouldStop: () => calls === 1 });
    expect({ calls, done, stopped }).toEqual({ calls: 1, done: 4, stopped: true });
  });

  it('reports progress after each batch', async () => {
    const onProgress = vi.fn();
    await inBatches(ids(5), 2, async () => {}, { onProgress });
    expect(onProgress.mock.calls.map((c) => c[0])).toEqual([2, 4, 5]);
  });

  it('does nothing for an empty list, and refuses a nonsensical batch size', async () => {
    const work = vi.fn();
    expect(await inBatches([], 50, work)).toEqual({ results: [], done: 0, stopped: false });
    expect(work).not.toHaveBeenCalled();
    await expect(inBatches(ids(2), 0, work)).rejects.toThrow(RangeError);
  });

  it('propagates a failed batch instead of swallowing it', async () => {
    await expect(inBatches(ids(4), 2, async () => { throw new Error('HTTP 500'); })).rejects.toThrow('HTTP 500');
  });
});
