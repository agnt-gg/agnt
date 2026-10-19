import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { reactive } from 'vue';

const getters = reactive({});
const state = reactive({ aiProvider: { selectedProvider: 'AGNT', customProviders: [] }, appAuth: { connectedApps: [] } });
vi.mock('vuex', () => ({ useStore: () => ({ getters, state }) }));

import OneWelcome from './OneWelcome.vue';

describe('OneWelcome', () => {
  beforeEach(() => {
    for (const key of Object.keys(getters)) delete getters[key];
    state.aiProvider.selectedProvider = 'AGNT';
  });
  afterEach(() => vi.useRealTimers());

  it("before the account's first chat, Annie's whole tour: hello, one line, three verbs", () => {
    const w = mount(OneWelcome);
    expect(w.find('.one-welcome-title').text()).toBe("Hi, I'm Annie.");
    const verbs = w.findAll('[data-testid="one-lowdown"] li b').map((b) => b.text());
    expect(verbs).toEqual(['Ask', 'Connect', 'Keep']);
    w.unmount();
  });

  it('says AGNT Flash is already on, and only when it is', () => {
    const flash = mount(OneWelcome);
    expect(flash.find('[data-testid="one-on-flash"]').text()).toContain("You're on AGNT Flash");
    flash.unmount();
    state.aiProvider.selectedProvider = 'anthropic';
    const own = mount(OneWelcome);
    expect(own.find('[data-testid="one-on-flash"]').exists()).toBe(false);
    own.unmount();
  });

  it('a returning account is greeted, not toured', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 15, 0, 0));
    getters['contentOutputs/totalCount'] = 12;
    getters['userAuth/userPseudonym'] = 'Maya';
    const w = mount(OneWelcome);
    expect(w.find('.one-welcome-title').text()).toBe('Good afternoon, Maya.');
    expect(w.find('[data-testid="one-lowdown"]').exists()).toBe(false);
    w.unmount();
  });
});
