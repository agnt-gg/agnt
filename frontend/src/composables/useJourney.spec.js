import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { createStore } from 'vuex';
import { createMemoryHistory, createRouter } from 'vue-router';
import { installJourney, readFacts, uninstallJourney, useJourney } from './useJourney.js';
import { useAITour } from './useAITour.js';

const Blank = { render: () => null };
const routes = [
  ['/chat', 'ChatScreen'],
  ['/agents', 'AgentsScreen'],
  ['/dashboard', 'DashboardScreen'],
  ['/settings', 'SettingsScreen'],
  ['/plugins', 'ConnectorsScreen'],
].map(([path, screen]) => ({ path, component: Blank, meta: { terminalScreen: screen } }));

function makeStore({ onboarding = false, connectedApps = [] } = {}) {
  return createStore({
    modules: {
      userAuth: {
        namespaced: true,
        state: () => ({ onboarding }),
        getters: {
          isAuthenticated: () => true,
          shouldShowOnboarding: (state) => state.onboarding,
          userEmail: () => 'person@example.com',
        },
        mutations: { finishOnboarding(state) { state.onboarding = false; } },
      },
      theme: { namespaced: true, getters: { uiMode: () => 'studio' } },
      appAuth: {
        namespaced: true,
        state: () => ({ connectedApps: [...connectedApps] }),
        mutations: { connect(state, app) { state.connectedApps.push(app); } },
        actions: { fetchConnectedApps: async () => {} },
      },
      agents: {
        namespaced: true,
        state: () => ({ agents: [] }),
        getters: { allAgents: (state) => state.agents },
        // In place, exactly as the real module does: counts must still move.
        mutations: { ADD_AGENT(state, agent) { state.agents.push(agent); } },
        actions: { fetchAgents: async () => {} },
      },
      chat: { namespaced: true, actions: { startStreamingConversation: async () => 'conv-1' } },
    },
  });
}

async function boot(store, path) {
  const router = createRouter({ history: createMemoryHistory(), routes });
  await router.push(path);
  installJourney({ store, router });
  // HYDRATE_DELAY (1.5s) → settle → offer delay (1.2s)
  await vi.advanceTimersByTimeAsync(1600);
  await flushPromises();
  await vi.advanceTimersByTimeAsync(1300);
  await flushPromises();
  return router;
}

describe('useJourney', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });
  afterEach(() => {
    uninstallJourney();
    useAITour().end('test');
    vi.useRealTimers();
  });

  it('reads counts from the store and splits AI providers from apps', () => {
    const store = makeStore({ connectedApps: ['agnt', 'openai', 'gmail', 'slack'] });
    expect(readFacts(store)).toMatchObject({ aiModels: 1, apps: 2, agents: 0 });
  });

  it('on the page where step one happens, starts the mission in place (no "Show me")', async () => {
    const store = makeStore();
    await boot(store, '/chat');
    const { run, view } = useJourney();
    expect(run.value).toMatchObject({ kind: 'mission', missionId: 'first-chat', index: 0 });
    expect(view.value.prompts.length).toBeGreaterThan(0);
    expect(view.value.actions.find((action) => action.id === 'next')).toBeUndefined(); // waits for the person

    await store.dispatch('chat/startStreamingConversation');
    await flushPromises();
    // Finished, and remembered as a lasting fact about the account.
    expect(useJourney().progress.value.done['first-chat']).toBe(true);
    expect(useJourney().progress.value.flags.chatted).toBe(true);
    // Points straight at the next milestone instead of just ending.
    expect(run.value).toMatchObject({ kind: 'next', missionId: 'connect-model' });
  });

  it('asks first when step one would navigate or open a dialog, then advances on the real outcome', async () => {
    const store = makeStore();
    const router = await boot(store, '/agents');
    const { run, view, handleAction } = useJourney();
    expect(run.value).toMatchObject({ kind: 'offer', missionId: 'first-agent' });
    expect(view.value.actions.map((action) => action.id)).toEqual(['start', 'dismiss']);

    handleAction('start');
    await flushPromises();
    expect(router.currentRoute.value.query.new).toBe('1'); // the new-agent dialog intent
    expect(run.value).toMatchObject({ kind: 'mission', missionId: 'first-agent' });

    store.commit('agents/ADD_AGENT', { id: 'a1' });
    await flushPromises();
    expect(useJourney().progress.value.done['first-agent']).toBe(true);
  });

  it('a turned-down offer is not offered again, even next session', async () => {
    let store = makeStore();
    await boot(store, '/agents');
    useJourney().handleAction('dismiss');
    expect(useJourney().run.value).toBeNull();
    uninstallJourney();

    store = makeStore();
    await boot(store, '/agents');
    expect(useJourney().run.value).toBeNull();
    expect(useJourney().progress.value.dismissed['first-agent']).toBe(true);
  });

  it('never offers what the account already has', async () => {
    const store = makeStore();
    store.commit('agents/ADD_AGENT', { id: 'existing' });
    await boot(store, '/agents');
    expect(useJourney().run.value).toBeNull();
    expect(useJourney().checklist.value.items.find((item) => item.id === 'agent').done).toBe(true);
  });

  it('stays out of the way during onboarding, then offers once it finishes', async () => {
    const store = makeStore({ onboarding: true });
    await boot(store, '/chat');
    expect(useJourney().run.value).toBeNull();
    expect(useJourney().checklist.value.visible).toBe(false);

    store.commit('userAuth/finishOnboarding');
    await flushPromises();
    await vi.advanceTimersByTimeAsync(1300);
    await flushPromises();
    expect(useJourney().run.value).toMatchObject({ kind: 'mission', missionId: 'first-chat' });
  });

  it('respects the switches: auto-start off means no offers, tours off means nothing', async () => {
    localStorage.setItem('tours_auto_start', 'false');
    let store = makeStore();
    await boot(store, '/chat');
    expect(useJourney().run.value).toBeNull();
    expect(useJourney().checklist.value.visible).toBe(true);
    uninstallJourney();

    localStorage.setItem('tours_enabled', 'false');
    store = makeStore();
    await boot(store, '/chat');
    expect(useJourney().checklist.value.visible).toBe(false);
  });

  it('hides while the assistant runs a tour and resumes after', async () => {
    const store = makeStore();
    await boot(store, '/chat');
    expect(useJourney().view.value).not.toBeNull();
    useAITour().start({ tourId: 't', steps: [{ title: 'x', content: 'y' }] });
    expect(useJourney().view.value).toBeNull();
    useAITour().end('done');
    expect(useJourney().view.value).not.toBeNull();
  });

  it('a recorded choice completes a step: "Keep AGNT Flash"', async () => {
    const store = makeStore();
    const router = await boot(store, '/settings');
    const { run, handleAction } = useJourney();
    expect(run.value).toMatchObject({ kind: 'offer', missionId: 'connect-model' });
    handleAction('start');
    await flushPromises();
    expect(router.currentRoute.value.query.section).toBe('providers');
    handleAction('flag:modelChosen');
    await flushPromises();
    expect(useJourney().progress.value.done['connect-model']).toBe(true);
    expect(useJourney().checklist.value.items[0].done).toBe(true);
  });
});
