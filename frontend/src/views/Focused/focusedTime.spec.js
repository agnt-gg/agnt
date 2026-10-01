import { describe, it, expect, vi, afterEach } from 'vitest';
import { waitUntil, formatNext, timezoneOptions, LOCAL_TZ } from './focusedTime.js';
import { baseName, parentDir, crumbsOf, fileKind, fmtSize } from './focusedFiles.js';

describe('waitUntil', () => {
  afterEach(() => vi.useRealTimers());

  it('resolves at once when already true', async () => {
    await expect(waitUntil(() => true)).resolves.toBe(true);
  });

  it('resolves when the data lands (the in-flight fetch case)', async () => {
    vi.useFakeTimers();
    let ready = false;
    const p = waitUntil(() => ready, 5000);
    vi.advanceTimersByTime(300);
    ready = true;
    vi.advanceTimersByTime(100);
    await expect(p).resolves.toBe(true);
  });

  it('gives up after the timeout instead of hanging the page', async () => {
    vi.useFakeTimers();
    const p = waitUntil(() => false, 1000);
    vi.advanceTimersByTime(1100);
    await expect(p).resolves.toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('times', () => {
  it('formatNext says a time today and a day otherwise', () => {
    const now = new Date('2026-10-01T08:00:00');
    expect(formatNext(new Date('2026-10-01T09:30:00').getTime(), now)).toMatch(/9:30/);
    expect(formatNext(new Date('2026-10-05T09:30:00').getTime(), now)).toMatch(/Oct/);
    expect(formatNext(0, now)).toBe('');
  });

  it('timezoneOptions always includes the current and local zones', () => {
    const z = timezoneOptions('Mars/Olympus');
    expect(z).toContain('Mars/Olympus');
    expect(z).toContain(LOCAL_TZ);
  });
});

describe('files', () => {
  it('paths', () => {
    expect(baseName('a/b/c.md')).toBe('c.md');
    expect(baseName('C:\\x\\y.txt')).toBe('y.txt');
    expect(parentDir('a/b/c.md')).toBe('a/b');
    expect(parentDir('c.md')).toBe('');
    expect(crumbsOf('a/b')).toEqual([{ name: 'a', path: 'a' }, { name: 'b', path: 'a/b' }]);
    expect(crumbsOf('')).toEqual([]);
  });

  it('kinds and sizes', () => {
    expect(fileKind('x.PNG')).toBe('image');
    expect(fileKind('report.pdf')).toBe('pdf');
    expect(fileKind('notes.md')).toBe('text');
    expect(fileKind('Makefile')).toBe('text');
    expect(fmtSize(512)).toBe('512 B');
    expect(fmtSize(2048)).toBe('2.0 KB');
    expect(fmtSize(5 * 1024 ** 2)).toBe('5.0 MB');
    expect(fmtSize(undefined)).toBe('');
  });
});
