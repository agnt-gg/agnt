// While AGNT Flash answers and the account has no AI of its own, the meter
// says so once per session, with a way to connect (2026-10-21).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { reactive } from 'vue';

vi.mock('@/services/agntFlash.js', () => ({
  fetchFlashAccount: vi.fn(async () => ({ trial: true, includedCredits: 100, remainingCredits: 90, source: 'trial' })),
  startFlashTopUp: vi.fn(),
  formatCredits: (n) => String(n),
  usedShare: () => 0.1,
  LOW_CREDIT_SHARE: 0.8,
}));
const state = reactive({ appAuth: { connectedApps: ['agnt'] }, aiProvider: { customProviders: [] }, chat: { isStreaming: false, messages: [] } });
vi.mock('vuex', async (original) => ({ ...(await original()), useStore: () => ({ state, getters: {}, dispatch: vi.fn() }) }));
const { default: AgntFlashMeter } = await import('./AgntFlashMeter.vue');

const mountMeter = () => mount(AgntFlashMeter, { global: { stubs: { UpgradeModal: true } } });
beforeEach(() => {
  sessionStorage.clear();
  state.appAuth.connectedApps = ['agnt'];
});

describe('AGNT Flash meter: connect your AI', () => {
  it('offers to connect your AI while Flash is all you have, and asks the chat to open Settings', async () => {
    const w = mountMeter();
    await flushPromises();
    expect(w.find('[data-testid="flash-connect-ai"]').text()).toContain('Connect your AI for top-quality results');
    await w.find('[data-action="connect-ai"]').trigger('click');
    expect(w.emitted('connect-ai')).toHaveLength(1);
  });
  it('is gone with an AI of your own, and after Not now for the rest of the session', async () => {
    state.appAuth.connectedApps = ['agnt', 'claude-code'];
    const own = mountMeter();
    await flushPromises();
    expect(own.find('[data-testid="flash-connect-ai"]').exists()).toBe(false);
    state.appAuth.connectedApps = ['agnt'];
    const w = mountMeter();
    await flushPromises();
    await w.find('[data-action="connect-ai-later"]').trigger('click');
    expect(w.find('[data-testid="flash-connect-ai"]').exists()).toBe(false);
    const later = mountMeter();
    await flushPromises();
    expect(later.find('[data-testid="flash-connect-ai"]').exists()).toBe(false);
  });
});
