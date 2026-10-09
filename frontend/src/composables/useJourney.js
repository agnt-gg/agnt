/**
 * useJourney — the runtime behind the getting-started checklist and the
 * page missions (services/journey/missions.js).
 *
 * One instance for the app, installed by JourneyHost (mounted once in App.vue)
 * with the store and router. Everything else — the checklist, Settings → Tours
 * — reads the same instance through useJourney().
 *
 * What it does, and nothing more:
 *   facts     counts read from the live store (agents, workflows, apps…)
 *   events    store mutations/actions mapped by journeySignals.js
 *   gate      a mission step advances when its `until` holds (journeyEngine)
 *   offers    a page offers its mission once per session, only after the
 *             account's data has loaded — offering "make your first agent"
 *             to someone whose agents simply have not arrived yet is a lie
 *   pause     hidden while onboarding, an assistant tour, or Focused mode
 *             owns the screen; resumes where it was
 */
import { computed, reactive, ref, shallowRef, watch } from 'vue';
import { HYDRATION, hydrate, len } from '@/services/accountInventory.js';
import { AI_PROVIDERS_WITH_API } from '@/store/app/aiProvider.js';
import { MISSIONS, PROMPT_ROUTE } from '@/services/journey/missions.js';
import {
  clickSelectors,
  emptyFacts,
  firstVisible,
  getMission,
  journeySummary,
  nextMilestoneAfter,
  offerFor,
  stepSatisfied,
} from '@/services/journey/journeyEngine.js';
import { emptyProgress, loadProgress, offersEnabled, saveProgress, toursEnabled } from '@/services/journey/journeyProgress.js';
import { EVENT_FLAGS, eventForAction, eventForMutation } from '@/services/journey/journeySignals.js';
import { isNavigation, normalizeScreen, screenRoute } from '@/views/Terminal/screenRoute.js';
import { useAITour } from '@/composables/useAITour.js';

const COMPOSER = '[data-tour-id="chat.composer"]';
const OFFER_DELAY_MS = 1200;
const HYDRATE_DELAY_MS = 1500;
const SETTLE_TIMEOUT_MS = 10000;
const EXCLUDED_PATHS = ['/m', '/pair', '/oauth-callback', '/docs'];

const FACT_GETTERS = Object.freeze({
  agents: 'agents/allAgents',
  workflows: 'workflows/allWorkflows',
  goals: 'goals/allGoals',
  schedules: 'schedules/allSchedules',
  skills: 'skills/allSkills',
  tools: 'tools/customTools',
  widgets: 'widgetDefinitions/allDefinitions',
  executions: 'executionHistory/getExecutions',
  memories: 'memory/agentMemories',
});
const JOURNEY_HYDRATION = HYDRATION.filter(([getter]) => Object.values(FACT_GETTERS).includes(getter) || getter === 'contentOutputs/outputs');

// 'agnt' is AGNT Flash, which every signed-in account has: not a choice.
const AI_KEYS = new Set([...AI_PROVIDERS_WITH_API, 'local'].map((key) => String(key).toLowerCase()).filter((key) => key !== 'agnt'));

/** Counts the journey reads, from the live store. Exported for its spec. */
export function readFacts(store) {
  const facts = emptyFacts();
  const getters = store.getters || {};
  for (const [fact, getter] of Object.entries(FACT_GETTERS)) facts[fact] = len(getters[getter]);
  facts.chats = getters['contentOutputs/totalCount'] || len(getters['contentOutputs/outputs']);
  const connected = (store.state?.appAuth?.connectedApps || []).map((app) => String(app).toLowerCase()).filter((app) => app && app !== 'agnt');
  facts.aiModels = connected.filter((app) => AI_KEYS.has(app)).length + len(store.state?.aiProvider?.customProviders);
  facts.apps = connected.filter((app) => !AI_KEYS.has(app)).length;
  return facts;
}

// ── Singleton state ───────────────────────────────────────────────────────
const progress = ref(emptyProgress());
const run = ref(null); // { kind: 'offer'|'mission'|'next'|'celebrate', missionId, index, baseline, events, clicks }
const settled = ref(false);
const settingsTick = ref(0);
const factsRef = ref(emptyFacts());
// Reactive, so every computed below re-reads it: a plain variable left them
// cached against the PREVIOUS install after a sign-out and sign-in.
const runtimeRef = shallowRef(null);

