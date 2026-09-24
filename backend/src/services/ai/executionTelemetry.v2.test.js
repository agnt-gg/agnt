import { describe, it, expect } from 'vitest';
import { normalizeExecutionTelemetry, readExecutionTelemetry, MAX_CACHE_ROUNDS } from './executionTelemetry.js';

const round = (overrides = {}) => ({
  round: 1, firstOfTurn: true, msSincePrev: null, promptTokens: 20000, uncached: 10, read: 0,
  write5m: 0, write1h: 19990, output: 40, lostTokens: 0, historyLength: 2, blocksAdded: null,
  toolsFp: 'abcdef012345', systemFp: '0123456789ab', cause: 'cold', divergeAt: null, divergeRole: null,
  ...overrides,
});
const envelope = (cacheRounds, version = 2) => ({
  version, outcome: 'completed', requestMetrics: null, usage: null, usageCoverage: 'unknown', toolCalls: null, cacheRounds,
});

describe('execution telemetry v2 (cache rounds)', () => {
  it('round-trips a valid envelope unchanged', () => {
    const t = envelope([round(), round({ round: 2, firstOfTurn: false, msSincePrev: 900, read: 19990, cause: 'ok', blocksAdded: -3 })]);
    expect(normalizeExecutionTelemetry(t)).toEqual(normalizeExecutionTelemetry(normalizeExecutionTelemetry(t)));
    expect(normalizeExecutionTelemetry(t).cacheRounds).toHaveLength(2);
  });

  it('survives the string round-trip the database uses', () => {
    const t = normalizeExecutionTelemetry(envelope([round()]));
    expect(readExecutionTelemetry(JSON.stringify(t))).toEqual({ availability: 'available', value: t });
  });

  it('leaves v1 envelopes exactly as they were', () => {
    const v1 = normalizeExecutionTelemetry({ version: 1, outcome: 'completed', usage: null, toolCalls: null });
    expect(v1.version).toBe(1);
    expect('cacheRounds' in v1).toBe(false);
  });

  it('refuses cache rounds on a v1 envelope', () => {
    expect(() => normalizeExecutionTelemetry(envelope([round()], 1))).toThrow();
  });

  it('strips fields outside the allowlist, so no content can ride along', () => {
    const t = normalizeExecutionTelemetry(envelope([{ ...round(), prompt: 'SECRET', divergeText: 'SECRET' }]));
    expect(JSON.stringify(t)).not.toContain('SECRET');
  });

  it.each([
    ['unknown cause', { cause: 'because' }],
    ['non-hex fingerprint', { toolsFp: 'SECRET-TEXT!' }],
    ['negative count', { read: -1 }],
    ['fractional count', { promptTokens: 1.5 }],
    ['out-of-order round', { round: 2 }],
    ['non-boolean firstOfTurn', { firstOfTurn: 'yes' }],
    ['unknown role', { divergeRole: 'narrator', divergeAt: 0 }],
  ])('rejects %s', (_label, bad) => {
    expect(() => normalizeExecutionTelemetry(envelope([round(bad)]))).toThrow();
  });

  it('refuses more rounds than the cap', () => {
    const rounds = Array.from({ length: MAX_CACHE_ROUNDS + 1 }, (_, i) => round({ round: i + 1 }));
    expect(() => normalizeExecutionTelemetry(envelope(rounds))).toThrow();
  });
});
