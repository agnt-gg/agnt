import { describe, it, expect } from 'vitest';
import { FIRST_RUN_SUBSCRIPTION_ORDER } from '@/store/app/aiProvider.js';
import {
  AHA_PROMPT,
  FIRST_ASK_PROMPT,
  HERO_PLAN_IDS,
  SETUP_STEPS,
  allDone,
  finishOffer,
  isPhoneLinked,
  nextStep,
  phoneEligible,
  planTiles,
  setupStatus,
} from './firstRunSetup.js';

const record = (id) => ({ id, name: id, icon: id, categories: ['AI'], connectionType: 'oauth' });

describe('the three steps', () => {
  it('are the AI, then Google, then the phone (Pro)', () => {
    expect(SETUP_STEPS.map((s) => s.id)).toEqual(['ai', 'google', 'phone']);
    expect(SETUP_STEPS.find((s) => s.id === 'phone').pro).toBe(true);
  });
});

describe('planTiles: 80% of the weight on the plans people already pay for', () => {
  it('puts ChatGPT and Claude Code on the two big cards, in that order', () => {
    const { hero } = planTiles(FIRST_RUN_SUBSCRIPTION_ORDER.map(record));
    expect(hero.map((p) => p.id)).toEqual(['openai-codex', 'claude-code']);
  });

  it('lists every other subscription below, in the first-run order, never repeating a hero', () => {
    const { more } = planTiles(FIRST_RUN_SUBSCRIPTION_ORDER.map(record));
    expect(more.map((p) => p.id)).toEqual(FIRST_RUN_SUBSCRIPTION_ORDER.filter((id) => !HERO_PLAN_IDS.includes(id)));
    expect(more.some((p) => HERO_PLAN_IDS.includes(p.id))).toBe(false);
  });

  it('prefers the catalog record, and keeps the hero cards before the catalog loads', () => {
    const catalogChatGpt = { id: 'openai-codex', name: 'OpenAI Codex', icon: 'openai', categories: ['AI'], connectionType: 'oauth', instructions: 'x' };
    expect(planTiles([catalogChatGpt]).hero[0]).toBe(catalogChatGpt);
    const empty = planTiles([]);
    expect(empty.hero.map((p) => p.id)).toEqual(HERO_PLAN_IDS);
    expect(empty.more).toEqual([]);
  });

  it('never offers an API-key provider as a plan', () => {
    const { hero, more } = planTiles([record('openai'), record('anthropic'), record('gemini-cli')]);
    expect([...hero, ...more].map((p) => p.id)).toEqual(['gemini-cli']);
  });

  // The shared list's rule: a ChatGPT whose own service says it is unusable is
  // not offered anywhere, and its card goes to the next plan in order.
  it('obeys the shared setup list, giving a hidden hero\'s card to the next plan', () => {
    const providers = FIRST_RUN_SUBSCRIPTION_ORDER.map(record);
    const { hero, more } = planTiles(providers, { codexStatus: { available: true, apiUsable: false } });
    expect(hero.map((p) => p.id)).toEqual(['claude-code', 'gemini-cli']);
    expect(more.map((p) => p.id)).not.toContain('openai-codex');
    expect(planTiles(providers, { codexStatus: { available: true, apiUsable: true } }).hero[0].id).toBe('openai-codex');
  });

  it('never offers something that is not an AI', () => {
    const { hero, more } = planTiles([...FIRST_RUN_SUBSCRIPTION_ORDER.map(record), { id: 'google', name: 'Google', categories: ['Productivity'] }]);
    expect([...hero, ...more].map((p) => p.id)).not.toContain('google');
  });

  it('survives a malformed catalog', () => {
    expect(() => planTiles(null)).not.toThrow();
    expect(() => planTiles([null, undefined, {}])).not.toThrow();
  });
});

describe('setupStatus', () => {
  it('reads each step from the account', () => {
    expect(setupStatus({ aiConnected: true, connectedIds: ['Google'], textAnnieState: { phones: [{ state: 'active' }] } })).toEqual({
      ai: true,
      google: true,
      phone: true,
    });
    expect(setupStatus()).toEqual({ ai: false, google: false, phone: false });
  });

  it('a phone waiting for its code is not linked yet; a paused one still is', () => {
    expect(isPhoneLinked({ phones: [{ state: 'pending' }] })).toBe(false);
    expect(isPhoneLinked({ phones: [{ state: 'paused' }] })).toBe(true);
    expect(isPhoneLinked(null)).toBe(false);
  });

  it('knows the plan includes texting only once the service says so', () => {
    expect(phoneEligible({ plan: { eligible: true } })).toBe(true);
    expect(phoneEligible({ plan: { eligible: false } })).toBe(false);
    expect(phoneEligible(null)).toBe(null);
  });
});

describe('nextStep', () => {
  const none = { ai: false, google: false, phone: false };

  it('starts at the first step not done', () => {
    expect(nextStep(none)).toBe('ai');
    expect(nextStep({ ...none, ai: true })).toBe('google');
    expect(nextStep({ ai: true, google: true, phone: true })).toBe(null);
  });

  it('passes over a step already done after the current one', () => {
    expect(nextStep({ ai: true, google: true, phone: false }, {}, 'ai')).toBe('phone');
  });

  it('passes over a skipped step, and ends after the last', () => {
    expect(nextStep(none, { ai: true })).toBe('google');
    expect(nextStep(none, {}, 'phone')).toBe(null);
    expect(nextStep(none, { phone: true }, 'google')).toBe(null);
  });

  it('allDone needs all three', () => {
    expect(allDone({ ai: true, google: true, phone: true })).toBe(true);
    expect(allDone({ ai: true, google: true })).toBe(false);
  });
});

describe('finishOffer', () => {
  it('offers the ah-ha only with Google there to answer it', () => {
    expect(finishOffer({ google: true }).prompt).toBe(AHA_PROMPT);
    expect(finishOffer({ google: false }).prompt).toBe(FIRST_ASK_PROMPT);
  });

  it('does not repeat the title inside the text', () => {
    const offer = finishOffer({ google: true });
    expect(offer.text.startsWith('Read my calendar')).toBe(true);
    expect(offer.text).not.toMatch(/^Prep me for tomorrow/);
  });
});
