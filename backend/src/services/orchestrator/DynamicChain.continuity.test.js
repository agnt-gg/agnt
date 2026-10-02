/**
 * Keep a conversation on one model, and on the user's own default, unless
 * moving is clearly worth it.
 *
 * Three separate forces, each with its own reason to exist:
 *   cache       money: a warm prefix re-read at the cached rate; leaving it
 *               costs the lost discount plus the new model's write premium
 *   continuity  consistency + hysteresis: the conversation's current model
 *   default     the user's stated choice
 *
 * The pool below is shaped like a real one: a frontier default, a mid model,
 * and a cheap fast model, on three vendors.
 */
import { describe, it, expect } from 'vitest';
import {
  scoreCandidates,
  buildDynamicChain,
  estimateSwitchCost,
  isIncumbent,
  DEFAULT_PREFERENCE,
  BACKGROUND_DEFAULT_PREFERENCE,
} from './DynamicChain.js';
import { classifyIntent, CONVERSATIONAL_ORIGINS } from './routingIntent.js';
import { CHAT_SURFACE_ORIGINS } from '../../models/LlmCallModel.js';

const frontier = {
  provider: 'anthropic', model: 'opus',
  inputCostPer1M: 5, outputCostPer1M: 25,
  contextWindow: 1000000, maxOutputTokens: 64000,
  supportsVision: true, supportsTools: true, reasoning: true,
  cacheReadMult: 0.1, cacheWriteMult: 2.0, cacheKnown: true,
};
const sibling = { ...frontier, model: 'haiku', inputCostPer1M: 1, outputCostPer1M: 5, reasoning: false };
const mid = {
  provider: 'openai', model: 'mid',
  inputCostPer1M: 2.5, outputCostPer1M: 10,
  contextWindow: 400000, maxOutputTokens: 32000,
  supportsVision: true, supportsTools: true, reasoning: true,
  cacheReadMult: 0.5, cacheWriteMult: 1.0, cacheKnown: true,
};
const budget = {
  provider: 'deepseek', model: 'flash',
  inputCostPer1M: 0.3, outputCostPer1M: 1.2,
  contextWindow: 128000, maxOutputTokens: 8000,
  supportsVision: false, supportsTools: true, reasoning: false,
  cacheReadMult: 1.0, cacheWriteMult: 1.0, cacheKnown: false,
};
const pool = [frontier, mid, budget];
const userDefault = { provider: 'anthropic', model: 'opus' };
const chat = (over = {}) => classifyIntent({ origin: 'orchestrator', contextTokens: 40000, hasTools: true, ...over });

const warmOn = (c, tokens = 80000) => ({
  lastProvider: c.provider, lastModel: c.model,
  promptTokens: tokens, cachedTokens: tokens,
  lastCacheReadMult: c.cacheReadMult, lastInputCostPer1M: c.inputCostPer1M,
});

describe('a cache belongs to a MODEL, not a provider', () => {
  const session = warmOn(frontier);

  it('another model on the same provider is not the incumbent', () => {
    expect(isIncumbent(frontier, session)).toBe(true);
    expect(isIncumbent(sibling, session)).toBe(false);
  });

  it('switching to a sibling model costs the lost discount AND the write premium', () => {
    const cost = estimateSwitchCost(sibling, { contextTokens: 80000 }, session);
    const lostRead = (80000 / 1e6) * 5 * 0.9;
    const write = (80000 / 1e6) * 1 * (2.0 - 1);
    expect(cost).toBeCloseTo(lostRead + write, 8);
  });

  it('a session with no recorded model still matches on provider (legacy rows)', () => {
    expect(isIncumbent(sibling, { lastProvider: 'anthropic' })).toBe(true);
  });
});

