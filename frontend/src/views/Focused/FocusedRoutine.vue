<template>
  <!-- One routine: what it does, anything it needs from you, then its runs. The editor opens on Edit. -->
  <div class="mk mk-page">
    <div class="content">
      <div class="page rt-page">
        <div class="page-head">
          <div class="rt-head">
            <h1>{{ existing ? existing.label : title }}</h1>
            <p>{{ headline }}</p>
          </div>
          <div v-if="existing" class="row-gap rt-actions">
            <label class="rt-active">
              <button type="button" class="switch" :class="{ on: existing.enabled }" role="switch" :aria-checked="existing.enabled ? 'true' : 'false'" :aria-label="existing.enabled ? 'Pause repeating goal' : 'Resume repeating goal'" data-testid="routine-active" :disabled="busy" @click="toggleActive"></button>
              <span>{{ existing.enabled ? 'On' : 'Paused' }}</span>
            </label>
            <button type="button" class="btn sm" :disabled="busy" data-testid="routine-run-now" @click="runNow"><MkIcon name="play" size="xs" />Run now</button>
            <button v-if="!editing" type="button" class="btn sm" data-testid="routine-edit" @click="startEditing"><MkIcon name="pen" size="xs" />Edit</button>
          </div>
        </div>

        <ul v-if="scheduleId && !existing" class="list"><li class="empty">{{ loading ? 'Loading…' : 'This repeating goal no longer exists.' }}</li></ul>
        <p v-if="existing && !editing && existing.description" class="rt-what-text" data-testid="routine-what">{{ existing.description }}</p>

        <!-- It stopped to ask you something: answer here. The answer is kept for every later run. -->
        <form v-if="existing && question && !editing" class="card rt-needs" data-testid="routine-needs-you" @submit.prevent="answer">
          <div class="rt-needs-h"><span class="tag amber">Needs you</span><span class="rt-needs-when">{{ needsSince }}</span></div>
          <p class="rt-needs-label">It can’t continue without:</p>
          <p class="rt-question">{{ question }}</p>
          <AutoTextarea v-model="reply" class="field rt-what" maxlength="2000" aria-label="Your answer" placeholder="Your answer. It is kept for every later run." />
          <div class="row-gap">
            <button type="submit" class="primary sm" :disabled="busy || !reply.trim()" data-testid="routine-answer">Send and run again</button>
            <button type="button" class="btn sm" :disabled="busy" v-tooltip="'For when you sorted it out somewhere else, like connecting an app'" @click="runNow">I’ve done it, run again</button>
          </div>
        </form>

        <p v-if="error && !editing" class="rt-error">{{ error }}</p>

        <form v-if="editing && (existing || !scheduleId)" class="card rt-card" novalidate data-testid="routine-form" @submit.prevent="save">
          <div class="props rt-props">
            <span>What it does</span>
            <div>
              <AutoTextarea v-model="f.what" class="field rt-what" maxlength="2000" aria-label="What it does" placeholder="For example: Every morning, summarise my unread email and flag anything urgent." />
              <small v-if="!existing" class="rt-hint">AGNT plans the steps when you create it. That takes a few seconds.</small>
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
          </div>
          <p v-if="error" class="rt-error">{{ error }}</p>
          <div class="card-foot rt-foot">
            <button v-if="existing" type="button" class="btn ghost sm danger" :disabled="busy" @click="remove">Delete</button>
            <span class="fill"></span>
            <button type="button" class="btn sm" :disabled="busy" @click="cancelEditing">Cancel</button>
            <button type="submit" class="primary sm" :disabled="busy">{{ busyLabel || (existing ? 'Save' : 'Create repeating goal') }}</button>
          </div>
        </form>

        <RoutineRunHistory v-if="existing" ref="history" :key="existing.id" :routine="existing" @loaded="(runs) => (latestRun = runs[0] || null)" />
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
import { waitingQuestion } from './routineRuns.js';
import { ago } from '@/views/One/team/teamModel.js';

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
const title = computed(() => (props.scheduleId ? 'Edit repeating goal' : 'New repeating goal'));
const history = ref(null);
// A new routine opens on the editor; an existing one shows what it does and its runs.
const editing = ref(!props.scheduleId);
const latestRun = ref(null);
const reply = ref('');
/** What the newest run stopped to ask you, if it did. */
const question = computed(() => waitingQuestion(latestRun.value));
const needsSince = computed(() => {
  const when = latestRun.value ? ago(latestRun.value.fired_at) : '';
  return !when ? '' : when === 'just now' ? 'Asked just now' : `Asked ${when} ago`;
});
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
    error.value = 'Describe what the repeating goal should do.';
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
      if (!goal?.id) throw new Error('AGNT couldn’t plan that repeating goal. Try rephrasing it.');
      try {
        await store.dispatch('schedules/createSchedule', { targetType: 'goal', targetId: goal.id, cron: cron.value, timezone: f.timezone, enabled: f.enabled });
      } catch (err) {
        store.dispatch('goals/deleteGoal', goal.id).catch(() => {});
        throw err;
      }
      if (r) await store.dispatch('schedules/deleteSchedule', r.id).catch(() => {});
    }
    nav.toast(r ? 'Repeating goal saved.' : 'Repeating goal created.');
    // Same routine, new schedule: stay on it. New instructions make a new routine: back to the list.
    if (r && !changedWhat) editing.value = false;
    else nav.go({ page: 'scheduled' });
  });
}

