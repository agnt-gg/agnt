import { describe, it, expect, vi } from 'vitest';
import { createExpiringLoader } from './expiringLoader.js';

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

describe('createExpiringLoader', () => {
  it('reuses a load for the same key inside the window', async () => {
    const load = vi.fn(async (key) => `value:${key}`);
    const time = clock();
    const loader = createExpiringLoader({ load, ttlMs: 1000, now: time.now });

    expect(await loader.get('a')).toBe('value:a');
    time.advance(999);
    expect(await loader.get('a')).toBe('value:a');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('loads again once the window has passed', async () => {
    let calls = 0;
    const load = vi.fn(async () => ++calls);
    const time = clock();
    const loader = createExpiringLoader({ load, ttlMs: 1000, now: time.now });

    expect(await loader.get('a')).toBe(1);
    time.advance(1000);
    expect(await loader.get('a')).toBe(2);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('shares one in-flight load between concurrent callers', async () => {
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    const load = vi.fn(() => pending);
    const loader = createExpiringLoader({ load, ttlMs: 1000 });

    const first = loader.get('a');
    const second = loader.get('a');
    release('done');

    expect(await Promise.all([first, second])).toEqual(['done', 'done']);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('keeps keys separate', async () => {
    const load = vi.fn(async (key) => key.toUpperCase());
    const loader = createExpiringLoader({ load, ttlMs: 1000 });

    expect(await loader.get('a')).toBe('A');
    expect(await loader.get('b')).toBe('B');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('forgets a failed load so the next call retries', async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(new Error('busy'))
      .mockResolvedValueOnce('recovered');
    const loader = createExpiringLoader({ load, ttlMs: 60_000 });

    await expect(loader.get('a')).rejects.toThrow('busy');
    expect(await loader.get('a')).toBe('recovered');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('treats a synchronous throw in load as a failed load', async () => {
    const load = vi.fn(() => { throw new Error('bad input'); });
    const loader = createExpiringLoader({ load, ttlMs: 1000 });

    await expect(loader.get('a')).rejects.toThrow('bad input');
    expect(loader.size).toBe(0);
  });

  it('drops the least recently loaded key beyond maxKeys', async () => {
    const load = vi.fn(async (key) => key);
    const loader = createExpiringLoader({ load, ttlMs: 60_000, maxKeys: 2 });

    await loader.get('a');
    await loader.get('b');
    await loader.get('c'); // evicts 'a'
    expect(loader.size).toBe(2);

    await loader.get('b'); // still cached
    await loader.get('a'); // loads again
    expect(load.mock.calls.map(([key]) => key)).toEqual(['a', 'b', 'c', 'a']);
  });

  it('rejects invalid options', () => {
    expect(() => createExpiringLoader({ ttlMs: 1000 })).toThrow(TypeError);
    expect(() => createExpiringLoader({ load: async () => 1, ttlMs: 0 })).toThrow(RangeError);
    expect(() => createExpiringLoader({ load: async () => 1, ttlMs: 1000, maxKeys: 0 })).toThrow(RangeError);
  });
});
