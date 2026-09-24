import { describe, it, expect } from 'vitest';
import { summarizeCacheRounds } from './cacheBreakReport.js';

const round = (n, cause, counts) => ({
  round: n, firstOfTurn: n === 1, msSincePrev: n === 1 ? null : 1000, promptTokens: 1000, uncached: 0, read: 0,
  write5m: 0, write1h: 0, output: 1, lostTokens: 0, historyLength: 1, blocksAdded: null,
  toolsFp: 'aaaaaaaaaaaa', systemFp: 'bbbbbbbbbbbb', cause, divergeAt: null, divergeRole: null, ...counts,
});
const row = (provider, rounds) => ({
  provider,
  execution_telemetry: JSON.stringify({ version: 2, outcome: 'completed', requestMetrics: null, usage: null, usageCoverage: 'unknown', toolCalls: null, cacheRounds: rounds }),
});

describe('summarizeCacheRounds', () => {
  it('ranks causes by premium over read price, with the write rate by TTL', () => {
    const r = summarizeCacheRounds([
      row('Claude-Code', [
        round(1, 'tools_changed', { write1h: 1000, lostTokens: 900 }),
        round(2, 'ok', { read: 1000, write5m: 100 }),
      ]),
    ]);
    expect(r.executions).toBe(1);
    const [top, second] = r.causes;
    expect(top).toMatchObject({ cause: 'tools_changed', rounds: 1, writeTokens: 1000, lostTokens: 900, premium: 1900 });
    expect(second).toMatchObject({ cause: 'ok', premium: 115 });
    expect(top.premiumShare + second.premiumShare).toBeCloseTo(100, 0);
  });

  it('prices providers without explicit writes as uncached input', () => {
    const r = summarizeCacheRounds([row('OpenAI-Codex', [round(1, 'unexplained_miss', { uncached: 1000 })])]);
    expect(r.causes[0]).toMatchObject({ cause: 'unexplained_miss', premium: 900 });
  });

  it('skips v1, missing and corrupt telemetry rather than guessing', () => {
    const r = summarizeCacheRounds([
      { provider: 'x', execution_telemetry: null },
      { provider: 'x', execution_telemetry: 'not json' },
      { provider: 'x', execution_telemetry: JSON.stringify({ version: 1, outcome: 'completed' }) },
    ]);
    expect(r).toEqual({ executions: 0, skipped: 3, totalPremium: 0, causes: [] });
  });
});
