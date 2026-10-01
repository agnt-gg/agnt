import { describe, it, expect, beforeEach } from 'vitest';
import { reactive, nextTick, effectScope } from 'vue';
import { useUiModeDefault } from './useUiModeDefault.js';

function fakeStore({ ready = true, fetched = true, chats = 0, agents = 0, workflows = 0, agentsError = null, mode = 'studio' } = {}) {
  const state = reactive({ contentOutputs: { lastFetched: fetched ? 1 : null }, mode, ready, chats, agents, workflows, agentsError });
  const dispatched = [];
  const store = {
    state,
    dispatched,
    get getters() {
      return {
        criticalDataReady: state.ready,
        'contentOutputs/totalCount': state.chats,
        'contentOutputs/outputs': [],
        'agents/allAgents': Array(state.agents).fill({}),
        'workflows/allWorkflows': Array(state.workflows).fill({}),
        'agents/error': state.agentsError,
        'workflows/error': null,
        'theme/uiMode': state.mode,
      };
    },
    dispatch(type, payload) {
      dispatched.push([type, payload]);
      if (type === 'theme/setUiMode') {
        state.mode = payload;
        localStorage.setItem('uiMode', payload);
      }
    },
  };
  return store;
}

function run(store) {
  const scope = effectScope();
  const api = scope.run(() => useUiModeDefault(store));
  return { api, stop: () => scope.stop() };
}

describe('useUiModeDefault', () => {
  beforeEach(() => localStorage.clear());

  it('a brand-new account starts in Focused, and the choice is saved', async () => {
    const store = fakeStore();
    const { stop } = run(store);
    await nextTick();
    expect(store.dispatched).toEqual([['theme/setUiMode', 'focused']]);
    expect(localStorage.getItem('uiMode')).toBe('focused');
    stop();
  });

  it('an existing account stays in Studio and is offered Focused once', async () => {
    const store = fakeStore({ chats: 12, agents: 3 });
    const { api, stop } = run(store);
    await nextTick();
    expect(store.dispatched).toEqual([['theme/setUiMode', 'studio']]);
    expect(api.showTryFocused.value).toBe(true);
    api.dismissTryFocused();
    expect(api.showTryFocused.value).toBe(false);
    expect(localStorage.getItem('agnt:focused-intro-seen')).toBe('true');
    stop();
  });

  it('decides nothing while data is loading, then decides once it has', async () => {
    const store = fakeStore({ ready: false, chats: 5 });
    const { stop } = run(store);
    await nextTick();
    expect(store.dispatched).toEqual([]);
    store.state.ready = true;
    await nextTick();
    expect(store.dispatched).toEqual([['theme/setUiMode', 'studio']]);
    stop();
  });

  it('a FAILED load never makes an existing account look new', async () => {
    const failedChats = fakeStore({ fetched: false });
    const failedAgents = fakeStore({ agentsError: 'HTTP 500' });
    const a = run(failedChats);
    const b = run(failedAgents);
    await nextTick();
    expect(failedChats.dispatched).toEqual([]);
    expect(failedAgents.dispatched).toEqual([]);
    a.stop();
    b.stop();
  });

  it('never overrides a choice this browser already has', async () => {
    localStorage.setItem('uiMode', 'studio');
    const store = fakeStore(); // looks brand new, but the person already chose
    const { stop } = run(store);
    await nextTick();
    expect(store.dispatched).toEqual([]);
    stop();
  });

  it('seeing Focused at all retires the Try-Focused note', async () => {
    localStorage.setItem('uiMode', 'studio');
    const store = fakeStore({ chats: 4 });
    const { api, stop } = run(store);
    expect(api.showTryFocused.value).toBe(true);
    store.state.mode = 'focused';
    await nextTick();
    store.state.mode = 'studio';
    await nextTick();
    expect(api.showTryFocused.value).toBe(false);
    stop();
  });
});
