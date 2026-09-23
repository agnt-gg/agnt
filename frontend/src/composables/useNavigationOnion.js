// useNavigationOnion — feeds the pure onion engine from the live store and
// turns each genuine unlock into one short, anchored tour step.
//
// Mounted once, by the canvas that owns the rail. Everything it knows comes
// from state the app already keeps live (realtime sync updates agents,
// workflows, goals, tools and executions as they are created — including when
// Annie creates them from chat), so an unlock lands in the same session it
// happens in, with no polling.

import { computed, nextTick, onBeforeUnmount, onMounted, ref, unref, watch } from 'vue';
import { hydrate, len, storeHas } from '@/services/accountInventory.js';
import {
  UNLOCK_RULE_BY_ID,
  evaluateUnlocks,
  loadOnionState,
  markSeen,
  saveOnionState,
} from '@/services/navigationOnion.js';
import { NAVIGATION_CHANGED_EVENT, groupedNavigation } from '@/services/navigationPreferences.js';
import { useAITour } from '@/composables/useAITour.js';

// Fact name → the getter that answers it. `connectedApps` and `teams` are fed
// separately: the first is loaded by appAuth at startup, the second by the
// canvas' own team request.
const FACT_GETTERS = {
  chats: 'contentOutputs/outputs',
  executions: 'executionHistory/getExecutions',
  goals: 'goals/allGoals',
  workflows: 'workflows/allWorkflows',
  agents: 'agents/allAgents',
  tools: 'tools/customTools',
  widgets: 'widgetDefinitions/allDefinitions',
  skills: 'skills/allSkills',
};

// Only what the rules read: loading memories or insights here would be work
// with no row depending on it.
const ONION_HYDRATION = [
  ['goals/allGoals', 'goals/fetchGoals'],
  ['agents/allAgents', 'agents/fetchAgents'],
  ['workflows/allWorkflows', 'workflows/fetchWorkflows'],
  ['tools/customTools', 'tools/fetchTools'],
  ['skills/allSkills', 'skills/fetchSkills'],
  ['widgetDefinitions/allDefinitions', 'widgetDefinitions/fetchDefinitions'],
  ['executionHistory/getExecutions', 'executionHistory/fetchExecutions'],
  ['contentOutputs/outputs', 'contentOutputs/fetchOutputs', { limit: 1, offset: 0, loadAll: false, force: true }],
];

// First paint belongs to the chat. The counts can wait a beat.
const HYDRATE_DELAY_MS = 1200;

/**
 * @param {object} store  vuex store
 * @param {object} options
 * @param {import('vue').Ref<Array>}   options.teams        teams the canvas loaded
 * @param {import('vue').Ref<boolean>} options.teamsKnown   true once that load succeeded
 * @param {import('vue').Ref<boolean>} options.canAnnounce  false while a tour or
 *        onboarding owns the screen, or the rail is a closed mobile drawer
 */
export function useNavigationOnion(store, { teams, teamsKnown, canAnnounce }) {
  const tour = useAITour();
  const state = ref(loadOnionState());
  const known = ref(new Set());
  const queue = [];
  let hydrateTimer = null;
  let disposed = false;

  const chatCount = () => store.getters['contentOutputs/totalCount'] || len(store.getters['contentOutputs/outputs']);

  const facts = computed(() => {
    const out = { connectedApps: store.state.appAuth?.connectedApps || [], teams: unref(teams) || [] };
    for (const [fact, getter] of Object.entries(FACT_GETTERS)) {
      out[fact] = fact === 'chats' ? chatCount() : store.getters[getter] || [];
    }
    return out;
  });

  const knownFacts = computed(() => {
    const names = new Set();
    for (const [fact, getter] of Object.entries(FACT_GETTERS)) {
      if (known.value.has(getter)) names.add(fact);
    }
    // appAuth loads at startup; a non-empty list is proof it has, and an empty
    // one is trusted once its own fetch has resolved (tracked below).
    if (known.value.has('appAuth') || len(store.state.appAuth?.connectedApps) > 0) names.add('connectedApps');
    if (unref(teamsKnown)) names.add('teams');
    return names;
  });

  function isOnRail(id) {
    return groupedNavigation().some((group) => group.items.some((item) => item.id === id));
  }

  async function announceNext() {
    if (disposed || !queue.length || tour.isActive.value || !unref(canAnnounce)) return;
    const id = queue.shift();
    const rule = UNLOCK_RULE_BY_ID[id];
    // A row the person hid on purpose stays hidden — and stays quiet.
    if (!rule || !isOnRail(id)) return announceNext();
    await nextTick();
    // One frame so the new row has been laid out before the popup measures it.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const target = `[data-tour-id="sidebar.${id}"]`;
    if (!document.querySelector(target)) return announceNext();
    tour.start({
      tourId: `onion-${id}`,
      title: rule.title,
      steps: [{ title: rule.title, content: rule.message, targetSelector: target, position: 'right' }],
    });
  }

  function evaluate() {
    const { state: next, announced } = evaluateUnlocks(facts.value, knownFacts.value, state.value);
    const changed =
      next.unlocked.length !== state.value.unlocked.length ||
      next.seeded.length !== state.value.seeded.length ||
      next.fresh.length !== state.value.fresh.length;
    if (!changed) return;
    state.value = saveOnionState(next);
    window.dispatchEvent(new CustomEvent(NAVIGATION_CHANGED_EVENT));
    // Several rows can open in one pass (the first workflow also opens the
    // Store). Every one gets its new-marker; only the first gets the popup —
    // a stack of congratulations is noise.
    if (announced.length) {
      queue.push(announced[0]);
      announceNext();
    }
  }

  function seen(id) {
    const next = markSeen(id, state.value);
    if (next === state.value) return;
    state.value = saveOnionState(next);
    window.dispatchEvent(new CustomEvent(NAVIGATION_CHANGED_EVENT));
  }

  // Another window (a second space, Settings → Navigation "Reset") changed the
  // stored state: adopt it rather than overwrite it on our next evaluation.
  function reload() {
    state.value = loadOnionState();
  }

  async function load() {
    const loaded = await hydrate(store, ONION_HYDRATION);
    if (storeHas(store, 'appAuth/connectedApps')) {
      try {
        await store.dispatch('appAuth/fetchConnectedApps');
        loaded.add('appAuth');
      } catch {
        /* unknown, not empty — see accountInventory.hydrate */
      }
    }
    if (!disposed) known.value = new Set([...known.value, ...loaded]);
  }

  watch([facts, knownFacts], evaluate, { deep: false });
  watch(
    () => [tour.isActive.value, unref(canAnnounce)],
    () => announceNext(),
  );

  onMounted(() => {
    window.addEventListener(NAVIGATION_CHANGED_EVENT, reload);
    hydrateTimer = setTimeout(load, HYDRATE_DELAY_MS);
  });
  onBeforeUnmount(() => {
    disposed = true;
    clearTimeout(hydrateTimer);
    window.removeEventListener(NAVIGATION_CHANGED_EVENT, reload);
  });

  return { state, seen, evaluate };
}
