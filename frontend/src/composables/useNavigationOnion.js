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

// STARTUP IS NOT NEWS. A store action can resolve before its records land —
// it dedupes against the app's own startup fetch already in flight — so a
// row can be judged "none yet" and then see its data a moment later. Any row
// first judged during this session's load, flipping within this window after
// the load settles, is the account loading, not the person doing something:
// it unlocks silently. Rows judged in an EARLIER session keep announcing —
// a workflow made elsewhere since then really is new to them.
const SETTLE_MS = 5000;

// Every coach card — a journey mission or offer, and the AI host's tours —
// renders this attribute only while visible (CoachMark.vue). One popup at a
// time: while another is up, the announcement waits and looks again.
const OTHER_POPUP = '[data-coach-popup]';
const RETRY_MS = 1500;

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
  const seededAtStart = new Set(state.value.seeded);
  let settling = true;
  let hydrateTimer = null;
  let settleTimer = null;
  let retryTimer = null;
  let disposed = false;
  const quiet = (id) => settling && !seededAtStart.has(id);

  const chatCount = () => store.getters['contentOutputs/totalCount'] || len(store.getters['contentOutputs/outputs']);

  // Counts, not arrays. The store adds records IN PLACE (workflows/ADD_WORKFLOW
  // pushes), which leaves an array's identity unchanged — a computed that only
  // held the reference never re-ran, so the first workflow went unnoticed.
  // Reading .length (and copying connectedApps element by element) subscribes
  // to the contents.
  const facts = computed(() => {
    const out = { connectedApps: [...(store.state.appAuth?.connectedApps || [])], teams: len(unref(teams)) };
    for (const [fact, getter] of Object.entries(FACT_GETTERS)) {
      out[fact] = fact === 'chats' ? chatCount() : len(store.getters[getter]);
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
    if (document.querySelector(OTHER_POPUP)) {
      clearTimeout(retryTimer);
      retryTimer = setTimeout(announceNext, RETRY_MS);
      return;
    }
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
    const { state: next, announced } = evaluateUnlocks(facts.value, knownFacts.value, state.value, { quiet });
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

  // Each fact becomes known the moment its own load settles: one slow
  // endpoint must not keep every other row from being judged.
  function markKnown(key) {
    if (disposed || known.value.has(key)) return;
    known.value = new Set([...known.value, key]);
  }

  async function load() {
    const appsLoaded = (async () => {
      if (!storeHas(store, 'appAuth/connectedApps')) return;
      try {
        await store.dispatch('appAuth/fetchConnectedApps');
        markKnown('appAuth');
      } catch {
        /* unknown, not empty — see accountInventory.hydrateOne */
      }
    })();
    await Promise.all([hydrate(store, ONION_HYDRATION, markKnown), appsLoaded]);
    if (!disposed) settleTimer = setTimeout(() => { settling = false; }, SETTLE_MS);
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
    clearTimeout(settleTimer);
    clearTimeout(retryTimer);
    window.removeEventListener(NAVIGATION_CHANGED_EVENT, reload);
  });

  return { state, seen, evaluate };
}
