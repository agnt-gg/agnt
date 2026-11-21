<template>
  <!-- Every run, newest first. Open one to read its result; its steps are one click further. -->
  <section class="rr" aria-label="Runs" data-testid="routine-runs">
    <div class="sec-head"><h3>Runs</h3><span class="rr-sum">{{ summary }}</span></div>
    <ul class="list">
      <li v-if="!loaded" class="empty">Loading…</li>
      <li v-else-if="!runs.length" class="empty">No runs yet.</li>
      <li v-for="run in shown" :key="run.id" :data-run="run.id">
        <button type="button" class="r rr-row" :aria-expanded="String(open === run.id)" @click="toggle(run)">
          <span class="col-dot" :style="{ background: runTone(run.status).color }" aria-hidden="true"></span>
          <span class="rr-when">{{ formatRunTime(parseServerTime(run.fired_at)) }}</span>
          <span class="rr-status">{{ line(run) }}</span>
          <MkIcon name="down" size="xs" class="rr-chev" :class="{ open: open === run.id }" />
        </button>
        <div v-if="open === run.id" class="rr-detail" data-testid="run-detail">
          <p v-if="detail.loading" class="rr-note">Loading…</p>
          <p v-else-if="detail.error" class="rr-error">{{ detail.error }}</p>
          <template v-else>
            <p v-if="run.error && run.status !== 'needs_input'" class="rr-error">{{ run.error }}</p>
            <!-- eslint-disable-next-line vue/no-v-html -- sanitized with DOMPurify (markdown) -->
            <div v-if="result" class="rr-md" data-testid="run-result" v-html="markdown(result.content)"></div>
            <p v-else-if="run.status === 'needs_input' && run.id === runs[0]?.id" class="rr-note">Waiting for your answer above.</p>
            <p v-else-if="waitingQuestion(run)" class="rr-note">It stopped to ask: {{ waitingQuestion(run) }}</p>
            <p v-else-if="detail.output" class="rr-note">This run left nothing to read.</p>
            <p v-else class="rr-note">This run is from before AGNT kept each run’s result. <button type="button" class="link" @click="openInGoals(run)">Open it in Goals</button></p>
            <template v-if="steps.length > 1">
              <button type="button" class="link rr-steps-toggle" @click="stepsOpen = !stepsOpen">{{ stepsOpen ? 'Hide steps' : `Show all ${steps.length} steps` }}</button>
              <ol v-if="stepsOpen" class="rr-steps" data-testid="run-steps">
                <li v-for="(task, index) in steps" :key="index">
                  <div class="rr-step-h"><span class="tag" :class="taskTone(task.status).tag">{{ taskTone(task.status).label }}</span>{{ task.title }}</div>
                  <p v-if="task.error" class="rr-error">{{ task.error }}</p>
                  <!-- eslint-disable-next-line vue/no-v-html -- sanitized with DOMPurify (markdown) -->
                  <div v-if="task.content && task !== result" class="rr-md" v-html="markdown(task.content)"></div>
                </li>
              </ol>
            </template>
          </template>
        </div>
      </li>
    </ul>
    <button v-if="shown.length < runs.length" type="button" class="btn sm rr-more" @click="limit += PAGE">Show older runs</button>
  </section>
</template>

<script setup>
import { computed, inject, onMounted, reactive, ref } from 'vue';
import { useStore } from 'vuex';
import DOMPurify from 'dompurify';
import { renderMarkdown } from '@/utils/markdownPipeline.js';
import { parseServerTime } from '@/utils/serverTime.js';
import MkIcon from '@/views/One/mk/MkIcon.vue';
import { runTone, runStats } from '@/views/One/team/teamModel.js';
import { formatRunTime, formatDuration } from './focusedTime.js';
import { runOutputFromGoalTasks, goalTasksAreFromRun, taskTone, resultOf, waitingQuestion } from './routineRuns.js';

const PAGE = 50;
const HISTORY_LIMIT = 500;
const props = defineProps({ routine: { type: Object, required: true } });
const emit = defineEmits(['loaded']);
const store = useStore();
const nav = inject('focusedNav');

const runs = ref([]);
const loaded = ref(false);
const limit = ref(PAGE);
const open = ref(null);
const stepsOpen = ref(false);
const detail = reactive({ loading: false, error: '', output: null });
const cache = new Map();

