<template>
  <!-- One routine: a compact editor, then everything it has done. Same frame as the Routines page (mk.css). -->
  <div class="mk mk-page">
    <div class="content">
      <div class="page rt-page">
        <div class="page-head">
          <div>
            <h1>{{ existing ? existing.label : title }}</h1>
            <p>{{ headline }}</p>
          </div>
          <button v-if="existing" type="button" class="btn" :disabled="busy" data-testid="routine-run-now" @click="runNow"><MkIcon name="play" size="xs" />Run now</button>
        </div>

        <ul v-if="scheduleId && !existing" class="list"><li class="empty">{{ loading ? 'Loading…' : 'This routine no longer exists.' }}</li></ul>
        <form v-else class="card rt-card" novalidate data-testid="routine-form" @submit.prevent="save">
          <div class="props rt-props">
            <span>What it does</span>
            <div>
              <AutoTextarea v-model="f.what" class="field rt-what" maxlength="2000" aria-label="What it does" placeholder="For example: Every morning, summarise my unread email and flag anything urgent." />
              <small class="rt-hint">{{ existing ? 'Changing this sets the routine up again with the new instructions.' : 'AGNT plans the steps when you create it. That takes a few seconds.' }}</small>
            </div>
            <span>When</span>
            <div class="row-gap rt-when">
              <CustomSelect v-model="f.repeat" :options="repeatOptions" aria-label="Repeat" />
              <CustomSelect v-if="f.repeat === 'weekly'" v-model="f.dow" :options="dayOptions" aria-label="Day" />
              <CustomSelect v-if="f.repeat === 'monthly'" v-model="f.dom" :options="dateOptions" aria-label="Date" />
              <input v-if="f.repeat === 'hourly'" v-model.number="f.minute" class="field rt-num" type="number" min="0" max="59" aria-label="Minute" />
              <input v-else-if="f.repeat !== 'custom'" v-model="f.time" class="field rt-time" type="time" aria-label="Time" />
              <input v-else v-model="f.custom" class="field mono rt-cron" spellcheck="false" aria-label="Schedule" placeholder="0 9 * * MON-FRI" />
              <CustomSelect v-model="f.timezone" :options="zones" aria-label="Time zone" class="rt-zone" />
              <small class="rt-preview" aria-live="polite" data-testid="routine-preview">{{ cron ? cronLabel(cron) : '' }}<template v-if="f.repeat === 'custom'"> · minute, hour, day of month, month, weekday</template></small>
            </div>
            <span>Active</span>
            <div class="row-gap">
              <button type="button" class="switch" :class="{ on: f.enabled }" role="switch" :aria-checked="f.enabled ? 'true' : 'false'" aria-label="Active" @click="f.enabled = !f.enabled"></button>
              <small class="rt-preview">{{ f.enabled ? 'On' : 'Paused' }}</small>
            </div>
          </div>
          <p v-if="error" class="rt-error">{{ error }}</p>
          <div class="card-foot rt-foot">
            <button v-if="existing" type="button" class="btn ghost sm danger" :disabled="busy" @click="remove">Delete</button>
            <span class="fill"></span>
            <button type="button" class="btn sm" :disabled="busy" @click="back">Cancel</button>
            <button type="submit" class="primary sm" :disabled="busy">{{ busyLabel || (existing ? 'Save' : 'Create routine') }}</button>
          </div>
        </form>

        <RoutineRunHistory v-if="existing" ref="history" :key="existing.id" :routine="existing" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, inject, onMounted, watch } from 'vue';
import { useStore } from 'vuex';
import AutoTextarea from './AutoTextarea.vue';
import RoutineRunHistory from './RoutineRunHistory.vue';
import CustomSelect from '@/views/_components/common/CustomSelect.vue';
import MkIcon from '@/views/One/mk/MkIcon.vue';
import '@/views/One/mk/mk.css';
import { scheduleRows, parseCron, buildCron, isCron, cronLabel, REPEATS, WEEKDAYS } from './focusedModel.js';
import { formatNextRun, timezoneOptions, LOCAL_TZ } from './focusedTime.js';

const props = defineProps({ scheduleId: { type: String, default: null } });
const store = useStore();
const nav = inject('focusedNav');

const loading = ref(false);
const busy = ref(false);
const busyLabel = ref('');
const error = ref('');

const existing = computed(() => {
  if (!props.scheduleId) return null;
  return scheduleRows(store.getters['schedules/allSchedules'], '', store.getters['goals/allGoals']).find((r) => String(r.id) === String(props.scheduleId)) || null;
});
const title = computed(() => (props.scheduleId ? 'Edit routine' : 'New routine'));
const history = ref(null);
/** Under the name: when it runs and when it runs next. */
const headline = computed(() => {
  const r = existing.value;
  if (!r) return 'Have AGNT do something for you on a schedule.';
  if (!r.enabled) return `${r.cadence} · paused`;
  return r.next ? `${r.cadence} · next ${formatNextRun(r.next)}` : r.cadence;
});

