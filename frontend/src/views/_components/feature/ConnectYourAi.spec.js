// "Connect your AI" (2026-10-21): shown until the account has an AI of its
// own; subscriptions first, then an API key, and AGNT Flash for this session.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { reactive } from 'vue';

const toggle = vi.fn(async () => {});
vi.mock('@/composables/useProviderConnection.js', () => ({ useProviderConnection: () => ({ handleProviderToggle: toggle }) }));
const state = reactive({ appAuth: { connectedApps: [] }, aiProvider: { customProviders: [] } });
const store = { state, getters: {}, dispatch: vi.fn(async () => {}) };
vi.mock('vuex', () => ({ useStore: () => store }));
const { default: ConnectYourAi } = await import('./ConnectYourAi.vue');

const mountCard = () => mount(ConnectYourAi, { global: { stubs: { SimpleModal: true } } });

beforeEach(() => {
  state.appAuth.connectedApps = [];
  sessionStorage.clear();
  toggle.mockClear();
});

describe('Connect your AI', () => {
  it('waits for the connected accounts, then offers ChatGPT and Claude, in that order', async () => {
    const w = mountCard();
    expect(w.find('[data-testid="connect-your-ai"]').exists()).toBe(false);
    await flushPromises();
    expect(w.findAll('[data-provider]').map((b) => [b.attributes('data-provider'), b.text()])).toEqual([
      ['openai-codex', 'Sign in with ChatGPT'],
      ['claude-code', 'Sign in with Claude'],
    ]);
    await w.find('[data-provider="claude-code"]').trigger('click');
    expect(toggle).toHaveBeenCalledWith('claude-code');
    await w.find('[data-action="api-key"]').trigger('click');
    expect(w.emitted('api-key')).toHaveLength(1);
  });

  it('is gone once any AI of your own is connected; AGNT itself does not count', async () => {
    state.appAuth.connectedApps = ['agnt', 'google'];
    const flashOnly = mountCard();
    await flushPromises();
    expect(flashOnly.find('[data-testid="connect-your-ai"]').exists()).toBe(true);
    state.appAuth.connectedApps = ['agnt', 'openai-codex'];
    await flushPromises();
    expect(flashOnly.find('[data-testid="connect-your-ai"]').exists()).toBe(false);
  });

  it('"Start with AGNT Flash for now" hides it for this session only', async () => {
    const w = mountCard();
    await flushPromises();
    await w.find('[data-action="later"]').trigger('click');
    expect(w.find('[data-testid="connect-your-ai"]').exists()).toBe(false);
    const again = mountCard();
    await flushPromises();
    expect(again.find('[data-testid="connect-your-ai"]').exists()).toBe(false);
    sessionStorage.clear(); // a new session
    const next = mountCard();
    await flushPromises();
    expect(next.find('[data-testid="connect-your-ai"]').exists()).toBe(true);
  });
});
