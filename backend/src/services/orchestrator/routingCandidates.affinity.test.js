import { describe, it, expect, vi, beforeEach } from 'vitest';

// A plain stub rather than vi.fn(): vitest reports a vi.fn() whose
// implementation rejects as a test failure even when the code under test
// handles the rejection, which is exactly the path one case below exercises.
let lastCallImpl = async () => null;
vi.mock('../../models/LlmCallModel.js', () => ({
  default: { lastCallForConversation: (...args) => lastCallImpl(...args), reliabilityByModel: async () => [] },
}));

const { getSessionAffinity, parseLedgerTimestamp } = await import('./routingCandidates.js');

const NOW = Date.parse('2026-10-01T12:00:00Z');
const minutesAgo = (m) => new Date(NOW - m * 60_000).toISOString().replace('T', ' ').slice(0, 19);
const returns = (row) => { lastCallImpl = async () => row; };

describe('parseLedgerTimestamp', () => {
  it('reads SQLite CURRENT_TIMESTAMP as UTC, not local time', () => {
    expect(parseLedgerTimestamp('2026-10-01 12:00:00')).toBe(NOW);
  });
  it('accepts ISO with a zone, and rejects junk', () => {
    expect(parseLedgerTimestamp('2026-10-01T12:00:00Z')).toBe(NOW);
    expect(parseLedgerTimestamp('nope')).toBeNull();
    expect(parseLedgerTimestamp(null)).toBeNull();
  });
});

describe('getSessionAffinity — warm means the same model, inside its cache lifetime', () => {
  beforeEach(() => returns(null));

  it('reports the model, the conversation size, and a warm prefix', async () => {
    returns({ provider: 'anthropic', model: 'claude-opus-5', input_tokens: 2000, cache_read_tokens: 78000, ts: minutesAgo(10) });
    const s = await getSessionAffinity('u', 'c', { now: NOW });
    expect(s).toMatchObject({ lastProvider: 'anthropic', lastModel: 'claude-opus-5', promptTokens: 80000, cachedTokens: 80000, cacheExpired: false, lastCacheReadMult: 0.1 });
  });

  it('past the provider\'s cache lifetime the prefix is cold, but size and model remain', async () => {
    // Anthropic: AGNT requests the 1-hour cache.
    returns({ provider: 'anthropic', model: 'claude-opus-5', input_tokens: 2000, cache_read_tokens: 78000, ts: minutesAgo(61) });
    const s = await getSessionAffinity('u', 'c', { now: NOW });
    expect(s).toMatchObject({ lastModel: 'claude-opus-5', promptTokens: 80000, cachedTokens: 0, cacheExpired: true });
  });

  it('uses each provider\'s own lifetime (OpenAI idle eviction is 5 minutes)', async () => {
    // gpt-4o: not in the 24h extended-retention family, not GPT-5.6+.
    returns({ provider: 'openai', model: 'gpt-4o', input_tokens: 50000, cache_read_tokens: 0, ts: minutesAgo(6) });
    expect((await getSessionAffinity('u', 'c', { now: NOW })).cachedTokens).toBe(0);
  });

  it('an extended-retention model stays warm far longer', async () => {
    returns({ provider: 'openai', model: 'gpt-4.1', input_tokens: 50000, cache_read_tokens: 0, ts: minutesAgo(6) });
    expect((await getSessionAffinity('u', 'c', { now: NOW })).cachedTokens).toBe(50000);
  });

  it('an unknown lifetime is not assumed expired', async () => {
    returns({ provider: 'deepseek', model: 'x', input_tokens: 9000, cache_read_tokens: 0, ts: minutesAgo(600) });
    expect((await getSessionAffinity('u', 'c', { now: NOW })).cachedTokens).toBe(9000);
  });

  it('no conversation, no row, or a failing read are all an empty session', async () => {
    expect(await getSessionAffinity('u', null)).toEqual({});
    returns(null);
    expect(await getSessionAffinity('u', 'c')).toEqual({});
    lastCallImpl = async () => { throw new Error('db'); };
    expect(await getSessionAffinity('u', 'c')).toEqual({});
  });
});