function account() {
  const getters = runtimeRef.value?.store?.getters || {};
  return getters['userAuth/userEmail'] || runtimeRef.value?.store?.state?.userAuth?.user?.id || null;
}

function persist(next) {
  progress.value = saveProgress(account(), next);
}

function currentScreen() {
  return runtimeRef.value?.router?.currentRoute?.value?.meta?.terminalScreen || null;
}

function currentMission() {
  return run.value ? getMission(run.value.missionId) : null;
}

function currentStep() {
  const mission = currentMission();
  return run.value?.kind === 'mission' && mission ? mission.steps[run.value.index] || null : null;
}

const summary = computed(() => journeySummary(factsRef.value, progress.value.flags));

/** Whether anything of the journey may be on screen right now. */
const canShow = computed(() => {
  void settingsTick.value; // re-read the localStorage switches when Settings changes them
  if (!runtimeRef.value) return false;
  const { store, router } = runtimeRef.value;
  if (!store.getters['userAuth/isAuthenticated']) return false;
  if (store.getters['userAuth/shouldShowOnboarding']) return false;
  if (store.getters['theme/uiMode'] === 'focused') return false;
  if (runtimeRef.value.aiTour.isActive.value) return false;
  const path = router.currentRoute.value?.path || '';
  if (EXCLUDED_PATHS.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) return false;
  return toursEnabled();
});

function navigate(route) {
  if (!runtimeRef.value || !route?.screen) return;
  const [screen, options] = normalizeScreen(route.screen, route.options || {});
  const target = screenRoute(screen, options);
  if (!target) return;
  const { router } = runtimeRef.value;
  if (!isNavigation(target, router.currentRoute.value?.path)) return;
  router.push({ path: target.path, query: target.query }).catch(() => {
    /* a duplicate or superseded navigation is not an error here */
  });
}

function enterStep() {
  const step = currentStep();
  if (!step) return;
  run.value = { ...run.value, baseline: { ...factsRef.value }, events: reactive(new Set()), clicks: reactive(new Set()) };
  if (step.route) navigate(step.route);
}

function end() {
  run.value = null;
}

function complete() {
  const missionId = run.value?.missionId;
  const mission = getMission(missionId);
  persist({ ...progress.value, done: { ...progress.value.done, [missionId]: true } });
  if (!mission?.milestone) return end();
  const next = nextMilestoneAfter(missionId, factsRef.value, progress.value.flags, progress.value);
  if (next) {
    run.value = { kind: 'next', missionId: next.mission, finished: missionId };
    return;
  }
  end();
}

function advance() {
  const mission = currentMission();
  if (!mission || run.value?.kind !== 'mission') return;
  const index = run.value.index + 1;
  if (index >= mission.steps.length) return complete();
  run.value = { ...run.value, index };
  enterStep();
}

function evaluate() {
  const step = currentStep();
  if (!step?.until) return;
  const satisfied = stepSatisfied(step.until, {
    facts: factsRef.value,
    baseline: run.value.baseline,
    events: run.value.events,
    clicks: run.value.clicks,
    flags: progress.value.flags,
    target: step.target,
  });
  if (satisfied) advance();
}

function setFlag(name) {
  if (!name || progress.value.flags[name]) return;
  persist({ ...progress.value, flags: { ...progress.value.flags, [name]: true } });
}

function record(event) {
  if (!event) return;
  if (EVENT_FLAGS[event]) setFlag(EVENT_FLAGS[event]);
  if (run.value?.kind === 'mission') run.value.events.add(event);
}

/** Start a mission now. From the checklist, Settings, an offer, or "next up". */
function startMission(id) {
  if (!runtimeRef.value || !MISSIONS[id]) return;
  if (runtimeRef.value.aiTour.isActive.value) runtimeRef.value.aiTour.end('journey_started');
  run.value = { kind: 'mission', missionId: id, index: 0 };
  enterStep();
}

