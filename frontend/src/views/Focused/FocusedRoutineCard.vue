<template>
  <!-- A routine as a widget: what it is, when it runs, its number, its last
       runs (each opens that run), Run now. All from the routine's real run
       history; nothing here is a placeholder. -->
  <article class="rc" :class="{ 'is-off': !row.enabled }" :data-testid="`routine-card-${row.id}`">
    <header class="rc-head">
      <button type="button" class="rc-title" @click="$emit('open', row)">{{ row.label }}</button>
      <button
        type="button"
        class="focused-switch"
        role="switch"
        :aria-checked="row.enabled ? 'true' : 'false'"
        :aria-label="(row.enabled ? 'Pause ' : 'Resume ') + row.label"
        @click="$emit('toggle', row)"
      ></button>
    </header>
    <p class="rc-when">{{ row.cadence }}<template v-if="!row.enabled"> · Paused</template><template v-else-if="row.next"> · next {{ formatNext(row.next) }}</template></p>

    <div class="rc-number">
      <div>
        <div class="rc-value">{{ loaded ? stats.last30 : '…' }}</div>
        <div class="rc-label">runs in 30 days<template v-if="stats.finishedShare !== null"> · {{ stats.finishedShare }}% finished</template></div>
      </div>
      <svg v-if="spark" class="rc-spark" viewBox="0 0 110 34" aria-hidden="true"><path class="rc-area" :d="spark + ' L110 34 L0 34Z'" /><path class="rc-line" :d="spark" /></svg>
    </div>

    <div class="rc-runs">
      <div class="rc-runs-head">Recent runs</div>
      <p v-if="loaded && !runs.length" class="rc-empty">No runs yet. Run it now to see one.</p>
      <button v-for="run in runs.slice(0, 3)" :key="run.id" type="button" class="rc-run" @click="openRun(run)">
        <span class="rc-dot" :style="{ background: runTone(run.status).color }" aria-hidden="true"></span>
        <span class="rc-run-when">{{ ago(run.fired_at) }}</span>
        <span class="rc-run-text">{{ runTone(run.status).label }}</span>
        <span class="rc-run-open">Open</span>
      </button>
    </div>

    <footer class="rc-foot">
      <span class="rc-hint">{{ held ? 'Last run is still ' + (held.status === 'running' ? 'running' : 'waiting for you') : '' }}</span>
      <button type="button" class="focused-btn" :disabled="busy" @click="runNow"><i class="fas fa-play" aria-hidden="true"></i> {{ held ? 'Open the last run' : 'Run now' }}</button>
    </footer>
  </article>
</template>

<script setup>
import { computed, inject, onMounted, ref } from 'vue';
import { useStore } from 'vuex';
import { formatNext } from './focusedTime.js';
import { ago, runTone, runStats, blockingRun, sparkPath } from '@/views/One/team/teamModel.js';

const props = defineProps({ row: { type: Object, required: true } });
defineEmits(['open', 'toggle']);
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

<style scoped>
.rc { display: flex; flex-direction: column; gap: 6px; min-width: 0; padding: 14px; border: 1px solid var(--terminal-border-color); border-radius: 14px; background: var(--color-background); }
.rc.is-off { opacity: 0.72; }
.rc-head { display: flex; align-items: center; gap: 8px; }
.rc-title { flex: 1; min-width: 0; padding: 0; border: 0; background: none; color: var(--text-primary); font: inherit; font-size: 15px; font-weight: 600; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
.rc-title:hover { text-decoration: underline; text-underline-offset: 3px; }
.rc-when { margin: 0; font-size: 12.5px; color: var(--text-secondary); }
.rc-number { display: flex; align-items: flex-end; justify-content: space-between; gap: 10px; margin-top: 6px; padding: 10px 12px; border-radius: 10px; background: var(--color-darker-1); }
.rc-value { font-size: 24px; font-weight: 700; line-height: 1; color: var(--text-primary); }
.rc-label { margin-top: 4px; font-size: 12px; color: var(--text-secondary); }
.rc-spark { width: 110px; height: 34px; flex: none; }
.rc-line { fill: none; stroke: var(--color-pink); stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.rc-area { fill: rgba(var(--pink-rgb), 0.1); stroke: none; }
.rc-runs { margin-top: 4px; }
.rc-runs-head { margin: 4px 2px; font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-tertiary); }
.rc-empty { margin: 4px 2px; font-size: 12.5px; color: var(--text-tertiary); }
.rc-run { display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 4px; border: 0; border-radius: 8px; background: transparent; color: var(--text-primary); font: inherit; font-size: 13px; text-align: left; cursor: pointer; }
.rc-run:hover { background: var(--surface-hover); }
.rc-dot { width: 8px; height: 8px; flex: none; border-radius: 50%; }
.rc-run-when { width: 64px; flex: none; color: var(--text-tertiary); font-size: 12px; }
.rc-run-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rc-run-open { font-size: 12px; color: var(--text-tertiary); }
.rc-foot { display: flex; align-items: center; gap: 8px; margin-top: auto; padding-top: 8px; }
.rc-hint { flex: 1; min-width: 0; font-size: 12px; color: var(--text-tertiary); }
</style>
