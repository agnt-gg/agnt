import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { useNavigationOnion } from './useNavigationOnion.js';
import { useAITour } from './useAITour.js';
import { ONION_STORAGE_KEY, loadOnionState } from '@/services/navigationOnion.js';
import { groupedNavigation } from '@/services/navigationPreferences.js';

// A store shaped like the app's: every module the onion reads, each with the
// fetch action accountInventory dispatches. `seed` is what the server returns.
function makeStore(seed = {}) {
  const list = (key) => ({
    namespaced: true,
    state: () => ({ items: [] }),
    getters: { [key]: (s) => s.items },
    // `add` pushes IN PLACE, exactly as workflows/ADD_WORKFLOW does. A fixture
    // that replaced the array hid a bug where the onion watched only the
    // array's identity and never saw the first workflow arrive.
    mutations: { set(s, items) { s.items = items; }, add(s, item) { s.items.push(item); } },
  });
  const withFetch = (module, action, items) => ({
    ...module,
    actions: { [action]: ({ commit }) => commit('set', items || []) },
  });
  return createStore({
    modules: {
      goals: withFetch(list('allGoals'), 'fetchGoals', seed.goals),
      agents: withFetch(list('allAgents'), 'fetchAgents', seed.agents),
      workflows: withFetch(list('allWorkflows'), 'fetchWorkflows', seed.workflows),
      tools: withFetch(list('customTools'), 'fetchTools', seed.tools),
      skills: withFetch(list('allSkills'), 'fetchSkills', seed.skills),
      widgetDefinitions: withFetch(list('allDefinitions'), 'fetchDefinitions', seed.widgets),
      executionHistory: withFetch(list('getExecutions'), 'fetchExecutions', seed.executions),
      contentOutputs: withFetch(list('outputs'), 'fetchOutputs', seed.chats),
      appAuth: {
        namespaced: true,
        state: () => ({ connectedApps: [] }),
        getters: { connectedApps: (s) => s.connectedApps },
        mutations: { set(s, apps) { s.connectedApps = apps; } },
        actions: { fetchConnectedApps: ({ commit }) => commit('set', seed.connectedApps || []) },
      },
    },
  });
}

// A rail row for every section, as CanvasScreen renders them, so the tour has
// something real to anchor to.
function mountHost(store, { canAnnounce = true } = {}) {
  const Host = defineComponent({
    setup() {
      const onion = useNavigationOnion(store, { teams: ref([]), teamsKnown: ref(true), canAnnounce: ref(canAnnounce) });
      return { onion };
    },
    render() {
      return h('nav', ['chat', 'apps', 'artifacts', 'traces', 'goals', 'workflows', 'agents', 'tools', 'store', 'library', 'teams', 'dashboard']
        .map((id) => h('button', { 'data-tour-id': `sidebar.${id}` }, id)));
    },
  });
  return mount(Host, { attachTo: document.body, global: { plugins: [store] } });
}

async function settle() {
  await vi.advanceTimersByTimeAsync(1500); // past HYDRATE_DELAY_MS
  await flushPromises();
  await vi.advanceTimersByTimeAsync(50); // the rAF before the popup measures
  await flushPromises();
}

// A person's first app or first workflow happens after the app has finished
// loading — past the startup window in which arrivals are treated as loading.
async function startupDone() {
  await settle();
  await vi.advanceTimersByTimeAsync(5500);
  await flushPromises();
}