function offerMission(screen) {
  if (run.value || !settled.value || !canShow.value || !offersEnabled()) return;
  if (runtimeRef.value.offered.has(screen)) return;
  const id = offerFor(screen, { facts: factsRef.value, flags: progress.value.flags, progress: progress.value });
  if (!id) return;
  runtimeRef.value.offered.add(screen);
  clearTimeout(runtimeRef.value.offerTimer);
  runtimeRef.value.offerTimer = setTimeout(() => {
    if (run.value || currentScreen() !== screen || !canShow.value) return;
    run.value = { kind: 'offer', missionId: id };
  }, OFFER_DELAY_MS);
}

/** Put a starter message in the chat composer, ready to edit and send. */
async function usePrompt(text) {
  if (!text) return;
  navigate(PROMPT_ROUTE);
  // Chat registers its listener after its own startup awaits, so a single
  // dispatch can land before anyone is listening. Re-send until the composer
  // shows the text, for a bounded few seconds.
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const textarea = firstVisible(COMPOSER)?.querySelector('textarea');
    if (textarea && textarea.value === text) return;
    if (textarea) window.dispatchEvent(new CustomEvent('agnt:ask-annie', { detail: { text, send: false } }));
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

function handleAction(id) {
  const kind = run.value?.kind;
  const missionId = run.value?.missionId;
  if (id === 'start' || id === 'start-next') return startMission(missionId);
  if (id === 'next' || id === 'skip') return advance();
  if (id === 'return') {
    const step = currentStep();
    return step?.route ? navigate(step.route) : undefined;
  }
  if (id.startsWith('flag:')) return setFlag(id.slice(5));
  if (id === 'dismiss' || (id === 'close' && (kind === 'offer' || kind === 'mission'))) {
    // Turned down or abandoned: do not offer it again. The checklist and
    // Settings can still start it.
    persist({ ...progress.value, dismissed: { ...progress.value.dismissed, [missionId]: true } });
    return end();
  }
  if (kind === 'celebrate') persist({ ...progress.value, celebrated: true });
  return end();
}

/** The card the coach should show, or null. Plain data for CoachMark.vue. */
const view = computed(() => {
  if (!run.value || !canShow.value) return null;
  const { kind } = run.value;
  if (kind === 'celebrate') {
    return {
      key: 'celebrate',
      eyebrow: `${summary.value.total} of ${summary.value.total} done`,
      title: 'Zero to hero.',
      content: 'Model, chat, apps, agents, workflows, runs, goals and skills: you have used all of it. From here, ask Annie for anything.',
      actions: [{ id: 'later', label: 'Close', primary: true }],
    };
  }
  const mission = currentMission();
  if (!mission) return null;
  const steps = mission.steps.length;
  if (kind === 'offer') {
    return {
      key: `offer:${run.value.missionId}`,
      compact: true,
      eyebrow: steps === 1 ? 'One step' : `${steps} steps`,
      title: mission.title,
      content: mission.pitch,
      actions: [
        { id: 'start', label: 'Show me', primary: true },
        { id: 'dismiss', label: 'Not now' },
      ],
    };
  }
  if (kind === 'next') {
    return {
      key: `next:${run.value.missionId}`,
      eyebrow: `${summary.value.done} of ${summary.value.total} done`,
      title: 'Done. Next up:',
      content: `${mission.title}. ${mission.pitch}`,
      actions: [
        { id: 'start-next', label: "Let's go", primary: true },
        { id: 'later', label: 'Later' },
      ],
    };
  }
  const step = currentStep();
  if (!step) return null;
  const last = run.value.index === steps - 1;
  return {
    key: `${run.value.missionId}:${run.value.index}`,
    eyebrow: mission.title,
    progress: steps > 1 ? `${run.value.index + 1} of ${steps}` : null,
    title: step.title,
    content: step.content,
    target: step.target || null,
    placement: step.placement || 'bottom',
    prompts: step.prompts || [],
    waiting: !!step.until,
    canReturn: !!step.route,
    actions: [
      ...(step.actions || []).map((action) => ({ id: `flag:${action.flag}`, label: action.label })),
      ...(step.until ? [] : [{ id: 'next', label: last ? 'Done' : 'Next', primary: true }]),
    ],
    secondary: step.until ? { id: 'skip', label: last ? 'Skip' : 'Skip step' } : null,
  };
});

const checklist = computed(() => {
  void settingsTick.value;
  const all = summary.value.done === summary.value.total;
  return {
    ...summary.value,
    visible: settled.value && canShow.value && !progress.value.checklistHidden && !all,
  };
});

function onDocumentClick(event) {
  const step = currentStep();
  if (!step || !run.value?.clicks) return;
  for (const selector of clickSelectors(step)) {
    try {
      if (event.target?.closest?.(selector)) run.value.clicks.add(selector);
    } catch {
      /* invalid selector: cannot be clicked */
    }
  }
}

async function settle() {
  const { store } = runtimeRef.value;
  try {
    await Promise.race([
      Promise.all([hydrate(store, JOURNEY_HYDRATION), store.dispatch('appAuth/fetchConnectedApps').catch(() => {})]),
      new Promise((resolve) => setTimeout(resolve, SETTLE_TIMEOUT_MS)),
    ]);
  } catch (error) {
    console.warn('[journey] could not load account inventory:', error?.message || error);
  }
  if (!runtimeRef.value) return;
  factsRef.value = readFacts(store);
  // Everything already done when we arrive is not news: no celebration for
  // an account that finished the journey before this release.
  if (summary.value.done === summary.value.total && !progress.value.celebrated) persist({ ...progress.value, celebrated: true });
  settled.value = true;
  const screen = currentScreen();
  if (screen) offerMission(screen);
}

/**
 * Install the runtime. Idempotent; returns a disposer.
 * @param {{ store: object, router: object }} deps
 */
export function installJourney({ store, router }) {
  if (runtimeRef.value) return uninstallJourney;
  runtimeRef.value = { store, router, aiTour: useAITour(), offered: new Set(), offerTimer: null, stops: [] };
  const { stops } = runtimeRef.value;

  progress.value = loadProgress(account());
  factsRef.value = readFacts(store);

  stops.push(watch(() => readFacts(store), (facts) => { factsRef.value = facts; }, { deep: true }));
  stops.push(watch(account, (who) => { progress.value = loadProgress(who); end(); }));
  stops.push(store.subscribe((mutation) => record(eventForMutation(mutation))));
  stops.push(store.subscribeAction({ after: (action) => record(eventForAction(action)) }));
  stops.push(
    watch(
      () => [factsRef.value, progress.value.flags, run.value?.events?.size, run.value?.clicks?.size, run.value?.index],
      evaluate,
      { deep: true },
    ),
  );
  stops.push(watch(() => router.currentRoute.value?.meta?.terminalScreen, (screen) => screen && offerMission(screen)));
  // Onboarding finishing, or an assistant tour ending, uncovers the page the
  // person is already on: no route change, so offer from here.
  stops.push(watch(canShow, (visible) => { const screen = currentScreen(); if (visible && screen) offerMission(screen); }));
  stops.push(
    watch(
      () => summary.value.done === summary.value.total,
      (all) => {
        if (all && settled.value && !progress.value.celebrated && !run.value) run.value = { kind: 'celebrate' };
      },
    ),
  );
  document.addEventListener('click', onDocumentClick, true);
  stops.push(() => document.removeEventListener('click', onDocumentClick, true));

  const timer = setTimeout(settle, HYDRATE_DELAY_MS);
  stops.push(() => clearTimeout(timer));
  return uninstallJourney;
}

export function uninstallJourney() {
  if (!runtimeRef.value) return;
  clearTimeout(runtimeRef.value.offerTimer);
  runtimeRef.value.stops.forEach((stop) => stop());
  runtimeRef.value = null;
  run.value = null;
  settled.value = false;
}

/** The shared journey API. Safe to call before install: actions no-op. */
export function useJourney() {
  return {
    view,
    checklist,
    run,
    progress,
    startMission,
    handleAction,
    usePrompt,
    end,
    /** Settings changed a tours switch in localStorage. */
    refreshSettings: () => { settingsTick.value += 1; },
    setChecklistHidden: (hidden) => persist({ ...progress.value, checklistHidden: !!hidden }),
    resetProgress: () => {
      end();
      if (runtimeRef.value) runtimeRef.value.offered.clear();
      persist(emptyProgress());
    },
  };
}
