/**
 * The AGNT Flash meter above the composer.
 * Reported 2026-10-07: it spanned the whole panel, showed raw credit counts to
 * free accounts, and said "64k left" beside "trial credits used up".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Reactive, as Vuex state is: the meter watches it.
const state = vi.hoisted(() => ({ value: null }));
vi.mock('vuex', async (orig) => {
  const { reactive } = await import('vue');
  state.value = reactive({ chat: { isStreaming: false, messages: [] } });
  return { ...(await orig()), useStore: () => ({ state: state.value }) };
});
const api = vi.hoisted(() => ({ fetchFlashAccount: vi.fn(), startFlashTopUp: vi.fn() }));
vi.mock('@/services/agntFlash.js', async (orig) => ({ ...(await orig()), ...api }));

import AgntFlashMeter from './AgntFlashMeter.vue';
const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'AgntFlashMeter.vue'), 'utf8');
const mounted = [];
const mountMeter = () => { const w = mount(AgntFlashMeter, { global: { stubs: { UpgradeModal: true } } }); mounted.push(w); return w; };

describe('AgntFlashMeter', () => {
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); state.value.chat.messages = []; });
  afterEach(() => { while (mounted.length) mounted.pop().unmount(); });

  it('free trial: a bar, never a credit count, including in the low-credit notice', async () => {
    api.fetchFlashAccount.mockResolvedValue({ source: 'agnt_trial', trial: true, includedCredits: 1_000_000, usedCredits: 900_000, remainingCredits: 100_000, balanceMicroUSD: 0 });
    const w = mountMeter();
    await flushPromises();
    expect(w.find('.afm-bar i').attributes('style')).toContain('width: 90%');
    expect(w.text()).not.toMatch(/\d+(\.\d+)?\s*[kMB]\b|credits left|\bleft\b/);
    expect(w.find('.afm-nudge').text()).toContain('almost used up');
  });

  it('free trial spent: "Used up", never a leftover number', async () => {
    api.fetchFlashAccount.mockResolvedValue({ source: 'agnt_trial', trial: true, includedCredits: 1_000_000, usedCredits: 1_000_000, remainingCredits: 0, balanceMicroUSD: 0 });
    const w = mountMeter();
    await flushPromises();
    expect(w.find('.afm-left').text()).toBe('Used up');
  });

  it('paid account keeps its number', async () => {
    api.fetchFlashAccount.mockResolvedValue({ source: 'agnt_subscription', trial: false, planName: 'AGNT included allowance', includedCredits: 5_000_000, usedCredits: 1_000_000, remainingCredits: 4_000_000, balanceMicroUSD: 0 });
    const w = mountMeter();
    await flushPromises();
    expect(w.find('.afm-left').text()).toBe('4.0M left');
  });

  it('re-reads the balance when a message lands (an out-of-credits notice is one)', async () => {
    api.fetchFlashAccount.mockResolvedValue({ source: 'agnt_trial', trial: true, includedCredits: 1_000_000, usedCredits: 0, remainingCredits: 1_000_000, balanceMicroUSD: 0 });
    mountMeter();
    await flushPromises();
    state.value.chat.messages = [{ role: 'assistant', content: 'notice' }];
    await flushPromises();
    expect(api.fetchFlashAccount).toHaveBeenCalledTimes(2);
  });

  it('is as wide as the conversation column and centred, never the full panel', () => {
    expect(SRC).toMatch(/\.agnt-flash-meter \{ width: min\(800px, 100%\); margin: 0 auto 6px;/);
    expect(SRC).toMatch(/:global\(\.ui-focused\) \.agnt-flash-meter \{ width: var\(--focused-chat-column-width/);
  });
});
