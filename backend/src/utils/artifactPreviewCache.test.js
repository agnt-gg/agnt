import { describe, it, expect, vi } from 'vitest';
import { createPreviewPlanCache, previewPlanKey } from './artifactPreviewCache.js';

const plan = (chars, tag = 'x') => ({ html: tag.repeat(chars), reporterAt: 0 });

describe('preview plan cache', () => {
  it('computes once per key and serves repeats from memory', async () => {
    const cache = createPreviewPlanCache();
    const compute = vi.fn(async () => plan(10));
    const first = await cache.obtain('k', compute);
    expect(await cache.obtain('k', compute)).toBe(first);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('runs a single computation for concurrent requests', async () => {
    const cache = createPreviewPlanCache();
    let release;
    const compute = vi.fn(() => new Promise((resolve) => { release = () => resolve(plan(5)); }));
    const waiting = [cache.obtain('k', compute), cache.obtain('k', compute), cache.obtain('k', compute)];
    await Promise.resolve();
    release();
    const results = await Promise.all(waiting);
    expect(compute).toHaveBeenCalledTimes(1);
    expect(new Set(results).size).toBe(1);
  });

  it('does not store a failure', async () => {
    const cache = createPreviewPlanCache();
    await expect(cache.obtain('k', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(await cache.obtain('k', async () => plan(3))).toEqual(plan(3));
  });

  it('evicts the least recently used entry past the entry limit', async () => {
    const cache = createPreviewPlanCache({ maxEntries: 2, maxChars: 1000 });
    await cache.obtain('a', async () => plan(1));
    await cache.obtain('b', async () => plan(1));
    await cache.obtain('a', async () => plan(1)); // a is now the most recent
    await cache.obtain('c', async () => plan(1));
    const recompute = vi.fn(async () => plan(1));
    await cache.obtain('a', recompute);
    expect(recompute).not.toHaveBeenCalled();
    await cache.obtain('b', recompute);
    expect(recompute).toHaveBeenCalledTimes(1);
  });

  it('stays within its character budget and never stores an oversized plan', async () => {
    const cache = createPreviewPlanCache({ maxEntries: 10, maxChars: 100 });
    await cache.obtain('a', async () => plan(60));
    await cache.obtain('b', async () => plan(60));
    expect(cache.chars).toBeLessThanOrEqual(100);
    expect(cache.size).toBe(1);
    await cache.obtain('huge', async () => plan(500));
    expect(cache.size).toBe(1);
    expect(cache.chars).toBe(60);
  });

  it('keys on the file revision, so an edit is never served stale', () => {
    const stat = { size: 10, mtimeMs: 1, ctimeMs: 1 };
    const key = previewPlanKey('C:/a.html', stat, '/base', '/api/local-preview/');
    expect(previewPlanKey('C:/a.html', { ...stat, mtimeMs: 2 }, '/base', '/api/local-preview/')).not.toBe(key);
    expect(previewPlanKey('C:/a.html', { ...stat, ctimeMs: 2 }, '/base', '/api/local-preview/')).not.toBe(key);
    expect(previewPlanKey('C:/a.html', { ...stat, size: 11 }, '/base', '/api/local-preview/')).not.toBe(key);
    expect(previewPlanKey('C:/a.html', stat, undefined, '/api/local-preview/')).not.toBe(key);
  });
});
