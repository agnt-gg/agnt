import { describe, it, expect } from 'vitest';
import { createCacheRoundTracker } from './cacheRoundTracker.js';

// isColdFor gates tool-result aging: a batch may change old history for free
// only when the next request would re-write its whole prompt anyway.
const HOUR = 60 * 60 * 1000;
const request = { provider: 'claude-code', model: 'claude-opus-5-5', messages: [{ role: 'user', content: 'hi' }], tools: [] };

function trackerAt(clock, carried = null) {
  return createCacheRoundTracker({ carried, now: () => clock.t });
}

describe('cacheRoundTracker.isColdFor', () => {
  it('is cold before anything was sent in this conversation', () => {
    expect(trackerAt({ t: 0 }).isColdFor('claude-code', 'claude-opus-5-5', HOUR)).toBe(true);
  });

  it('is warm right after a request to the same model', () => {
    const clock = { t: 1_000 };
    const tracker = trackerAt(clock);
    tracker.stamp(request);
    tracker.observe({ promptTokens: 10 }, HOUR);
    clock.t += 60_000;
    expect(tracker.isColdFor('claude-code', 'claude-opus-5-5', HOUR)).toBe(false);
  });

  it('is cold past the TTL, and for another provider or model', () => {
    const clock = { t: 1_000 };
    const tracker = trackerAt(clock);
    tracker.stamp(request);
    tracker.observe({ promptTokens: 10 }, HOUR);
    expect(tracker.isColdFor('claude-code', 'claude-sonnet-5', HOUR)).toBe(true);
    expect(tracker.isColdFor('openai', 'claude-opus-5-5', HOUR)).toBe(true);
    clock.t += HOUR + 1;
    expect(tracker.isColdFor('claude-code', 'claude-opus-5-5', HOUR)).toBe(true);
  });

  it('carries across turns: the previous turn\'s last request counts', () => {
    const clock = { t: 5_000 };
    const carried = { provider: 'claude-code', model: 'claude-opus-5-5', sentAt: 4_000, messageHashes: [], messageRoles: [], blocks: 0 };
    expect(trackerAt(clock, carried).isColdFor('claude-code', 'claude-opus-5-5', HOUR)).toBe(false);
  });

  it('resolves the TTL itself when none is passed', () => {
    const tracker = trackerAt({ t: 0 });
    expect(typeof tracker.isColdFor('claude-code', 'claude-opus-5-5')).toBe('boolean');
  });
});
