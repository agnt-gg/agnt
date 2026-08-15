// Subscription vs metered providers.
//
// claude-code and openai-codex inherit their parent's per-token prices via
// PROVIDER_METADATA_FALLBACK, so the cost pipeline produces real dollar
// figures for what is actually a flat-rate seat. The figures stay (they answer
// "what would this have cost on the API?") but must be labelled notional
// rather than presented as a bill.
import { describe, it, expect } from 'vitest';
import {
  isSubscriptionProvider,
  SUBSCRIPTION_PROVIDERS,
  SUBSCRIPTION_NOTIONAL_USD_PER_1M,
  notionalSeatCostPer1M,
  getModelCost,
} from './providerConfigs.js';

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

describe('notionalSeatCostPer1M — opportunity cost the router uses for seats', () => {
  // The router used to price seats at 0, which meant every routing turn piled
  // onto Claude Code / Kimi Code / Codex until their weekly quotas burned out
  // AND collapsed the policy dial (save/balanced/quality all returned the
  // same answer when a seat was in the pool). These are the sourced worst-
  // case $/M-tokens the router pretends each seat costs. See the header
  // comment on SUBSCRIPTION_NOTIONAL_USD_PER_1M for the derivations.

  it('every subscription provider has an explicit entry (no silent-zero seats)', () => {
    // Enforced at test time: adding a new provider to SUBSCRIPTION_PROVIDERS
    // without also entering it in the notional map would silently give it
    // "infinite" savings again — the exact regression this whole change
    // exists to prevent.
    for (const seat of SUBSCRIPTION_PROVIDERS) {
      expect(
        SUBSCRIPTION_NOTIONAL_USD_PER_1M.has(seat),
        `${seat} is a subscription seat with no notional rate — add it to SUBSCRIPTION_NOTIONAL_USD_PER_1M`
      ).toBe(true);
    }
  });

  it('the sourced numbers are what the research produced', () => {
    // If any of these move, update the header comment WITH THE NEW SOURCE.
    // These are not tunables — they are cited worst-case throughputs from
    // vendor docs. See providerConfigs.js for per-row citations.
    expect(notionalSeatCostPer1M('claude-code')).toBe(0.60);
    expect(notionalSeatCostPer1M('openai-codex')).toBe(0.40);
    expect(notionalSeatCostPer1M('kimi-code')).toBe(0.10);
    expect(notionalSeatCostPer1M('cursor-cli')).toBe(0.50);
  });

  it('free tiers are literally zero (real free, not a paid seat)', () => {
    // Gemini CLI (60 req/min, 1000 req/day free) and Antigravity (Google
    // DeepMind preview) genuinely have no paid seat behind them. Zero is a
    // real number that wins comparisons — which is correct behaviour.
    expect(notionalSeatCostPer1M('gemini-cli')).toBe(0);
    expect(notionalSeatCostPer1M('antigravity')).toBe(0);
  });

  it('an unknown-quota seat (grok-build) returns null, not zero', () => {
    // xAI publishes no usage accounting for the grok-build CLI seat. Rather
    // than invent a rate we would silently be wrong about, this returns null
    // so DynamicChain.estimateCost takes the unknown-cost path (pool median)
    // and a metered competitor can beat it on price. Zero here would
    // reintroduce the bug the whole file exists to fix.
    expect(notionalSeatCostPer1M('grok-build')).toBeNull();
  });

  it('returns null for anything that is not a subscription provider', () => {
    // Metered API providers must never accidentally hit the seat pricing path.
    for (const p of ['anthropic', 'openai', 'gemini', 'grokai', 'groq', 'deepseek']) {
      expect(notionalSeatCostPer1M(p)).toBeNull();
    }
    expect(notionalSeatCostPer1M(null)).toBeNull();
    expect(notionalSeatCostPer1M(undefined)).toBeNull();
    expect(notionalSeatCostPer1M('')).toBeNull();
  });

  it('is case-insensitive, matching isSubscriptionProvider', () => {
    expect(notionalSeatCostPer1M('Claude-Code')).toBe(0.60);
    expect(notionalSeatCostPer1M('KIMI-CODE')).toBe(0.10);
  });

  it('every notional rate is 10x cheaper than the metered API', () => {
    // The invariant Nathan asked me to enforce: seat token is roughly one
    // order of magnitude below the parent's per-token API rate. This is why
    // the router still prefers the seat under "save money" — the notional
    // cost is small, just not free.
    //
    // Cross-check anchored to CHEAP-END API blended rates the header cites:
    //   claude-code ($6/M blended Sonnet) vs $0.60 notional → 10x
    //   openai-codex ($2.5/M blended gpt-5) vs $0.40 notional → 6x
    //   kimi-code   ($1.2/M blended K2) vs $0.10 notional → 12x
    //   cursor-cli  ($4/M blended cursor/gpt-5) vs $0.50 notional → 8x
    // Range 5-15x. If the API rate moves, review the notional — do not
    // narrow this range to hide a stale number.
    const cases = [
      { seat: 'claude-code', api: 6.0 },
      { seat: 'openai-codex', api: 2.5 },
      { seat: 'kimi-code', api: 1.2 },
      { seat: 'cursor-cli', api: 4.0 },
    ];
    for (const { seat, api } of cases) {
      const notional = notionalSeatCostPer1M(seat);
      const ratio = api / notional;
      expect(ratio, `${seat} notional $${notional}/M vs API $${api}/M — ratio ${ratio.toFixed(1)}x`).toBeGreaterThanOrEqual(5);
      expect(ratio, `${seat} notional $${notional}/M vs API $${api}/M — ratio ${ratio.toFixed(1)}x`).toBeLessThanOrEqual(15);
    }
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