const f = reactive({ what: '', repeat: 'daily', time: '09:00', dow: 'MON', dom: 1, minute: 0, custom: '', timezone: LOCAL_TZ, enabled: true });
function fill(r) {
  Object.assign(f, parseCron(r?.cron || '0 9 * * *'), {
    what: r ? r.description || r.label : '',
    timezone: r?.timezone || LOCAL_TZ,
    enabled: r ? r.enabled : true,
  });
}
fill(null);
const toOpts = (pairs) => pairs.map(([value, label]) => ({ value, label }));
const repeatOptions = toOpts([...REPEATS, ['custom', 'Custom schedule']]);
const dayOptions = toOpts(WEEKDAYS);
const dateOptions = Array.from({ length: 28 }, (_, i) => ({ value: i + 1, label: ordinalOf(i + 1) }));
const zones = computed(() => timezoneOptions(f.timezone).map((z) => ({ value: z, label: z })));
const cron = computed(() => buildCron(f));
function ordinalOf(n) {
  return n + (['th', 'st', 'nd', 'rd'][(n % 100 >= 11 && n % 100 <= 13) || n % 10 > 3 ? 0 : n % 10] || 'th');
}

async function withBusy(label, fn) {
  busy.value = true;
  busyLabel.value = label;
  error.value = '';
  try {
    await fn();
  } catch (e) {
    error.value = e?.message || String(e);
  } finally {
    busy.value = false;
    busyLabel.value = '';
  }
}

async function save() {
  const text = f.what.trim();
  if (!text) {
    error.value = 'Describe what the routine should do.';
    return;
  }
  if (!isCron(cron.value)) {
    error.value = 'A schedule needs five parts, like 0 9 * * MON-FRI.';
    return;
  }
  const r = existing.value;
  const changedWhat = !r || text !== String(r.description || r.label || '').trim();
  await withBusy(changedWhat ? (r ? 'Setting up again…' : 'Setting up…') : 'Saving…', async () => {
    if (!changedWhat) {
      await store.dispatch('schedules/updateSchedule', { id: r.id, patch: { cron: cron.value, timezone: f.timezone, enabled: f.enabled } });
    } else {
      // A goal's instructions are fixed once planned, so new instructions mean
      // a new goal. It is planned and scheduled BEFORE anything is removed:
      // a failure leaves the old routine exactly as it was.
      const goal = await store.dispatch('goals/createGoal', { text, title: text });
      if (!goal?.id) throw new Error('AGNT couldn’t plan that routine. Try rephrasing it.');
      try {
        await store.dispatch('schedules/createSchedule', { targetType: 'goal', targetId: goal.id, cron: cron.value, timezone: f.timezone, enabled: f.enabled });
      } catch (err) {
        store.dispatch('goals/deleteGoal', goal.id).catch(() => {});
        throw err;
      }
      if (r) await store.dispatch('schedules/deleteSchedule', r.id).catch(() => {});
    }
    nav.toast(r ? 'Routine saved.' : 'Routine created.');
    nav.go({ page: 'scheduled' });
  });
}

async function runNow() {
  await withBusy('', async () => {
    await store.dispatch('schedules/fireNow', existing.value.id);
    nav.toast('Running now. It shows at the top of Runs.');
    await history.value?.load();
  });
}

async function remove() {
  if (!(await nav.confirm({ title: 'Delete routine?', message: `“${existing.value.label}” won’t run again.`, confirmText: 'Delete', danger: true }))) return;
  await withBusy('', async () => {
    await store.dispatch('schedules/deleteSchedule', existing.value.id);
    nav.toast('Routine deleted.');
    nav.go({ page: 'scheduled' });
  });
}

const back = () => nav.go({ page: 'scheduled' });

onMounted(async () => {
  if (props.scheduleId && !existing.value) {
    loading.value = true;
    await Promise.all([store.dispatch('schedules/fetchSchedules'), store.dispatch('goals/fetchGoals')]).catch(() => {});
    loading.value = false;
  }
  if (existing.value) fill(existing.value);
});
// Loaded after mount (cold deep link): fill once it arrives.
watch(existing, (r, prev) => {
  if (r && !prev) fill(r);
});
</script>

<style scoped>
/* .mk-level selectors: they must outrank mk.css's own (.mk .props, .mk .card, .mk .field). */
.mk .page.rt-page { max-width: 980px; }
.mk .card.rt-card { padding: 12px 14px; gap: 8px; }
.mk .props.rt-props { grid-template-columns: 96px minmax(0, 1fr); margin: 0; align-items: start; }
.mk .props.rt-props > span { padding-top: 7px; }
.mk .field.rt-what { box-sizing: border-box; resize: none; line-height: 1.45; }
.mk .rt-hint { display: block; margin-top: 4px; font-size: 12px; color: var(--text-tertiary); }
.mk .row-gap.rt-when { gap: 6px; flex-wrap: wrap; }
.mk .rt-when :deep(.custom-select) { flex: 0 0 auto; width: 150px; }
.mk .rt-when :deep(.custom-select.rt-zone) { width: 230px; }
.mk .field.rt-time, .mk .field.rt-num, .mk .field.rt-cron { box-sizing: border-box; flex: 0 0 auto; height: 32px; padding: 0 10px; font-size: 13px; color: var(--text-primary); }
/* The base stylesheet makes every text/time/number input fill its row with !important; these sit inline. */
.mk .field.rt-time { width: 120px !important; }
.mk .field.rt-num { width: 80px !important; }
.mk .field.rt-cron { width: 200px !important; }
.mk .rt-preview { font-size: 12.5px; color: var(--text-tertiary); }
/* The time picker's icon follows the AGNT theme, not the OS. */
:global(body.dark) .mk .field.rt-time { color-scheme: dark; }
.mk .rt-error { margin: 0; font-size: 13px; color: var(--danger); }
.mk .card-foot.rt-foot { margin-top: 2px; }
.mk .rt-foot .fill { flex: 1; }
</style>
