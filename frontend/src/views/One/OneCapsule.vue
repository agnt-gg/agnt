<template>
  <div v-if="!flags.hidden" ref="rootEl" class="one-capsule-anchor">
    <!-- The only onboarding chrome: progress through the first ten minutes.
         Every step is a sentence to Annie (or, for the model, the picker). -->
    <button
      type="button"
      class="one-capsule"
      :class="{ 'is-set': summary.complete }"
      data-testid="one-capsule"
      aria-haspopup="dialog"
      :aria-expanded="open ? 'true' : 'false'"
      :aria-label="summary.complete ? 'Getting started: all set' : `Getting started: ${summary.done} of ${summary.total} done`"
      @click="open = !open"
    >
      <span v-if="summary.complete" class="one-check" aria-hidden="true"><svg viewBox="0 0 24 24"><path :d="CHECK" /></svg></span>
      <svg v-else class="one-ring" viewBox="0 0 20 20" aria-hidden="true">
        <circle class="one-ring-track" cx="10" cy="10" r="8" />
        <circle class="one-ring-value" cx="10" cy="10" r="8" :style="{ strokeDashoffset: offset }" />
      </svg>
      <span v-if="summary.complete">All set</span>
      <span v-else>{{ summary.done }} <span class="one-capsule-of">of {{ summary.total }}</span></span>
    </button>

    <div v-if="open" class="one-pop" role="dialog" aria-label="Your first ten minutes" data-testid="one-pop" @keydown.esc="open = false">
      <div class="one-pop-head">
        <svg class="one-ring one-ring-lg" viewBox="0 0 20 20" aria-hidden="true">
          <circle class="one-ring-track" cx="10" cy="10" r="8" />
          <circle class="one-ring-value" cx="10" cy="10" r="8" :style="{ strokeDashoffset: offset }" />
        </svg>
        <div>
          <div class="one-pop-title">Your first ten minutes</div>
          <div class="one-pop-sub">{{ summary.complete ? 'All set. From here, just ask.' : `${summary.done} of ${summary.total} done` }}</div>
        </div>
      </div>
      <button
        v-for="step in summary.steps"
        :key="step.id"
        type="button"
        class="one-step"
        :class="{ 'is-done': step.done, 'is-current': step.current }"
        :data-testid="`one-step-${step.id}`"
        :disabled="step.done || !step.action"
        @click="run(step)"
      >
        <span v-if="step.done" class="one-check one-check-ink" aria-hidden="true"><svg viewBox="0 0 24 24"><path :d="CHECK" /></svg></span>
        <span v-else class="one-step-dot" aria-hidden="true"></span>
        <span class="one-step-body">
          <span class="one-step-title">{{ step.title }}<span v-if="step.optional" class="one-step-optional">optional</span></span>
          <span v-if="step.hint && !step.done" class="one-step-hint">{{ step.hint }}</span>
        </span>
        <span v-if="step.current" class="one-step-ask">{{ step.action?.kind === 'models' ? 'Connect' : 'Ask' }}</span>
      </button>
      <div class="one-pop-foot">
        <span>Every step is one click</span>
        <button type="button" class="one-pop-hide" data-testid="one-capsule-hide" @click="hide">Hide</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useStore } from 'vuex';
import { readFacts } from '@/composables/useJourney.js';
import { HYDRATION, hydrate } from '@/services/accountInventory.js';
import { canScheduleGoals } from '@/services/scheduledGoalsPlan.js';
import { isAhaRequest, loadOneFlags, oneSummary, ringOffset, saveOneFlags } from './oneModel.js';

const emit = defineEmits(['ask', 'open-models']);
const CHECK = 'M5 12.5l4.5 4.5L19 7.5';
// Only what the seven goals and the rail read; the rest loads with its page.
const NEEDED = new Set(['workflows/allWorkflows', 'agents/allAgents', 'tools/customTools', 'skills/allSkills', 'contentOutputs/outputs']);
// Schedules are a paid feature: the endpoint answers 403 to any other plan,
// so they load only once the plan is known to include them.
const SCHEDULES = 'schedules/allSchedules';

const store = useStore();
const open = ref(false);
const rootEl = ref(null);

const account = computed(() => store.getters['userAuth/userEmail'] || store.state.userAuth?.user?.id || null);
const flags = ref(loadOneFlags(account.value));
watch(account, (who) => { flags.value = loadOneFlags(who); });
function setFlags(next) {
  flags.value = saveOneFlags(account.value, { ...flags.value, ...next });
}

const apps = computed(() => store.state.appAuth?.connectedApps || []);
const summary = computed(() => oneSummary({ facts: readFacts(store), apps: apps.value, flags: flags.value }));
const offset = computed(() => ringOffset(summary.value.done, summary.value.total));

// The ah-ha is done once it is actually ASKED with Google there to answer it:
// asking before Google is connected only gets you the connect card.
const lastUserText = computed(() => {
  const messages = store.state.chat?.messages || [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'user') return typeof messages[i].content === 'string' ? messages[i].content : '';
  }
  return '';
});
watch(lastUserText, (text) => {
  if (flags.value.aha || !isAhaRequest(text)) return;
  if (!apps.value.map((app) => String(app).toLowerCase()).includes('google')) return;
  setFlags({ aha: true });
});

// The plan can arrive after mount (the subscription loads in the background).
watch(
  () => canScheduleGoals(store.getters['userAuth/planType']),
  (can) => { if (can) hydrate(store, HYDRATION.filter(([getter]) => getter === SCHEDULES)); },
  { immediate: true },
);

function run(step) {
  open.value = false;
  if (step.action?.kind === 'ask') emit('ask', step.action.text);
  else if (step.action?.kind === 'models') emit('open-models');
}
function hide() {
  open.value = false;
  setFlags({ hidden: true });
}

function onDocumentClick(event) {
  if (open.value && !rootEl.value?.contains(event.target)) open.value = false;
}
function onKeydown(event) {
  if (event.key === 'Escape') open.value = false;
}
onMounted(() => {
  document.addEventListener('click', onDocumentClick, true);
  document.addEventListener('keydown', onKeydown);
  hydrate(store, HYDRATION.filter(([getter]) => NEEDED.has(getter)));
  store.dispatch('appAuth/fetchConnectedApps').catch((error) => {
    console.warn('[AGNT One] connected apps unavailable:', error?.message || error);
  });
});
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick, true);
  document.removeEventListener('keydown', onKeydown);
});
</script>
