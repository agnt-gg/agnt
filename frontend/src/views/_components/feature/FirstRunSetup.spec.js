/**
 * The first-run setup: connect your AI, then Google, then your phone.
 * Only the network edges are stubbed (the AI pipeline, the Google toggle and
 * the Text Annie service); which AI counts as "your own" is the journey's real
 * rule, so the setup and the getting-started checklist cannot drift apart.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createStore } from 'vuex';

const connect = vi.fn();
const saveApiKey = vi.fn();
const handleProviderToggle = vi.fn();
const getStatus = vi.fn();
vi.mock('@/composables/useAiProviderConnect.js', () => ({ useAiProviderConnect: () => ({ connect, saveApiKey }) }));
vi.mock('@/composables/useProviderConnection.js', () => ({ useProviderConnection: () => ({ handleProviderToggle }) }));
vi.mock('@/services/textAnnieService.js', () => ({ getStatus: (...a) => getStatus(...a) }));

import FirstRunSetup from './FirstRunSetup.vue';
import { AHA_PROMPT, FIRST_ASK_PROMPT } from '@/services/firstRunSetup.js';

const plan = (id, name, icon) => ({ id, name, icon, categories: ['AI'], connectionType: 'oauth' });
const PROVIDERS = [
  plan('openai-codex', 'OpenAI Codex', 'openai'),
  plan('claude-code', 'Claude Code', 'claude'),
  plan('antigravity', 'Antigravity', 'antigravity'),
  plan('kimi-code', 'Kimi Code', 'kimi-code'),
  { id: 'openai', name: 'OpenAI', icon: 'openai', categories: ['AI'], connectionType: 'apikey' },
  { id: 'google', name: 'Google', icon: 'google', connectionType: 'oauth' },
];
const linkedPhone = { phones: [{ id: 'p1', state: 'active' }], plan: { eligible: true } };

const TextAnnieStub = { name: 'TextAnnieCard', props: ['showHeader'], emits: ['state'], template: '<div class="ta-stub" />' };
const ProviderLanesStub = { name: 'ProviderLanes', props: ['providers', 'connectedIds', 'codexStatus', 'activeId', 'showLanes'], template: '<div class="lanes-stub" />' };

let wrapper;
let store;
function setup({ connectedApps = [], selectedProvider = 'AGNT', phone = { phones: [], plan: { eligible: true } }, props = {} } = {}) {
  getStatus.mockResolvedValue(phone);
  store = createStore({
    modules: {
      appAuth: {
        namespaced: true,
        state: { allProviders: PROVIDERS, connectedApps, codexStatus: {} },
        mutations: { connected: (state, ids) => (state.connectedApps = ids) },
        actions: { fetchAllProviders: vi.fn(), fetchConnectedApps: vi.fn() },
      },
      aiProvider: {
        namespaced: true,
        state: { selectedProvider, customProviders: [] },
        mutations: { select: (state, name) => (state.selectedProvider = name) },
      },
    },
  });
  vi.spyOn(store, 'dispatch');
  wrapper = mount(FirstRunSetup, {
    props,
    global: {
      plugins: [store],
      stubs: {
        TextAnnieCard: TextAnnieStub,
        ProviderLanes: ProviderLanesStub,
        SvgIcon: { props: ['name'], template: '<i class="icon" :data-icon="name" />' },
        SimpleModal: { template: '<div />' },
      },
    },
  });
  return flushPromises().then(() => wrapper);
}
const step = () => wrapper.find('[data-step]').attributes('data-step');
const click = async (selector) => {
  const target = wrapper.find(selector);
  if (!target.exists()) throw new Error(`nothing matches ${selector} on step ${step()}`);
  await target.trigger('click');
  await flushPromises();
};

beforeEach(() => [connect, saveApiKey, handleProviderToggle, getStatus].forEach((fn) => fn.mockReset()));
afterEach(() => wrapper?.unmount());

describe('step 1: your AI', () => {
  it('opens on the two plans most people already pay for, as the big cards', async () => {
    await setup();
    expect(step()).toBe('ai');
    expect(wrapper.find('.frs-title').text()).toBe('Connect your AI');
    expect(wrapper.findAll('.frs-plan').map((card) => card.attributes('data-provider'))).toEqual(['openai-codex', 'claude-code']);
    expect(wrapper.findAll('.frs-plan .frs-btn').map((b) => b.text())).toEqual(['Sign in with ChatGPT', 'Sign in with Claude']);
  });

  it('lists the other plans below in the first-run order, and no API-key provider', async () => {
    await setup();
    expect(wrapper.findAll('.frs-pill').map((p) => p.attributes('data-provider'))).toEqual(['antigravity', 'kimi-code']);
  });

  it('signs in through the app\'s one AI pipeline', async () => {
    await setup();
    await click('.frs-plan[data-provider="openai-codex"] .frs-btn');
    expect(connect).toHaveBeenCalledWith(expect.objectContaining({ id: 'openai-codex' }));
  });

  it('keeps the API key behind one quiet link, showing only the key lane', async () => {
    await setup();
    expect(wrapper.findComponent(ProviderLanesStub).exists()).toBe(false);
    await click('[data-action="api-key"]');
    expect(wrapper.findComponent(ProviderLanesStub).props('showLanes')).toEqual(['api']);
    await click('[data-action="plans"]');
    expect(wrapper.find('.frs-plan').exists()).toBe(true);
  });

  it('offers a local model through the same pipeline', async () => {
    await setup();
    await click('[data-action="local"]');
    expect(connect).toHaveBeenCalledWith(expect.objectContaining({ id: 'local' }));
  });

  it('"Start with AGNT Flash for now" moves on to Google', async () => {
    await setup();
    await click('[data-action="flash"]');
    expect(step()).toBe('google');
  });

  it('a plan already signed in on this computer is confirmed, not asked for again', async () => {
    await setup({ connectedApps: ['claude-code'], selectedProvider: 'Claude-Code' });
    expect(wrapper.find('[data-testid="frs-ai-connected"]').text()).toContain('Claude Code is connected');
    expect(wrapper.find('.frs-plan').exists()).toBe(false);
  });

  it('Continue uses a connected AI that is not in use yet', async () => {
    await setup({ connectedApps: ['openai-codex'], selectedProvider: 'AGNT' });
    expect(step()).toBe('ai');
    await click('[data-action="continue"]');
    expect(connect).toHaveBeenCalledWith(expect.objectContaining({ id: 'openai-codex' }));
    expect(step()).toBe('google');
  });

  it('flips to the confirmation the moment the sign-in lands', async () => {
    await setup();
    store.commit('appAuth/connected', ['openai-codex']);
    store.commit('aiProvider/select', 'OpenAI-Codex');
    await flushPromises();
    expect(wrapper.find('[data-testid="frs-ai-connected"]').text()).toContain('ChatGPT is connected');
  });
});

describe('step 2: Google', () => {
  it('signs in to Google while it is not connected', async () => {
    await setup({ connectedApps: ['openai-codex'], selectedProvider: 'OpenAI-Codex' });
    await click('[data-action="continue"]');
    expect(step()).toBe('google');
    expect(connect).not.toHaveBeenCalled(); // already in use: Continue just moves on
    expect(wrapper.find('[data-testid="frs-hello"]').text()).toContain('your ChatGPT plan');
    await click('[data-action="google"]');
    expect(handleProviderToggle).toHaveBeenCalledWith('google');
  });

  // handleProviderToggle disconnects a connected provider: the setup must never
  // offer it for an account that already has Google.
  it('never toggles a Google account that is already connected', async () => {
    await setup({ connectedApps: ['openai-codex', 'google'], selectedProvider: 'OpenAI-Codex', phone: { phones: [], plan: { eligible: true } } });
    await click('[data-step-tab="google"]');
    expect(wrapper.find('[data-action="google"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="frs-google-connected"]').exists()).toBe(true);
    await click('[data-action="continue"]');
    expect(handleProviderToggle).not.toHaveBeenCalled();
    expect(step()).toBe('phone');
  });

  it('Continue passes over Google when it is already connected', async () => {
    await setup({ connectedApps: ['openai-codex', 'google'], selectedProvider: 'OpenAI-Codex' });
    await click('[data-action="continue"]');
    expect(step()).toBe('phone');
  });
});

describe('step 3: your phone', () => {
  it('is the Text Annie card itself, under the setup\'s own heading', async () => {
    await setup({ connectedApps: ['openai-codex', 'google'] });
    await click('[data-step-tab="phone"]');
    expect(wrapper.findComponent(TextAnnieStub).props('showHeader')).toBe(false);
    expect(wrapper.find('.frs-title').text()).toContain('Text Annie from your phone');
  });

  it('finishes once a phone links', async () => {
    await setup({ connectedApps: ['openai-codex', 'google'] });
    await click('[data-step-tab="phone"]');
    expect(wrapper.find('[data-action="continue"]').exists()).toBe(false);
    wrapper.findComponent(TextAnnieStub).vm.$emit('state', linkedPhone);
    await flushPromises();
    await click('[data-action="continue"]');
    expect(step()).toBe('done');
    expect(wrapper.find('.frs-done-title').text()).toBe("You're all set.");
  });

  it('says skipping finishes setup when the plan has no texting', async () => {
    await setup({ connectedApps: ['openai-codex', 'google'], phone: { phones: [], plan: { eligible: false } } });
    await click('[data-step-tab="phone"]');
    expect(wrapper.find('[data-action="skip"]').text()).toBe('Skip and finish setup');
  });
});

describe('done', () => {
  it('skipping everything ends on a first question, not the ah-ha (it needs Google)', async () => {
    await setup();
    await click('[data-action="flash"]');
    await click('[data-action="skip"]');
    await click('[data-action="skip"]');
    expect(step()).toBe('done');
    expect(wrapper.find('.frs-done-title').text()).toBe("You're ready to go.");
    await click('[data-action="ask"]');
    expect(wrapper.emitted('finish').at(-1)).toEqual([{ ask: FIRST_ASK_PROMPT }]);
  });

  it('an account with all three opens straight on the done screen, offering the ah-ha', async () => {
    await setup({ connectedApps: ['openai-codex', 'google'], selectedProvider: 'OpenAI-Codex', phone: linkedPhone });
    expect(step()).toBe('done');
    expect(wrapper.find('.frs-lead').text()).toBe("I'm on your ChatGPT plan, connected to your Google account and a text away.");
    await click('[data-action="ask"]');
    expect(wrapper.emitted('finish').at(-1)).toEqual([{ ask: AHA_PROMPT }]);
  });

  it('"I\'ll take it from here" finishes without a request', async () => {
    await setup({ connectedApps: ['openai-codex', 'google'], phone: linkedPhone });
    await click('[data-action="start"]');
    expect(wrapper.emitted('finish').at(-1)).toEqual([{ ask: null }]);
  });

  it('a step left open goes straight back to it', async () => {
    await setup({ connectedApps: ['openai-codex'], selectedProvider: 'OpenAI-Codex' });
    await click('[data-action="continue"]');
    await click('[data-action="skip"]');
    await click('[data-action="skip"]');
    await click('.frs-tick[data-step-tab="google"]');
    expect(step()).toBe('google');
  });
});

describe('layout', () => {
  // Seen in a fresh account: the global `ol li:last-child { margin-bottom: 16px }`
  // lifted step 3 six pixels above the others. jsdom computes no layout, so the
  // reset is held in the source.
  it('resets list-item margins inside the card', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const { fileURLToPath } = await import('url');
    const source = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'FirstRunSetup.vue'), 'utf8');
    expect(source).toMatch(/\.frs li\s*\{\s*margin:\s*0;\s*\}/);
  });
});

describe('opened at a step', () => {
  // A host's checklist (AGNT One's top-bar capsule) opens the setup where it points.
  it('opens where it is asked to, and moves when asked again', async () => {
    await setup({ props: { start: 'phone' } });
    expect(step()).toBe('phone');
    await wrapper.setProps({ start: 'google' });
    expect(step()).toBe('google');
  });

  it('ignores a step it does not have', async () => {
    await setup({ props: { start: 'theme' } });
    expect(step()).toBe('ai');
  });
});

describe('coming back from a sign-in', () => {
  it('looks at the connections again when the window regains focus', async () => {
    await setup();
    store.dispatch.mockClear();
    window.dispatchEvent(new Event('focus'));
    await flushPromises();
    expect(store.dispatch).toHaveBeenCalledWith('appAuth/fetchConnectedApps', { forceRefresh: true });
  });

  it('still opens when the account cannot be read', async () => {
    getStatus.mockRejectedValueOnce(new Error('offline'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    store = null;
    await setup({ phone: undefined });
    expect(step()).toBe('ai');
    warn.mockRestore();
  });
});
