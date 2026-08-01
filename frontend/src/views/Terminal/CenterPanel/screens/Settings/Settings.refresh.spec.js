/**
 * BaseScreen re-emits `base-mounted` on every KeepAlive re-activation, so each
 * return to Settings fired all ten background refreshes again. Not the cause of
 * the blank page, but it is why the screen felt heavy on every visit.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import Settings from './Settings.vue';

const REFRESH_ACTIONS = [
  'userStats/fetchReferralBalance',
  'userStats/fetchReferralTree',
  'userStats/fetchStats',
  'userStats/fetchSecondsAutomated90Day',
  'goals/fetchGoals',
  'agents/fetchAgents',
  'workflows/fetchWorkflows',
  'tools/fetchTools',
  'executionHistory/fetchExecutions',
  'appAuth/fetchConnectedApps',
];

function makeStore(isAuthenticated = true) {
  const store = createStore({
    getters: {
      'userAuth/isAuthenticated': () => isAuthenticated,
    },
  });
  store.dispatch = vi.fn().mockResolvedValue(undefined);
  return store;
}

function mountSettings(store) {
  return mount(Settings, {
    shallow: true,
    global: { plugins: [store] },
  });
}

const refreshCalls = (store) =>
  store.dispatch.mock.calls.filter(([action]) => REFRESH_ACTIONS.includes(action));

describe('Settings background refresh', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fetches everything on the first visit', () => {
    const store = makeStore();
    const wrapper = mountSettings(store);

    wrapper.vm.initializeScreen();

    expect(refreshCalls(store)).toHaveLength(REFRESH_ACTIONS.length);
  });

  it('does not re-fetch when the screen is re-activated moments later', () => {
    const store = makeStore();
    const wrapper = mountSettings(store);

    wrapper.vm.initializeScreen();
    const afterFirst = refreshCalls(store).length;

    // Three trips away and back.
    wrapper.vm.initializeScreen();
    wrapper.vm.initializeScreen();
    wrapper.vm.initializeScreen();

    expect(refreshCalls(store)).toHaveLength(afterFirst);
  });

  it('refreshes again once the data is actually stale', () => {
    const store = makeStore();
    const wrapper = mountSettings(store);

    wrapper.vm.initializeScreen();
    vi.setSystemTime(Date.now() + 61_000);
    wrapper.vm.initializeScreen();

    expect(refreshCalls(store)).toHaveLength(REFRESH_ACTIONS.length * 2);
  });

  it('fetches nothing at all when signed out', () => {
    const store = makeStore(false);
    const wrapper = mountSettings(store);

    wrapper.vm.initializeScreen();

    expect(refreshCalls(store)).toHaveLength(0);
  });

  it('still honours a requested section on every activation, throttle or not', () => {
    const store = makeStore();
    const wrapper = mountSettings(store);

    wrapper.vm.initializeScreen();

    localStorage.setItem('settings-initial-section', 'api-keys');
    wrapper.vm.initializeScreen();

    expect(wrapper.vm.activeSection).toBe('api-keys');
    expect(localStorage.getItem('settings-initial-section')).toBeNull();
  });
});
