<template>
  <!-- A routine as the approved mockup's widget card (tc-rcard, mk.css), from
       its real run history. -->
  <div class="tc-rcard" :class="{ off: !row.enabled }" :data-testid="`routine-card-${row.id}`">
    <div class="tc-rcard-h">
      <button type="button" class="tc-rcard-t" @click="$emit('open', row)">{{ row.label }}</button>
      <button type="button" class="switch" :class="{ on: row.enabled }" role="switch" :aria-checked="row.enabled ? 'true' : 'false'" :aria-label="(row.enabled ? 'Pause ' : 'Resume ') + row.label" @click="$emit('toggle', row)"></button>
    </div>
    <div class="tc-when">{{ row.cadence }}<template v-if="!row.enabled"> · off</template><template v-else-if="row.next"> · next: {{ nextRun(row.next) }}</template></div>
    <div class="row-gap" style="margin-top: 8px">
      <span class="scope sm" :class="scopeLabel ? 'team' : ''"><MkIcon :name="scopeLabel ? 'users' : 'lock'" size="sm" />{{ scopeLabel || 'Private' }}</span>
      <button v-tooltip="'Change how runs work'" type="button" class="tc-mode" :class="row.runMode" @click="$emit('mode', row)">{{ row.runMode === 'auto' ? 'Runs on its own' : 'Asks you before acting' }}</button>
    </div>
    <div v-if="loaded && runs.length" class="tc-kpirow">
      <div>
        <div class="tc-kpi-v">{{ stats.last30 }}</div>
        <div class="tc-kpi-l">Runs in the last 30 days <span v-if="stats.finishedShare !== null" class="tc-delta">{{ stats.finishedShare }}% finished</span></div>
      </div>
      <svg v-if="spark" class="tc-spark" viewBox="0 0 110 34" aria-hidden="true"><path class="area" :d="spark + ' L110 34 L0 34Z'" /><path :d="spark" /></svg>
    </div>
    <div v-else class="tc-kpirow empty">{{ loaded ? 'Its number shows here after the first run.' : 'Loading…' }}</div>
    <div class="tc-runs">
      <div class="tc-runs-h">Recent runs</div>
      <button v-for="run in runs.slice(0, 3)" :key="run.id" type="button" class="tc-runrow" @click="openRun(run)">
        <span class="tc-dot" :class="runTone(run.status).state"></span>
        <span class="tc-rdate">{{ ago(run.fired_at) }}</span>
        <span class="tc-rtext">{{ runTone(run.status).label }}</span>
        <span class="tc-ropen">Open</span>
      </button>
      <div v-if="loaded && !runs.length" class="tc-rtext" style="padding: 6px 0">No runs yet.</div>
    </div>
    <div class="tc-rcard-f">
      <span v-if="held" class="tc-rtext" style="color: var(--text-tertiary)">Last run is still {{ held.status === 'running' ? 'running' : 'waiting for you' }}</span>
      <button v-else-if="row.sourceConversationId" type="button" class="link" @click="nav.openConversation(row.sourceConversationId)">Open the chat it came from →</button>
      <span v-else class="tc-rtext" style="color: var(--text-tertiary)">Built by hand</span>
      <button type="button" class="btn sm" :disabled="busy" @click="runNow"><MkIcon name="play" size="xs" />{{ held ? 'Open the last run' : 'Run now' }}</button>
    </div>
  </div>
</template>

<script setup>
import { computed, inject, onMounted, ref } from 'vue';
import { useStore } from 'vuex';
import { formatNext } from './focusedTime.js';

/** The mockup's "next: Mon, 9:00" (same clock as the schedule line) within the coming week; a date further out. */
function nextRun(ms, now = Date.now()) {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime()) || d.getTime() - now > 6 * 86400e3) return formatNext(ms);
  return `${d.toLocaleDateString(undefined, { weekday: 'short' })}, ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}
import MkIcon from '@/views/One/mk/MkIcon.vue';
import { ago, runTone, runStats, blockingRun, sparkPath } from '@/views/One/team/teamModel.js';

const props = defineProps({ row: { type: Object, required: true }, scopeLabel: { type: String, default: '' } });
defineEmits(['open', 'toggle', 'mode']);
const store = useStore();
const nav = inject('focusedNav');
const runs = ref([]);
const loaded = ref(false);
const busy = ref(false);

const stats = computed(() => runStats(runs.value));
const spark = computed(() => (stats.value.weekly.some((n) => n > 0) ? sparkPath(stats.value.weekly) : ''));
const held = computed(() => blockingRun(runs.value));

async function loadRuns() {
  const list = await store.dispatch('schedules/fetchRunHistory', { scheduleId: props.row.id, limit: 60 });
  runs.value = (Array.isArray(list) ? list : []).slice().sort((a, b) => Date.parse(b.fired_at) - Date.parse(a.fired_at));
  loaded.value = true;
}
function openRun(run) {
  const goalId = run.run_target_id || run.target_id || props.row.goalId;
  if (goalId) nav.openScreen('GoalsScreen', { select: { kind: 'goal', id: goalId } });
}
/** Never two runs at once: while the last one runs or waits for you, Run now opens it instead. */
async function runNow() {
  if (held.value) {
    nav.toast(held.value.status === 'running' ? 'The last run is still going. Opening it.' : 'The last run is waiting for your OK. Opening it.');
    openRun(held.value);
    return;
  }
  busy.value = true;
  try {
    await store.dispatch('schedules/fireNow', props.row.id);
    nav.toast('Started. Its run appears here.');
    await loadRuns();
  } catch (e) {
    nav.toast('Couldn’t start it. ' + (e?.message || e));
  } finally {
    busy.value = false;
  }
}
onMounted(loadRuns);
defineExpose({ loadRuns });
</script>
