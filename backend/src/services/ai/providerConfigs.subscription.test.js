// Subscription vs metered providers.
//
// claude-code and openai-codex inherit their parent's per-token prices via
// PROVIDER_METADATA_FALLBACK, so the cost pipeline produces real dollar
// figures for what is actually a flat-rate seat. The figures stay (they answer
// "what would this have cost on the API?") but must be labelled notional
// rather than presented as a bill.
import { describe, it, expect } from 'vitest';
import { isSubscriptionProvider, SUBSCRIPTION_PROVIDERS, getModelCost } from './providerConfigs.js';

describe('isSubscriptionProvider', () => {
  it('flags CLI/OAuth seats', () => {
    expect(isSubscriptionProvider('claude-code')).toBe(true);
    expect(isSubscriptionProvider('openai-codex')).toBe(true);
    expect(isSubscriptionProvider('gemini-cli')).toBe(true);
    expect(isSubscriptionProvider('antigravity')).toBe(true);
    expect(isSubscriptionProvider('kimi-code')).toBe(true);
  });

  it('does NOT flag metered API-key providers', () => {
    for (const p of ['anthropic', 'openai', 'gemini', 'groq', 'deepseek', 'grokai', 'zai']) {
      expect(isSubscriptionProvider(p)).toBe(false);
    }
  });

  it('is case-insensitive and null-safe', () => {
    expect(isSubscriptionProvider('Claude-Code')).toBe(true);
    expect(isSubscriptionProvider(null)).toBe(false);
    expect(isSubscriptionProvider(undefined)).toBe(false);
    expect(isSubscriptionProvider('')).toBe(false);
  });

  it('every flagged provider is distinct from its metered parent', () => {
    // The bug being guarded: claude-code is priced identically to anthropic,
    // so nothing in the cost numbers themselves reveals it is a seat.
    expect(SUBSCRIPTION_PROVIDERS.has('anthropic')).toBe(false);
    const seat = getModelCost('claude-code', 'claude-opus-5', 1_000_000, 0);
    const metered = getModelCost('anthropic', 'claude-opus-5', 1_000_000, 0);
    expect(seat.totalCost).toBe(metered.totalCost);
    expect(isSubscriptionProvider('claude-code')).not.toBe(isSubscriptionProvider('anthropic'));
  });
});

describe('mixed-model pricing (the case that produced a phantom 2x bug)', () => {
  // A single conversation spanning claude-opus-5 and claude-fable-5 costs
  // exactly 2x per token on the fable turns. Recomputing a conversation with
  // one hardcoded model therefore yields a clean "2.00x discrepancy" that
  // looks exactly like a double-counting bug and is not one.
  it('claude-fable-5 is exactly 2x claude-opus-5 per token', () => {
    const opus = getModelCost('claude-code', 'claude-opus-5', 1_000_000, 10_000);
    const fable = getModelCost('claude-code', 'claude-fable-5', 1_000_000, 10_000);
    expect(fable.totalCost / opus.totalCost).toBeCloseTo(2, 10);
  });

  it('per-row pricing reconciles exactly where a single-model assumption does not', () => {
    const rows = [
      { model: 'claude-opus-5', input: 1_000_000, output: 10_000 },
      { model: 'claude-fable-5', input: 1_000_000, output: 10_000 },
    ];
    const perRow = rows.reduce(
      (a, r) => a + getModelCost('claude-code', r.model, r.input, r.output).totalCost, 0);
    const assumedOne = rows.reduce(
      (a, r) => a + getModelCost('claude-code', 'claude-opus-5', r.input, r.output).totalCost, 0);
    expect(perRow).not.toBeCloseTo(assumedOne, 4);
    expect(perRow).toBeGreaterThan(assumedOne);
  });
});