const shown = computed(() => runs.value.slice(0, limit.value));
const steps = computed(() => detail.output?.tasks || []);
const result = computed(() => resultOf(detail.output));
const summary = computed(() => {
  if (!loaded.value || !runs.value.length) return '';
  const total = Math.max(props.routine.runCount || 0, runs.value.length);
  const { finishedShare } = runStats(runs.value);
  return `${total} run${total === 1 ? '' : 's'}${finishedShare === null ? '' : ` · ${finishedShare}% finished`}`;
});

const line = (run) => [runTone(run.status).label, formatDuration(run.duration_ms)].filter(Boolean).join(' · ');
const markdown = (text) => DOMPurify.sanitize(renderMarkdown(text), { FORBID_TAGS: ['iframe', 'script', 'object', 'embed', 'form', 'input'] });

/** What a run produced: kept with the run, else (newest run only) the goal's current results. */
async function outputOf(run) {
  if (cache.has(run.id)) return cache.get(run.id);
  let output = null;
  if (run.has_output) {
    output = (await store.dispatch('schedules/fetchRun', { scheduleId: props.routine.id, runId: run.id }))?.output || null;
  } else if (props.routine.goalId && run.id === runs.value[0]?.id) {
    const goal = await store.dispatch('goals/fetchGoalTasks', props.routine.goalId).catch(() => null);
    if (goal && goalTasksAreFromRun(run, runs.value[0], goal.tasks)) output = runOutputFromGoalTasks(goal.tasks);
  }
  cache.set(run.id, output);
  return output;
}

async function toggle(run) {
  if (open.value === run.id) { open.value = null; return; }
  open.value = run.id;
  stepsOpen.value = false;
  Object.assign(detail, { loading: true, error: '', output: null });
  try {
    const output = await outputOf(run);
    if (open.value === run.id) detail.output = output;
  } catch (error) {
    if (open.value === run.id) detail.error = `Couldn’t load this run. ${error?.message || error}`;
  } finally {
    if (open.value === run.id) detail.loading = false;
  }
}

function openInGoals(run) {
  const goalId = run.run_target_id || run.target_id || props.routine.goalId;
  if (goalId) nav.openScreen('GoalsScreen', { select: { kind: 'goal', id: goalId } });
}

/** Loads the history and opens the newest run, so the page shows what the routine last did. */
async function load() {
  const list = await store.dispatch('schedules/fetchRunHistory', { scheduleId: props.routine.id, limit: HISTORY_LIMIT });
  runs.value = (Array.isArray(list) ? list : []).slice().sort((a, b) => parseServerTime(b.fired_at) - parseServerTime(a.fired_at));
  loaded.value = true;
  cache.clear();
  open.value = null;
  emit('loaded', runs.value);
  if (runs.value[0]) await toggle(runs.value[0]);
}

onMounted(load);
defineExpose({ load });
</script>

<style scoped>
.rr-sum { font-size: 12.5px; color: var(--text-tertiary); }
.mk .r.rr-row { gap: 10px; padding: 9px 14px; }
.rr-when { font-size: 13.5px; font-weight: 500; color: var(--text-primary); }
.rr-status { flex: 1; font-size: 12.5px; color: var(--text-secondary); }
.rr-chev { color: var(--text-secondary); transition: transform 0.15s; }
.rr-chev.open { transform: rotate(180deg); }
.rr-detail { padding: 0 14px 14px 32px; display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
.rr-note { margin: 0; font-size: 12.5px; color: var(--text-tertiary); }
.rr-error { margin: 0; font-size: 13px; color: var(--danger); white-space: pre-wrap; word-break: break-word; }
.rr-steps-toggle { font-size: 12.5px; }
.rr-steps { margin: 0; padding: 0 0 0 18px; display: flex; flex-direction: column; gap: 10px; width: 100%; box-sizing: border-box; }
.rr-step-h { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-primary); margin-bottom: 4px; }
.rr-more { margin: 10px auto 0; display: flex; }
/* The result body: FocusedActivityDetail's markdown block. */
.rr-md { box-sizing: border-box; width: 100%; max-height: 420px; overflow: auto; padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--sunken); font-size: 13.5px; line-height: 1.55; color: var(--text-primary); }
.rr-md :deep(> :first-child) { margin-top: 0; }
.rr-md :deep(> :last-child) { margin-bottom: 0; }
.rr-md :deep(table) { border-collapse: collapse; margin: 8px 0; }
.rr-md :deep(th), .rr-md :deep(td) { padding: 6px 10px; border: 1px solid var(--line); text-align: left; }
</style>
