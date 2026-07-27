// Estimate->real calibration — the fix for "panel says 62%, provider counts
// 100% and rejects with a 400".
//
// The chars-ratio estimator undercounted a live conversation by ~1.6x, so the
// 94%-of-window compression trigger never fired and Anthropic hard-rejected
// at 1,001,090 > 1,000,000. These tests pin the feedback loop: real usage
// reports tighten the budget; a generous estimate never loosens it.
import { describe, it, expect } from 'vitest';
import {
  manageContext,
  estimateMessagesTokens,
  updateEstimateCalibration,
  extractRealPromptTokens,
  getContextBudget,
} from './contextManager.js';

const bigConversation = (targetEstTokens) => {
  // ~3.125 estimator chars per token; build user/assistant pairs.
  const perMessageChars = 200_000;
  const messages = [{ role: 'system', content: 'You are a test system prompt.' }];
  let est = estimateMessagesTokens(messages);
  let i = 0;
  while (est < targetEstTokens) {
    messages.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: 'x'.repeat(perMessageChars) });
    est = estimateMessagesTokens(messages);
    i++;
  }
  return messages;
};

describe('manageContext with calibration', () => {
  // opus-5: 1M window, reasoning buffer, 0.94 margin -> ~910k budget.
  const { availableTokens } = getContextBudget('claude-opus-5', 'anthropic');

  it('fixture sits below the uncalibrated wall but above the calibrated one', () => {
    const messages = bigConversation(availableTokens * 0.75);
    const est = estimateMessagesTokens(messages);
    expect(est).toBeLessThan(availableTokens);
    expect(est).toBeGreaterThan(availableTokens / 1.6);
  });

  it('does not trim when uncalibrated (the pre-fix behavior)', () => {
    const messages = bigConversation(availableTokens * 0.75);
    const result = manageContext(messages, 'claude-opus-5', [], 'anthropic');
    expect(result.wasManaged).toBe(false);
    expect(result.calibration).toBe(1);
  });

  it('trims the SAME conversation once calibration says the estimator lies low', () => {
    const messages = bigConversation(availableTokens * 0.75);
    const result = manageContext(messages, 'claude-opus-5', [], 'anthropic', { calibration: 1.6 });
    expect(result.wasManaged).toBe(true);
    // Managed estimate must fit the calibrated budget.
    expect(result.managedTokens).toBeLessThanOrEqual(Math.floor(availableTokens / 1.6));
    expect(result.calibration).toBeCloseTo(1.6, 10);
  });

  it('never LOOSENS the budget: sub-1 calibration is clamped to 1', () => {
    const messages = bigConversation(availableTokens * 0.75);
    const generous = manageContext(messages, 'claude-opus-5', [], 'anthropic', { calibration: 0.6 });
    const baseline = manageContext(messages, 'claude-opus-5', [], 'anthropic');
    expect(generous.wasManaged).toBe(false);
    expect(generous.tokenLimit).toBe(baseline.tokenLimit);
    expect(generous.calibration).toBe(1);
  });

  it('clamps runaway calibration at 3x', () => {
    const messages = bigConversation(50_000);
    const result = manageContext(messages, 'claude-opus-5', [], 'anthropic', { calibration: 50 });
    expect(result.calibration).toBe(3);
  });

  it('omitting options is byte-compatible with the old signature', () => {
    const messages = bigConversation(100_000);
    const a = manageContext(messages, 'claude-opus-5', [], 'anthropic');
    const b = manageContext(messages, 'claude-opus-5', [], 'anthropic', {});
    expect(a.tokenLimit).toBe(b.tokenLimit);
    expect(a.wasManaged).toBe(b.wasManaged);
    expect(a.totalRequestTokens).toBe(b.totalRequestTokens);
  });
});

describe('extractRealPromptTokens (every provider usage shape)', () => {
  it('Anthropic: input_tokens is the UNCACHED slice — sum all three', () => {
    expect(extractRealPromptTokens({
      input_tokens: 700, cache_read_input_tokens: 900_000, cache_creation_input_tokens: 100_390,
    })).toBe(1_001_090);
  });

  it('OpenAI Chat Completions: prompt_tokens is already the total', () => {
    expect(extractRealPromptTokens({ prompt_tokens: 120_000, completion_tokens: 900 })).toBe(120_000);
  });

  it('OpenAI Responses: input_tokens is already the total, no creation field', () => {
    expect(extractRealPromptTokens({ input_tokens: 130_000, output_tokens: 800 })).toBe(130_000);
  });

  it('null / empty usage -> 0', () => {
    expect(extractRealPromptTokens(null)).toBe(0);
    expect(extractRealPromptTokens({})).toBe(0);
  });
});

describe('updateEstimateCalibration', () => {
  const usage = (real) => ({ input_tokens: real });

  it('learns the ratio from the first meaningful round', () => {
    expect(updateEstimateCalibration(undefined, usage(1_001_090), 622_200)).toBeCloseTo(1.609, 3);
  });

  it('EMA-blends subsequent rounds so one anomaly cannot whipsaw the budget', () => {
    const first = updateEstimateCalibration(undefined, usage(160_000), 100_000); // 1.6
    const second = updateEstimateCalibration(first, usage(100_000), 100_000);   // 1.0
    expect(second).toBeCloseTo(1.3, 10);
  });

  it('clamps a degenerate report into [0.5, 3]', () => {
    expect(updateEstimateCalibration(undefined, usage(1_000_000), 10_000)).toBe(3);
    // real 10k vs est 1M: ratio 0.01 clamps to the 0.5 floor (still a signal,
    // just bounded so it can never loosen the budget past manageContext's >=1 clamp).
    expect(updateEstimateCalibration(undefined, usage(10_000), 1_000_000)).toBe(0.5);
  });

  it('ignores rounds too small to carry signal, preserving the prior', () => {
    expect(updateEstimateCalibration(1.5, usage(800), 100_000)).toBe(1.5);
    expect(updateEstimateCalibration(1.5, usage(100_000), 800)).toBe(1.5);
    expect(updateEstimateCalibration(1.5, null, 100_000)).toBe(1.5);
    expect(updateEstimateCalibration(undefined, usage(800), 100_000)).toBeUndefined();
  });
});
