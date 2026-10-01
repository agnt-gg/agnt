<template>
  <section class="focused-page focused-editor" :aria-label="title">
    <button type="button" class="focused-page-back" @click="back"><i class="fas fa-arrow-left" aria-hidden="true"></i>Scheduled</button>
    <header class="focused-page-head">
      <div>
        <h1>{{ title }}</h1>
        <p>{{ existing ? existing.label : 'Have AGNT do something for you on a schedule.' }}</p>
      </div>
    </header>

    <p v-if="scheduleId && !existing" class="focused-empty">{{ loading ? 'Loading…' : 'This routine no longer exists.' }}</p>
    <form v-else class="focused-form" novalidate @submit.prevent="save">
      <label class="focused-field">
        <span class="focused-field-label">What should AGNT do?</span>
        <AutoTextarea v-model="f.what" class="focused-input" maxlength="2000" placeholder="For example: Every morning, summarise my unread email and flag anything urgent." autofocus />
        <small class="focused-edit-hint">
          {{ existing ? 'Changing this sets the routine up again with the new instructions.' : 'AGNT plans the steps when you create it. That takes a few seconds.' }}
        </small>
      </label>

      <div class="focused-field-row">
        <div class="focused-field">
          <span class="focused-field-label">Repeat</span>
          <CustomSelect v-model="f.repeat" :options="repeatOptions" />
        </div>
        <div v-if="f.repeat === 'weekly'" class="focused-field">
          <span class="focused-field-label">Day</span>
          <CustomSelect v-model="f.dow" :options="dayOptions" />
        </div>
        <div v-if="f.repeat === 'monthly'" class="focused-field">
          <span class="focused-field-label">Date</span>
          <CustomSelect v-model="f.dom" :options="dateOptions" />
        </div>
        <label v-if="f.repeat === 'hourly'" class="focused-field">
          <span class="focused-field-label">Minute</span>
          <input v-model.number="f.minute" class="focused-input" type="number" min="0" max="59" />
        </label>
        <label v-else-if="f.repeat !== 'custom'" class="focused-field">
          <span class="focused-field-label">Time</span>
          <input v-model="f.time" class="focused-input" type="time" />
        </label>
        <div class="focused-field">
          <span class="focused-field-label">Time zone</span>
          <CustomSelect v-model="f.timezone" :options="zones" />
        </div>
      </div>
      <label v-if="f.repeat === 'custom'" class="focused-field">
        <span class="focused-field-label">Schedule</span>
        <input v-model="f.custom" class="focused-input mono" spellcheck="false" placeholder="minute hour day month weekday, e.g. 0 9 * * MON-FRI" />
        <small class="focused-edit-hint">Standard cron: minute, hour, day of month, month, weekday.</small>
      </label>
      <p class="focused-preview-line" aria-live="polite">{{ cron ? cronLabel(cron) : '' }}</p>

      <div class="focused-edit-card">
        <div class="focused-edit-row">
          <span class="focused-edit-label">Active</span>
          <button type="button" class="focused-switch" role="switch" :aria-checked="f.enabled ? 'true' : 'false'" aria-label="Active" @click="f.enabled = !f.enabled"></button>
        </div>
      </div>

      <section v-if="existing" class="focused-edit-block">
        <div class="focused-edit-block-head">
          <h3>Activity</h3>
          <span class="focused-flex"></span>
          <button type="button" class="focused-btn" :disabled="busy" @click="runNow">Run now</button>
        </div>
        <div class="focused-edit-card">
          <div class="focused-edit-row"><span class="focused-edit-label">Next run</span><span>{{ existing.enabled && existing.next ? formatNext(existing.next) : 'Paused' }}</span></div>
          <div class="focused-edit-row"><span class="focused-edit-label">Last run</span><span>{{ existing.last ? ago(existing.last) + (existing.lastStatus ? ' · ' + existing.lastStatus : '') : 'Not yet' }}</span></div>
          <div class="focused-edit-row"><span class="focused-edit-label">Runs</span><span>{{ existing.runCount }}</span></div>
          <div v-if="existing.lastError" class="focused-edit-row column"><span class="focused-save-text error">{{ existing.lastError }}</span></div>
        </div>
      </section>

      <p v-if="error" class="focused-save-text error">{{ error }}</p>
      <div class="focused-form-foot">
        <button v-if="existing" type="button" class="focused-btn danger" :disabled="busy" @click="remove">Delete</button>
        <span class="focused-flex"></span>
        <button type="button" class="focused-btn" :disabled="busy" @click="back">Cancel</button>
        <button type="submit" class="focused-primary" :disabled="busy">{{ busyLabel || (existing ? 'Save' : 'Create routine') }}</button>
      </div>
    </form>
  </section>
</template>

<script setup>
import { ref, reactive, computed, inject, onMounted, watch } from 'vue';
import { useStore } from 'vuex';
import AutoTextarea from './AutoTextarea.vue';
import CustomSelect from '@/views/_components/common/CustomSelect.vue';
import { scheduleRows, parseCron, buildCron, isCron, cronLabel, REPEATS, WEEKDAYS } from './focusedModel.js';
import { ago } from './focusedEditors.js';
import { formatNext, timezoneOptions, LOCAL_TZ } from './focusedTime.js';

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
    nav.toast('Running now.');
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
