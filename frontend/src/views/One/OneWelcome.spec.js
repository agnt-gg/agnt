import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick, reactive } from 'vue';

const getters = reactive({ 'userAuth/userEmail': 'maya@example.com' });
const state = reactive({ aiProvider: { selectedProvider: 'AGNT', customProviders: [] }, appAuth: { connectedApps: [] } });
vi.mock('vuex', () => ({ useStore: () => ({ getters, state }) }));
// The setup has its own spec; here it is the thing the first chat shows.
vi.mock('@/views/_components/feature/FirstRunSetup.vue', () => ({
  default: { name: 'FirstRunSetup', props: ['frame', 'start'], emits: ['finish'], template: '<div class="frs-stub" />' },
}));

import OneWelcome from './OneWelcome.vue';
import { flagsKey } from './oneModel.js';
import { clearSetupRequest, requestSetup } from './oneSetupRequest.js';

const setupDone = () => localStorage.setItem(flagsKey('maya@example.com'), JSON.stringify({ setup: true }));
const setup = (w) => w.findComponent({ name: 'FirstRunSetup' });

describe('OneWelcome', () => {
  beforeEach(() => {
    localStorage.clear();
    clearSetupRequest();
    for (const key of Object.keys(getters)) if (key !== 'userAuth/userEmail') delete getters[key];
    state.aiProvider.selectedProvider = 'AGNT';
  });
  afterEach(() => vi.useRealTimers());

  it("the account's first chat opens on the first-run setup", () => {
    const w = mount(OneWelcome);
    expect(setup(w).exists()).toBe(true);
    expect(setup(w).props('frame')).toBe('chat');
    expect(w.find('[data-testid="one-lowdown"]').exists()).toBe(false);
    w.unmount();
  });

  it('finishing it is remembered for the account, and the tour follows', async () => {
    const w = mount(OneWelcome);
    setup(w).vm.$emit('finish', { ask: null });
    await nextTick();
    expect(JSON.parse(localStorage.getItem(flagsKey('maya@example.com'))).setup).toBe(true);
    expect(setup(w).exists()).toBe(false);
    expect(w.findAll('[data-testid="one-lowdown"] li b').map((b) => b.text())).toEqual(['Ask', 'Connect', 'Keep']);
    w.unmount();
  });

  it("Ask Annie sends the setup's request in one click", async () => {
    const heard = vi.fn();
    window.addEventListener('agnt:ask-annie', heard);
    const w = mount(OneWelcome);
    setup(w).vm.$emit('finish', { ask: 'What can you do for me?' });
    await nextTick();
    expect(heard.mock.calls[0][0].detail).toEqual({ text: 'What can you do for me?', send: true });
    window.removeEventListener('agnt:ask-annie', heard);
    w.unmount();
  });

  it("after the setup, before the first chat: Annie's tour, and AGNT Flash only when it is on", () => {
    setupDone();
    const flash = mount(OneWelcome);
    expect(flash.find('.one-welcome-title').text()).toBe("Hi, I'm Annie.");
    expect(flash.find('[data-testid="one-on-flash"]').text()).toContain("You're on AGNT Flash");
    flash.unmount();
    state.aiProvider.selectedProvider = 'anthropic';
    const own = mount(OneWelcome);
    expect(own.find('[data-testid="one-on-flash"]').exists()).toBe(false);
    own.unmount();
  });

  it('a returning account is greeted, not toured or set up', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 15, 0, 0));
    getters['contentOutputs/totalCount'] = 12;
    getters['userAuth/userPseudonym'] = 'Maya';
    const w = mount(OneWelcome);
    expect(w.find('.one-welcome-title').text()).toBe('Good afternoon, Maya.');
    expect(setup(w).exists()).toBe(false);
    w.unmount();
  });

  // The top-bar capsule: any account, any time, at the step it points to.
  it('opens the setup at the step the capsule asks for, even for a returning account', async () => {
    getters['contentOutputs/totalCount'] = 12;
    setupDone();
    const w = mount(OneWelcome);
    expect(setup(w).exists()).toBe(false);
    requestSetup('phone');
    await nextTick();
    expect(setup(w).props('start')).toBe('phone');
    setup(w).vm.$emit('finish', { ask: null });
    await nextTick();
    expect(setup(w).exists()).toBe(false);
    w.unmount();
  });
});
