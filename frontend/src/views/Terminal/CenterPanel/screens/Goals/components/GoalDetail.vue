<template>
  <div class="gd-root">
    <header class="gd-head">
      <span class="gd-status" :class="stageTone"><span class="gd-dot" aria-hidden="true"></span>{{ statusLabel }}</span>
      <h2 class="gd-title">{{ goal.title || 'Untitled goal' }}</h2>
      <details v-if="description.length > 180" class="gd-description">
        <summary>{{ briefText(description, 180) }}</summary>
        <p>{{ description }}</p>
      </details>
      <p v-else-if="description" class="gd-description">{{ description }}</p>
    </header>
    <div v-if="loadError" class="gd-message error" role="alert">
      {{ loadError }} <button type="button" :disabled="loading" @click="loadGoal">Retry loading</button>
    </div>
    <p v-if="loading" class="gd-message" role="status">Loading goal…</p>
    <GoalDetailEvidence :key="goalId" :goal="goal" :tasks="tasks" :is-plan="isPlan">
      <GoalDetailVerdict
        :key="goalId" :can-sign-off="canSignOff" :can-revise="canRevise"
        :approve-label="isPlan ? 'Approve plan' : 'Approve result'"
        :is-paused="goal.status === 'paused'" :can-pause="canPause" :can-run="canRun"
        :busy="busy || loading || !!loadError" :submit-feedback="requestChanges"
        @approve="approveGoal" @pause="pauseGoal" @resume="resumeGoal" @run="runGoal"
      />
      <p v-if="notice" class="gd-message" :class="notice.type" :role="notice.type === 'error' ? 'alert' : 'status'">{{ notice.message }}</p>
    </GoalDetailEvidence>
  </div>
</template>

<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue';
import { useStore } from 'vuex';
import GoalDetailEvidence from './GoalDetailEvidence.vue';
import GoalDetailVerdict from './GoalDetailVerdict.vue';
import { getGoalStage } from '../goalBoard.js';
import { briefText } from '../goalDetailModel.js';

const props = defineProps({ goalId: { type: String, required: true }, goals: { type: Array, default: () => [] } });
const emit = defineEmits(['panel-action']);
const store = useStore();
const busy = ref(false), loading = ref(false), loadError = ref(''), notice = ref(null);
const goal = computed(() => store.getters['goals/getGoalById']?.(props.goalId) || props.goals.find(goal => goal.id === props.goalId) || {});
const description = computed(() => String(goal.value.description || '').trim());
const tasks = computed(() => Array.isArray(goal.value.tasks) ? goal.value.tasks : []);
const statusLabel = computed(() => ({ needs_review: 'Needs review', executing: 'Running', validated: 'Approved' }[goal.value.status]
  || String(goal.value.status || 'Unknown').replace(/_/g, ' ').replace(/^./, letter => letter.toUpperCase())));
const stageTone = computed(() => ['validated', 'completed'].includes(goal.value.status) ? 'good'
  : goal.value.status === 'needs_review' ? 'warn' : ['failed', 'error'].includes(goal.value.status) ? 'bad' : 'plain');
const isPlan = computed(() => getGoalStage(goal.value) === 'plan');
const canSignOff = computed(() => ['needs_review', 'completed'].includes(goal.value.status));
const canRevise = computed(() => ['needs_review', 'completed', 'validated', 'failed', 'error', 'stopped', 'planning'].includes(goal.value.status));
const canPause = computed(() => ['executing', 'queued'].includes(goal.value.status));
const canRun = computed(() => ['planning', 'failed', 'error', 'stopped'].includes(goal.value.status));
let loadEpoch = 0, mounted = true;

async function loadGoal() {
  const id = props.goalId, epoch = ++loadEpoch;
  if (!id) return;
  loading.value = true;
  loadError.value = '';
  try {
    // This endpoint includes the tasks and live goal state. Reports are read
    // by the existing artifact inspector only when the user opens a file.
    await store.dispatch('goals/fetchGoalTasks', id);
  } catch (error) {
    if (mounted && epoch === loadEpoch) loadError.value = 'Could not load goal: ' + error.message;
  } finally {
    if (mounted && epoch === loadEpoch) loading.value = false;
  }
}
watch(() => props.goalId, () => { notice.value = null; loadGoal(); }, { immediate: true });
onBeforeUnmount(() => { mounted = false; loadEpoch++; });

// Pin the goal and view generation across requests: an old response must not
// notify a different goal (including a navigate-away-and-back race).
async function perform(action, payload, message, allowed) {
  if (!allowed || busy.value || loading.value || loadError.value || !props.goalId) return false;
  const id = props.goalId, epoch = loadEpoch;
  busy.value = true;
  notice.value = null;
  const current = () => mounted && id === props.goalId && epoch === loadEpoch;
  try {
    const result = await store.dispatch(action, payload);
    if (current()) {
      notice.value = { type: 'success', message: result?.message || message };
      emit('panel-action', 'show-feedback', notice.value);
    }
    return true;
  } catch (error) {
    console.error('[GoalDetail]', action, error);
    if (current()) notice.value = { type: 'error', message: error.message || 'Action failed' };
    return false;
  } finally {
    if (mounted) busy.value = false;
  }
}
const approveGoal = () => perform('goals/reviewGoal', { goalId: props.goalId, action: 'approve' }, 'Result approved', canSignOff.value);
const requestChanges = text => perform('goals/reviewGoal', { goalId: props.goalId, action: 'reject', feedback: text.trim() }, 'Returned for revision. Use Run goal when ready.', canRevise.value && !!text.trim());
const pauseGoal = () => perform('goals/pauseGoal', props.goalId, 'Goal paused', canPause.value);
const resumeGoal = () => perform('goals/resumeGoal', props.goalId, 'Goal resumed', goal.value.status === 'paused');
const runGoal = () => perform('goals/executeGoalAutonomous', { goalId: props.goalId, maxIterations: goal.value.max_iterations || 50 }, 'Goal execution started', canRun.value);
</script>

<style scoped>
.gd-root { width: 100%; max-width: 702px; min-width: 0; margin: 0 auto; padding-bottom: 32px; color: var(--color-text); }
.gd-status { display: inline-flex; align-items: center; gap: 7px; font-size: 14px; color: var(--color-text-muted); }
.gd-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.gd-status.good { color: var(--text-green); }
.gd-status.warn { color: var(--text-orange); }
.gd-status.bad, .gd-message.error { color: var(--color-red); }
.gd-title { margin: 12px 0 10px; font-size: 29px; font-weight: 600; line-height: 1.18; letter-spacing: -.02em; overflow-wrap: anywhere; }
.gd-description { margin: 0; color: var(--color-text-muted); font-size: 16px; line-height: 1.5; overflow-wrap: anywhere; }
.gd-description summary { cursor: pointer; }
.gd-description p { white-space: pre-wrap; max-height: 240px; overflow-y: auto; }
.gd-message { margin: 16px 0 0; font-size: 14px; line-height: 1.5; overflow-wrap: anywhere; }
.gd-message.success { color: var(--text-green); }
.gd-message button { margin-left: 8px; padding: 5px 10px; font: inherit; color: inherit; background: transparent; border: 1px solid currentColor; border-radius: 5px; cursor: pointer; }
button:focus-visible, summary:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 3px; }
@media (max-width: 540px) { .gd-title { font-size: 25px; } .gd-description { font-size: 15px; } }
</style>
