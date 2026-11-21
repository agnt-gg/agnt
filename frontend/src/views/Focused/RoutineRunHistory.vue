<template>
  <!-- Every run of a routine, newest first; open one to read what it produced. -->
  <section class="rr" aria-label="Runs" data-testid="routine-runs">
    <div class="sec-head"><h3>Runs</h3><span class="rr-sum">{{ summary }}</span></div>
    <ul class="list">
      <li v-if="!loaded" class="empty">Loading…</li>
      <li v-else-if="!runs.length" class="empty">No runs yet. Run it now to see what it does.</li>
      <li v-for="run in shown" :key="run.id" :data-run="run.id">
        <button type="button" class="r rr-row" :aria-expanded="String(open === run.id)" @click="toggle(run)">
          <span class="col-dot" :style="{ background: runTone(run.status).color }" aria-hidden="true"></span>
          <span class="r-text"><strong>{{ formatRunTime(parseServerTime(run.fired_at)) }}</strong><small>{{ line(run) }}</small></span>
          <span class="r-go">{{ open === run.id ? 'Hide' : 'Details' }}</span>
        </button>
        <div v-if="open === run.id" class="rr-detail" data-testid="run-detail">
          <p v-if="detail.loading" class="rr-note">Loading…</p>
          <p v-else-if="detail.error" class="rr-error">{{ detail.error }}</p>
          <template v-else>
            <p v-if="run.error" class="rr-error">{{ run.error }}</p>
            <p v-if="detail.fromGoal" class="rr-note">From the routine’s latest results.</p>
            <div v-for="(task, index) in detail.output?.tasks || []" :key="index" class="rr-task">
              <div class="rr-task-h"><span class="tag" :class="taskTone(task.status).tag">{{ taskTone(task.status).label }}</span><strong>{{ task.title }}</strong></div>
              <p v-if="task.error" class="rr-error">{{ task.error }}</p>
              <!-- eslint-disable-next-line vue/no-v-html -- sanitized with DOMPurify (markdown) -->
              <div v-if="task.content" class="rr-md" v-html="markdown(task.content)"></div>
              <p v-if="task.truncated" class="rr-note">Shortened here; the full result was longer.</p>
              <div v-if="task.files?.length" class="row-gap rr-files"><span v-for="file in task.files" :key="file" class="tag mono">{{ file }}</span></div>
            </div>
            <p v-if="!detail.output" class="rr-note">This run finished before AGNT kept what each run produced. Runs from now on keep theirs.</p>
            <button type="button" class="link" @click="openInGoals(run)">Open in Goals →</button>
          </template>
        </div>
      </li>
    </ul>
    <button v-if="shown.length < runs.length" type="button" class="btn sm rr-more" @click="limit += PAGE">Show more ({{ runs.length - shown.length }} older)</button>
  </section>
</template>

<script setup>
import { computed, inject, onMounted, reactive, ref } from 'vue';
import { useStore } from 'vuex';
import DOMPurify from 'dompurify';
import { renderMarkdown } from '@/utils/markdownPipeline.js';
import { parseServerTime } from '@/utils/serverTime.js';
import { ago, runTone, runStats } from '@/views/One/team/teamModel.js';
import { formatRunTime, formatDuration } from './focusedTime.js';
import { runOutputFromGoalTasks, goalTasksAreFromRun, taskTone } from './routineRuns.js';

const PAGE = 50;
const HISTORY_LIMIT = 500;
const props = defineProps({ routine: { type: Object, required: true } });
const store = useStore();
const nav = inject('focusedNav');

const runs = ref([]);
const loaded = ref(false);
const limit = ref(PAGE);
const open = ref(null);
const detail = reactive({ loading: false, error: '', output: null, fromGoal: false });
const cache = new Map();

const shown = computed(() => runs.value.slice(0, limit.value));
const summary = computed(() => {
  if (!loaded.value || !runs.value.length) return '';
  const total = Math.max(props.routine.runCount || 0, runs.value.length);
  const { finishedShare } = runStats(runs.value);
  const count = runs.value.length < total ? `Latest ${runs.value.length} of ${total} runs` : `${total} run${total === 1 ? '' : 's'}`;
  return finishedShare === null ? count : `${count} · ${finishedShare}% finished in the last 30 days`;
});

function line(run) {
  const when = ago(run.fired_at);
  return [runTone(run.status).label, formatDuration(run.duration_ms), when && when !== 'just now' ? `${when} ago` : when].filter(Boolean).join(' · ');
}
const markdown = (text) => DOMPurify.sanitize(renderMarkdown(text), { FORBID_TAGS: ['iframe', 'script', 'object', 'embed', 'form', 'input'] });

/** What a run produced: kept with the run, else (newest run only) the goal's current results. */
async function outputOf(run) {
  if (cache.has(run.id)) return cache.get(run.id);
  let result = { output: null, fromGoal: false };
  if (run.has_output) {
    const full = await store.dispatch('schedules/fetchRun', { scheduleId: props.routine.id, runId: run.id });
    result = { output: full?.output || null, fromGoal: false };
  } else if (props.routine.goalId && run.id === runs.value[0]?.id) {
    const goal = await store.dispatch('goals/fetchGoalTasks', props.routine.goalId).catch(() => null);
    if (goal && goalTasksAreFromRun(run, runs.value[0], goal.tasks)) result = { output: runOutputFromGoalTasks(goal.tasks), fromGoal: true };
  }
  cache.set(run.id, result);
  return result;
}

async function toggle(run) {
  if (open.value === run.id) { open.value = null; return; }
  open.value = run.id;
  Object.assign(detail, { loading: true, error: '', output: null, fromGoal: false });
  try {
    const result = await outputOf(run);
    if (open.value === run.id) Object.assign(detail, result);
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
  if (runs.value[0]) await toggle(runs.value[0]);
}

onMounted(load);
defineExpose({ load });
</script>

<style scoped>
.rr-sum { font-size: 12.5px; color: var(--text-tertiary); }
.rr-row { align-items: flex-start; }
.rr-row .col-dot { margin-top: 6px; }
.rr-detail { margin: 0 14px 14px 18px; padding: 2px 0 2px 14px; border-left: 2px solid var(--line); display: flex; flex-direction: column; gap: 10px; }
.rr-task { display: flex; flex-direction: column; gap: 6px; }
.rr-task-h { display: flex; align-items: center; gap: 8px; font-size: 13.5px; }
.rr-note { margin: 0; font-size: 12.5px; color: var(--text-tertiary); }
.rr-error { margin: 0; font-size: 13px; color: var(--danger); white-space: pre-wrap; word-break: break-word; }
.rr-files { gap: 6px; }
.rr-more { margin: 10px auto 0; display: flex; }
.rr-detail .link { align-self: flex-start; font-size: 13px; }
/* The result body: FocusedActivityDetail's markdown block. */
.rr-md { box-sizing: border-box; max-height: 420px; overflow: auto; padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--sunken); font-size: 13.5px; line-height: 1.55; color: var(--text-primary); }
.rr-md :deep(> :first-child) { margin-top: 0; }
.rr-md :deep(> :last-child) { margin-bottom: 0; }
.rr-md :deep(table) { border-collapse: collapse; margin: 8px 0; }
.rr-md :deep(th), .rr-md :deep(td) { padding: 6px 10px; border: 1px solid var(--line); text-align: left; }
</style>