function startEditing() {
  fill(existing.value);
  error.value = '';
  editing.value = true;
}
function cancelEditing() {
  if (!existing.value) return back();
  error.value = '';
  editing.value = false;
}

async function toggleActive() {
  const r = existing.value;
  await withBusy('', async () => {
    await store.dispatch('schedules/updateSchedule', { id: r.id, patch: { enabled: !r.enabled } });
    nav.toast(r.enabled ? 'Paused.' : 'Resumed.');
  });
}

/**
 * Answers what the routine asked: the reply is kept as review feedback on its goal, which
 * every later run's steps are given, and the routine runs again now with it.
 */
async function answer() {
  const text = reply.value.trim();
  const r = existing.value;
  if (!text || !r?.goalId) return;
  await withBusy('', async () => {
    await store.dispatch('goals/reviewGoal', { goalId: r.goalId, action: 'reject', feedback: text });
    await store.dispatch('schedules/fireNow', r.id);
    reply.value = '';
    nav.toast('Sent. It is running again with your answer.');
    await history.value?.load();
  });
}

async function runNow() {
  await withBusy('', async () => {
    await store.dispatch('schedules/fireNow', existing.value.id);
    nav.toast('Running now.');
    await history.value?.load();
  });
}

async function remove() {
  if (!(await nav.confirm({ title: 'Delete repeating goal?', message: `“${existing.value.label}” won’t run again.`, confirmText: 'Delete', danger: true }))) return;
  await withBusy('', async () => {
    await store.dispatch('schedules/deleteSchedule', existing.value.id);
    nav.toast('Repeating goal deleted.');
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
.mk .page.rt-page { max-width: 920px; }
.mk .rt-head { min-width: 0; }
.mk .row-gap.rt-actions { flex: none; gap: 8px; flex-wrap: nowrap; margin-left: auto; }
.mk .rt-active { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--text-secondary); margin-right: 4px; }
.mk .rt-needs-label { margin: 2px 0 0; font-size: 12.5px; color: var(--text-secondary); }
.mk .rt-what-text { margin: -8px 0 18px; font-size: 13.5px; line-height: 1.5; color: var(--text-secondary); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.mk .card.rt-needs { padding: 12px 14px; gap: 8px; margin-bottom: 18px; border-color: rgba(var(--orange-rgb), 0.45); }
.mk .rt-needs-h { display: flex; align-items: center; gap: 8px; }
.mk .rt-needs-when { font-size: 12px; color: var(--text-tertiary); }
.mk .rt-question { margin: 0; font-size: 14px; line-height: 1.5; color: var(--text-primary); white-space: pre-wrap; word-break: break-word; }
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
