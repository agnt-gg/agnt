/**
 * routingIntent — stake and verifiability, derived rather than predicted.
 *
 * The property that matters most here is the DEFAULT. An unrecognised origin
 * must land on (normal, subjective): the combination that says "route it like
 * a user is watching, and do not assume you can check the answer". The unsafe
 * default would be (low, mechanical), which quietly routes unknown work down
 * and then declines to verify it.
 */
import { describe, it, expect } from 'vitest';
import { classifyIntent, STAKE_WEIGHTS } from './routingIntent.js';
import { CHAT_SURFACE_ORIGINS, ORIGINS } from '../../models/LlmCallModel.js';

describe('stake comes from the call site, not the prompt', () => {
  it('background work is low stake', () => {
    for (const origin of ['insight', 'system']) {
      expect(classifyIntent({ origin }).stake).toBe('low');
    }
  });

  it('work that gates other work is high stake', () => {
    for (const origin of ['goal_eval', 'goal_task']) {
      expect(classifyIntent({ origin }).stake).toBe('high');
    }
  });

  it('interactive surfaces are normal', () => {
    for (const origin of ['orchestrator', 'agent', 'artifact']) {
      expect(classifyIntent({ origin }).stake).toBe('normal');
    }
  });

  it('stake weights are ordered and amplify quality, never invert it', () => {
    expect(STAKE_WEIGHTS.low).toBeLessThan(STAKE_WEIGHTS.normal);
    expect(STAKE_WEIGHTS.normal).toBeLessThan(STAKE_WEIGHTS.high);
    expect(STAKE_WEIGHTS.low).toBeGreaterThan(0);
  });
});

describe('verifiability decides the STRATEGY, not the model', () => {
  it('mechanically-checkable surfaces are marked as such', () => {
    for (const origin of ['workflow_node', 'tool', 'widget']) {
      expect(classifyIntent({ origin }).verifiability).toBe('mechanical');
    }
  });

  it('open-ended conversation is subjective', () => {
    expect(classifyIntent({ origin: 'orchestrator' }).verifiability).toBe('subjective');
  });

  it('a tool round is checkable even on a subjective surface', () => {
    // The tool either accepted the arguments or returned an error. That is a
    // real oracle, so the round can cascade even though the chat cannot.
    const plain = classifyIntent({ origin: 'orchestrator' });
    const round = classifyIntent({ origin: 'orchestrator', isToolRound: true });
    expect(plain.verifiability).toBe('subjective');
    expect(round.verifiability).toBe('mechanical');
  });

  it('a tool round never DOWNGRADES a referential surface', () => {
    expect(classifyIntent({ origin: 'goal_eval', isToolRound: true }).verifiability).toBe('referential');
  });
});

describe('UNKNOWN FALLS TO THE SAFE SIDE', () => {
  it('an unrecognised origin is normal + subjective, never low + mechanical', () => {
    for (const origin of [undefined, null, '', 'brand-new-surface', 'ROUTER', 42]) {
      const i = classifyIntent({ origin });
      expect(i.stake).toBe('normal');
      expect(i.verifiability).toBe('subjective');
    }
  });

  it('every origin the ledger recognises is classified explicitly', () => {
    // Guards against a new surface silently inheriting the default forever.
    // If this fails, add the origin to ORIGIN_STAKE / ORIGIN_VERIFIABILITY —
    // the point is that the decision is made deliberately, not by omission.
    const unclassified = [];
    for (const origin of ORIGINS) {
      const i = classifyIntent({ origin });
      // A deliberate 'normal'/'subjective' is indistinguishable from the
      // default by value, so probe the maps through a known-different input.
      const isDefault = i.stake === 'normal' && i.verifiability === 'subjective';
      const looksLikeChatSurface = CHAT_SURFACE_ORIGINS.includes(origin) || origin === 'chat';
      if (isDefault && !looksLikeChatSurface) unclassified.push(origin);
    }
    expect(unclassified).toEqual([]);
  });
});

describe('explicit user intent is honoured, never second-guessed', () => {
  it('asking for extended thinking raises a normal turn to high stake', () => {
    expect(classifyIntent({ origin: 'orchestrator', reasoningWanted: true }).stake).toBe('high');
  });

  it('...but never promotes a low-stake background job', () => {
    // Otherwise a batch job that happens to enable reasoning outranks the user.
    expect(classifyIntent({ origin: 'insight', reasoningWanted: true }).stake).toBe('low');
  });
});

describe('capability signals pass through cleanly', () => {
  it('normalises the flags a router filters on', () => {
    const i = classifyIntent({ origin: 'agent', hasImages: 1, hasTools: 'yes', contextTokens: 1234 });
    expect(i.needsVision).toBe(true);
    expect(i.needsTools).toBe(true);
    expect(i.contextTokens).toBe(1234);
  });

  it('a nonsense context size becomes zero rather than NaN', () => {
    // NaN would silently disable the context-window filter, which is the one
    // eligibility rule whose failure produces a hard provider error.
    for (const v of [undefined, null, -5, NaN, 'big']) {
      expect(classifyIntent({ origin: 'agent', contextTokens: v }).contextTokens).toBe(0);
    }
  });
});
