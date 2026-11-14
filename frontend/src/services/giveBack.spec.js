import { describe, it, expect, vi } from 'vitest';
import { X_FOLLOW_URL, GITHUB_REPO_URL, copyToClipboard, fetchStarCount, flashGift, formatStarCount, roundCredits, usedPhrase } from './giveBack.js';

const TRIAL = { source: 'agnt_trial', trial: true, includedCredits: 1_000_000, usedCredits: 0, remainingCredits: 1_000_000 };

function memoryStorage(seed = {}) {
  const items = new Map(Object.entries(seed));
  return { getItem: (key) => (items.has(key) ? items.get(key) : null), setItem: (key, value) => items.set(key, String(value)), items };
}
const github = (count, ok = true) => vi.fn(async () => ({ ok, status: ok ? 200 : 403, json: async () => ({ stargazers_count: count }) }));

describe('the links', () => {
  it('follow AGNT on X and open the public repository', () => {
    expect(X_FOLLOW_URL).toBe('https://x.com/intent/follow?screen_name=agnt_gg');
    expect(GITHUB_REPO_URL).toBe('https://github.com/agnt-gg/agnt');
  });
});

describe('the gift', () => {
  it('is the trial credits an account still holds', () => {
    expect(flashGift(TRIAL)).toEqual({ credits: 1_000_000, headline: '1M' });
    expect(flashGift({ ...TRIAL, usedCredits: 400_000, remainingCredits: 600_000 })).toEqual({ credits: 1_000_000, headline: '1M' });
  });

  it('is nothing once spent, for a paid allowance, or for a computer whose trial went elsewhere', () => {
    expect(flashGift({ ...TRIAL, usedCredits: 1_000_000, remainingCredits: 0 })).toBeNull();
    expect(flashGift({ ...TRIAL, trial: false, source: 'agnt_subscription' })).toBeNull();
    expect(flashGift({ source: 'payg', trial: false, includedCredits: 0, remainingCredits: 0 })).toBeNull();
    expect(flashGift(null)).toBeNull();
  });

  it('rounds the headline without a trailing zero', () => {
    expect([1_000_000, 2_500_000, 15_000_000, 450_000].map(roundCredits)).toEqual(['1M', '2.5M', '15M', '450k']);
  });

  it('says how much is used without a credit count', () => {
    const at = (share) => usedPhrase({ includedCredits: 1_000_000, usedCredits: share * 1_000_000 });
    expect([at(0), at(0.004), at(0.18), at(0.996), at(1)]).toEqual(['less than 1%', 'less than 1%', 'about 18%', 'about 99%', 'all']);
  });
});

describe('the star count', () => {
  it('formats rounded down, so it never overstates', () => {
    expect([576, 999, 1000, 1234, 1999, 12_345, -1, NaN, 1.5].map(formatStarCount)).toEqual(['576', '999', '1k', '1.2k', '1.9k', '12k', '', '', '']);
  });

  it('asks GitHub once, then answers from the cache for six hours', async () => {
    const storage = memoryStorage();
    const fetchImpl = github(576);
    let now = 1_000_000;
    expect(await fetchStarCount({ fetchImpl, storage, now: () => now })).toBe(576);
    now += 5 * 60 * 60 * 1000;
    expect(await fetchStarCount({ fetchImpl, storage, now: () => now })).toBe(576);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.github.com/repos/agnt-gg/agnt');
    now += 2 * 60 * 60 * 1000;
    const later = github(600);
    expect(await fetchStarCount({ fetchImpl: later, storage, now: () => now })).toBe(600);
  });

  it('shares one request between callers asking at the same time', async () => {
    const fetchImpl = github(42);
    const storage = memoryStorage();
    const counts = await Promise.all([fetchStarCount({ fetchImpl, storage }), fetchStarCount({ fetchImpl, storage })]);
    expect(counts).toEqual([42, 42]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('falls back to the last count seen when GitHub refuses, and to null with none', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const stale = memoryStorage({ 'agnt:github-stars': JSON.stringify({ count: 500, at: 0 }) });
    expect(await fetchStarCount({ fetchImpl: github(0, false), storage: stale, now: () => 10 * 60 * 60 * 1000 })).toBe(500);
    expect(await fetchStarCount({ fetchImpl: vi.fn().mockRejectedValue(new Error('offline')), storage: memoryStorage() })).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('ignores an answer that is not a count, and a hand-edited cache', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const storage = memoryStorage({ 'agnt:github-stars': '{"count":"lots","at":1}' });
    expect(await fetchStarCount({ fetchImpl: github('lots'), storage })).toBeNull();
    warn.mockRestore();
  });
});

describe('the clipboard', () => {
  it('uses the clipboard when it takes the text', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    expect(await copyToClipboard('https://agnt.gg/invite/MAYA', { clipboard: { writeText }, doc: document })).toBe(true);
    expect(writeText).toHaveBeenCalledWith('https://agnt.gg/invite/MAYA');
  });

  it('copies a selection when the clipboard refuses, and says when that fails too', async () => {
    const refusing = { writeText: vi.fn().mockRejectedValue(new Error('not focused')) };
    document.execCommand = vi.fn(() => true);
    expect(await copyToClipboard('x', { clipboard: refusing, doc: document })).toBe(true);
    expect(document.querySelector('textarea')).toBeNull();
    document.execCommand = vi.fn(() => false);
    expect(await copyToClipboard('x', { clipboard: refusing, doc: document })).toBe(false);
    expect(await copyToClipboard('x', { clipboard: undefined, doc: undefined })).toBe(false);
  });
});