describe('the user\'s default is heavily weighted', () => {
  it('balanced: a new conversation stays on the default despite cheaper options', () => {
    const scored = scoreCandidates(pool, { intent: chat(), lambda: 0.5, preferred: userDefault });
    expect(scored[0].provider).toBe('anthropic');
    expect(scored[0].reason).toBe('your default model');
  });

  it('without the preference, balanced would have left it \u2014 the bonus is doing the work', () => {
    const scored = scoreCandidates(pool, { intent: chat(), lambda: 0.5 });
    expect(scored[0].provider).not.toBe('anthropic');
  });

  it('"save money" may still leave the default for a far cheaper capable model \u2014 the flexibility the dial promises', () => {
    const scored = scoreCandidates(pool, { intent: chat(), lambda: 0.85, preferred: userDefault });
    expect(scored[0].provider).toBe('deepseek');
  });

  it('background work only tie-breaks toward the default; cost leads', () => {
    expect(BACKGROUND_DEFAULT_PREFERENCE).toBeLessThan(DEFAULT_PREFERENCE);
    const scored = scoreCandidates(pool, {
      intent: classifyIntent({ origin: 'title', contextTokens: 600, outputTokens: 40 }),
      lambda: 0.5,
      preferred: userDefault,
    });
    expect(scored[0].provider).toBe('deepseek');
  });
});

describe('a conversation stays on its model', () => {
  it('mid-conversation on a warm default, even "save money" stays put', () => {
    const scored = scoreCandidates(pool, {
      intent: chat({ contextTokens: 80000 }), lambda: 0.85, session: warmOn(frontier), preferred: userDefault,
    });
    expect(scored[0].provider).toBe('anthropic');
    expect(scored[0].reason).toBe('cache-warm');
  });

  it('a conversation that started on a routed model stays there instead of drifting back and forth', () => {
    // Routed to mid on turn 1; default is opus. Turn 2 must not flip to opus
    // (that would pay a cold turn for nothing) or to the budget model.
    const scored = scoreCandidates(pool, {
      intent: chat({ contextTokens: 80000 }), lambda: 0.5, session: warmOn(mid), preferred: userDefault,
    });
    expect(scored[0].model).toBe('mid');
  });

  it('continuity survives the cache expiring', () => {
    const cold = { ...warmOn(mid), cachedTokens: 0, cacheExpired: true };
    const scored = scoreCandidates([mid, budget], { intent: chat(), lambda: 0.5, session: cold });
    expect(scored[0].model).toBe('mid');
    expect(scored[0].reason).toBe('conversation continuity');
  });

  it('an expired cache charges no switch cost', () => {
    const cold = { ...warmOn(frontier), cachedTokens: 0 };
    expect(estimateSwitchCost(budget, { contextTokens: 80000 }, cold)).toBe(0);
  });

  it('a capability the incumbent lacks still forces a move (eligibility is hard)', () => {
    const chain = buildDynamicChain({
      intent: chat({ hasImages: true }), candidates: pool, policy: { lambda: 0.5 },
      session: warmOn(budget), hint: userDefault,
    });
    expect(chain[0].provider).not.toBe('deepseek');
  });
});

describe('the chain builder applies the preference', () => {
  it('buildDynamicChain puts the default first on a new balanced conversation', () => {
    const chain = buildDynamicChain({ intent: chat(), candidates: pool, policy: { lambda: 0.5 }, hint: userDefault });
    expect(chain[0]).toMatchObject({ provider: 'anthropic', model: 'opus' });
  });
});

describe('conversational origins', () => {
  it('equal the chat surfaces plus legacy chat', () => {
    expect([...CONVERSATIONAL_ORIGINS].sort()).toEqual([...CHAT_SURFACE_ORIGINS, 'chat'].sort());
  });

  it('background origins are not conversational; unknown ones are (the safe side)', () => {
    for (const origin of ['title', 'insight', 'system', 'goal_eval', 'goal_task', 'workflow_node', 'compaction']) {
      expect(classifyIntent({ origin }).conversational).toBe(false);
    }
    expect(classifyIntent({ origin: 'orchestrator' }).conversational).toBe(true);
    expect(classifyIntent({ origin: 'something-new' }).conversational).toBe(true);
  });
});