describe('useNavigationOnion', () => {
  let wrapper;
  const tour = useAITour();

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    tour.end('test');
  });
  afterEach(() => {
    wrapper?.unmount();
    tour.end('test');
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('a new account loads empty, stays on Chat, and hears nothing', async () => {
    const store = makeStore();
    wrapper = mountHost(store);
    await settle();
    expect(groupedNavigation().flatMap((g) => g.items).map((i) => i.id)).toEqual(['chat']);
    expect(tour.isActive.value).toBe(false);
  });

  it('the first workflow — created from chat and delivered by realtime sync — opens Workflows and points at it', async () => {
    const store = makeStore();
    wrapper = mountHost(store);
    await startupDone();

    store.commit('workflows/add', { id: 'wf-1' });
    await settle();

    const rail = groupedNavigation().flatMap((g) => g.items).map((i) => i.id);
    expect(rail).toContain('workflows');
    expect(tour.isActive.value).toBe(true);
    expect(tour.tourId.value).toBe('onion-workflows');
    expect(tour.config.value[0]).toMatchObject({ title: 'Workflows', target: '[data-tour-id="sidebar.workflows"]', position: 'right' });
    // The Store opened in the same pass: marked new, not announced on top.
    expect(loadOnionState().fresh).toEqual(expect.arrayContaining(['workflows', 'store']));
  });

  it('an existing account gets its full rail on upgrade with no popup at all', async () => {
    const store = makeStore({ workflows: [{}], agents: [{}], goals: [{}], executions: [{}], chats: [{}], connectedApps: ['gmail'] });
    wrapper = mountHost(store);
    await settle();
    const rail = groupedNavigation().flatMap((g) => g.items).map((i) => i.id);
    expect(rail).toEqual(expect.arrayContaining(['workflows', 'agents', 'goals', 'traces', 'artifacts', 'apps', 'store', 'dashboard']));
    expect(tour.isActive.value).toBe(false);
    expect(loadOnionState().fresh).toEqual([]);
  });

  it('an existing account whose fetches resolve BEFORE their data lands still upgrades silently', async () => {
    // Observed live: the app's own startup fetch is in flight, so the onion's
    // dispatch is deduped and resolves at once — empty — and the records land
    // a moment later. That arrival is startup, not news.
    const store = makeStore();
    for (const [ns, action] of [['goals', 'fetchGoals'], ['workflows', 'fetchWorkflows'], ['agents', 'fetchAgents']]) {
      store._actions[`${ns}/${action}`] = [async () => { setTimeout(() => store.commit(`${ns}/add`, { id: `${ns}-1` }), 700); }];
    }
    wrapper = mountHost(store);
    await settle();
    await vi.advanceTimersByTimeAsync(1000);
    await flushPromises();
    const rail = groupedNavigation().flatMap((g) => g.items).map((i) => i.id);
    expect(rail).toEqual(expect.arrayContaining(['goals', 'workflows', 'agents']));
    expect(loadOnionState().fresh).toEqual([]);
    expect(tour.isActive.value).toBe(false);
  });

  it('a change that happened between sessions is still announced on the next launch', async () => {
    // Last session judged Workflows as "not yet". A workflow made elsewhere
    // since then (another device, a schedule) is genuinely new to this person.
    localStorage.setItem(ONION_STORAGE_KEY, JSON.stringify({ version: 1, unlocked: [], seeded: ['workflows'], fresh: [] }));
    const store = makeStore({ workflows: [{ id: 'wf-1' }] });
    wrapper = mountHost(store);
    await settle();
    expect(tour.tourId.value).toBe('onion-workflows');
  });

  it('holds the announcement while something else owns the screen, then delivers it', async () => {
    const store = makeStore();
    const blocked = ref(false);
    const Host = defineComponent({
      setup() {
        useNavigationOnion(store, { teams: ref([]), teamsKnown: ref(true), canAnnounce: blocked });
        return () => h('button', { 'data-tour-id': 'sidebar.apps' }, 'apps');
      },
    });
    wrapper = mount(Host, { attachTo: document.body, global: { plugins: [store] } });
    await startupDone();
    store.commit('appAuth/set', ['gmail']);
    await settle();
    expect(tour.isActive.value).toBe(false);
    blocked.value = true;
    await settle();
    expect(tour.tourId.value).toBe('onion-apps');
  });

  it('waits for a screen tutorial already on screen, then points at the row', async () => {
    // Seen live: the Chat screen's own first-visit popup was open when the
    // first workflow landed, and both drew at once.
    const store = makeStore();
    wrapper = mountHost(store);
    await startupDone();
    const screenTutorial = document.createElement('div');
    screenTutorial.className = 'popup-tutorial';
    document.body.appendChild(screenTutorial);

    store.commit('workflows/add', { id: 'wf-1' });
    await settle();
    expect(tour.isActive.value).toBe(false);
    expect(loadOnionState().fresh).toContain('workflows');

    screenTutorial.remove();
    await vi.advanceTimersByTimeAsync(1600);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(50);
    await flushPromises();
    expect(tour.tourId.value).toBe('onion-workflows');
  });

  it('a row the person hid on purpose unlocks silently', async () => {
    localStorage.setItem('agnt:sidebarNavigation:v1', JSON.stringify({ version: 1, groups: [], items: { 'section:apps': { visible: false } } }));
    const store = makeStore();
    wrapper = mountHost(store);
    await startupDone();
    store.commit('appAuth/set', ['gmail']);
    await settle();
    expect(loadOnionState().unlocked).toContain('apps');
    expect(tour.isActive.value).toBe(false);
  });

  it('visiting the row clears its NEW marker', async () => {
    const store = makeStore();
    wrapper = mountHost(store);
    await startupDone();
    store.commit('goals/add', { id: 'g1' });
    await settle();
    expect(loadOnionState().fresh).toContain('goals');
    wrapper.vm.onion.seen('goals');
    expect(loadOnionState().fresh).not.toContain('goals');
    expect(JSON.parse(localStorage.getItem(ONION_STORAGE_KEY)).fresh).not.toContain('goals');
  });
});
