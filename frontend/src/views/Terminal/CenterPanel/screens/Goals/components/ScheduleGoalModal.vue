<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-card" @click.stop>
      <div class="modal-head">
        <div>
          <h3>Schedule Goal</h3>
          <p class="goal-title">{{ goal?.title }}</p>
        </div>
        <button class="close-btn" @click="$emit('close')"><i class="fas fa-times"></i></button>
      </div>

      <div class="modal-body">
        <!-- Existing schedules -->
        <div v-if="existing.length" class="existing-list">
          <div class="section-label">Current schedules</div>
          <div v-for="s in existing" :key="s.id" class="existing-row">
            <div class="ex-cron">
              <code>{{ s.cron }}</code>
              <span class="ex-tz">{{ s.timezone }}</span>
              <span v-if="!s.enabled" class="off-chip">disabled</span>
            </div>
            <div class="ex-meta">
              <span>next: {{ formatDate(s.next_run) }}</span>
              <span v-if="s.run_count">{{ s.run_count }} runs</span>
            </div>
            <button class="link-btn" @click="toggleExisting(s)">{{ s.enabled ? 'Pause' : 'Enable' }}</button>
            <button class="link-btn danger" @click="removeExisting(s.id)">Delete</button>
          </div>
        </div>

        <div class="section-label">Add a schedule</div>

        <!-- Presets -->
        <div class="presets">
          <button v-for="p in presets" :key="p.cron"
                  :class="['preset', { active: cron === p.cron }]"
                  @click="cron = p.cron">
            {{ p.label }}
          </button>
        </div>

        <!-- Cron input -->
        <div class="cron-row">
          <label class="cron-label">Cron expression</label>
          <input v-model="cron" type="text" placeholder="*/15 * * * *" class="cron-input" />
          <select v-model="timezone" class="tz-input">
            <option v-for="tz in commonTimezones" :key="tz" :value="tz">{{ tz }}</option>
          </select>
        </div>

        <!-- Preview -->
        <div v-if="cron" class="preview">
          <div class="section-label">Next 5 firings</div>
          <div v-if="previewing" class="preview-loading">Computing…</div>
          <div v-else-if="previewError" class="preview-error">{{ previewError }}</div>
          <ul v-else-if="previews.length" class="preview-list">
            <li v-for="(p, i) in previews" :key="i">
              <i class="far fa-clock"></i> {{ formatDate(p) }}
            </li>
          </ul>
        </div>

        <div v-if="error" class="error-banner">{{ error }}</div>
      </div>

      <SimpleModal ref="simpleModalRef" />

      <div class="modal-foot">
        <button class="btn ghost" @click="$emit('close')">Cancel</button>
        <button class="btn" :disabled="!cron || !!previewError || creating" @click="create">
          <i class="fas fa-plus"></i> Create schedule
        </button>
      </div>
    </div>
  </div>
</template>

<script>
import { computed, onMounted, ref, watch } from 'vue';
import { useStore } from 'vuex';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';

const PRESETS = [
  { label: 'Every minute', cron: '* * * * *' },
  { label: 'Every 15 min', cron: '*/15 * * * *' },
  { label: 'Hourly', cron: '0 * * * *' },
  { label: 'Daily 9am', cron: '0 9 * * *' },
  { label: 'Weekdays 9am', cron: '0 9 * * 1-5' },
  { label: 'Weekly Mon', cron: '0 9 * * MON' },
  { label: 'Monthly 1st', cron: '0 0 1 * *' },
];

const COMMON_TZ = ['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Tokyo', 'Australia/Sydney'];

export default {
  name: 'ScheduleGoalModal',
  props: {
    goal: { type: Object, required: true },
  },
  emits: ['close', 'created'],
  components: { SimpleModal },
  setup(props, { emit }) {
    const store = useStore();
    const simpleModalRef = ref(null);
    const cron = ref('');
    const timezone = ref(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
    const previews = ref([]);
    const previewing = ref(false);
    const previewError = ref(null);
    const creating = ref(false);
    const error = ref(null);
    const existing = ref([]);

    const formatDate = (s) => {
      if (!s) return '—';
      try { return new Date(s).toLocaleString(); } catch { return s; }
    };

    let previewTimer = null;
    watch([cron, timezone], () => {
      if (previewTimer) clearTimeout(previewTimer);
      previewError.value = null;
      previews.value = [];
      if (!cron.value) return;
      previewing.value = true;
      previewTimer = setTimeout(async () => {
        try {
          const result = await store.dispatch('schedules/previewCron', { cron: cron.value, timezone: timezone.value, count: 5 });
          previews.value = result || [];
        } catch (e) {
          previewError.value = e.message || 'Invalid cron expression';
        } finally {
          previewing.value = false;
        }
      }, 250);
    });

    const refreshExisting = async () => {
      try {
        existing.value = await store.dispatch('schedules/fetchByTarget', { targetType: 'goal', targetId: props.goal.id });
      } catch (e) { /* ignore */ }
    };

    const create = async () => {
      if (!cron.value) return;
      creating.value = true;
      error.value = null;
      try {
        await store.dispatch('schedules/createSchedule', {
          targetType: 'goal',
          targetId: props.goal.id,
          cron: cron.value,
          timezone: timezone.value,
          enabled: true,
          onMissed: 'fire_once',
        });
        emit('created');
        emit('close');
      } catch (e) {
        error.value = e.message || 'Failed to create schedule';
      } finally {
        creating.value = false;
      }
    };

    const toggleExisting = async (s) => {
      try {
        await store.dispatch('schedules/updateSchedule', { id: s.id, patch: { enabled: !s.enabled } });
        refreshExisting();
      } catch (e) { error.value = e.message; }
    };
    const removeExisting = async (id) => {
      const ok = await simpleModalRef.value?.showModal({
        title: 'Delete schedule?',
        message: 'This will stop all future firings for this schedule.',
        confirmText: 'Delete', cancelText: 'Cancel',
        confirmClass: 'btn-danger',
      });
      if (!ok) return;
      try {
        await store.dispatch('schedules/deleteSchedule', id);
        refreshExisting();
      } catch (e) { error.value = e.message; }
    };

    onMounted(refreshExisting);

    return {
      simpleModalRef,
      cron, timezone, previews, previewing, previewError, creating, error, existing,
      presets: PRESETS, commonTimezones: COMMON_TZ,
      formatDate, create, toggleExisting, removeExisting,
    };
  },
};
</script>

<style scoped>
.modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.55); z-index: 100;
  display: flex; align-items: center; justify-content: center; padding: 20px;
}
.modal-card {
  background: var(--color-darker-0); border: 1px solid var(--terminal-border-color);
  border-radius: 12px; width: 100%; max-width: 600px; max-height: 90vh; overflow: auto;
  display: flex; flex-direction: column;
}
.modal-head {
  display: flex; justify-content: space-between; align-items: flex-start;
  padding: 20px; border-bottom: 1px solid var(--terminal-border-color);
}
.modal-head h3 { margin: 0; color: var(--color-light-green); }
.goal-title { margin: 4px 0 0 0; font-size: 0.85em; color: var(--color-text-muted); }
.close-btn {
  background: transparent; border: none; color: var(--color-text-muted);
  width: 28px; height: 28px; border-radius: 4px; cursor: pointer; font-size: 1em;
}
.close-btn:hover { background: var(--color-darker-2); color: var(--color-text); }

.modal-body { padding: 20px; display: flex; flex-direction: column; gap: 16px; }

.section-label { font-size: 0.8em; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.5px; }

.existing-list { display: flex; flex-direction: column; gap: 6px; }
.existing-row {
  display: flex; align-items: center; gap: 12px;
  background: var(--color-darker-1); border: 1px solid var(--terminal-border-color);
  border-radius: 6px; padding: 8px 12px; font-size: 0.85em;
}
.ex-cron { display: flex; align-items: center; gap: 6px; }
.ex-cron code { background: var(--color-darker-2); padding: 2px 6px; border-radius: 3px; font-family: var(--font-family-mono); color: var(--color-primary); }
.ex-tz { font-size: 0.85em; color: var(--color-text-muted); }
.ex-meta { display: flex; gap: 12px; color: var(--color-text-muted); margin-left: auto; }
.link-btn { background: transparent; border: none; color: var(--color-primary); cursor: pointer; font-size: 0.85em; padding: 4px 8px; }
.link-btn.danger { color: var(--color-red); }
.off-chip { font-size: 0.75em; padding: 2px 6px; border-radius: 4px; background: rgba(127,127,127,0.15); color: var(--color-text-muted); }

.presets { display: flex; flex-wrap: wrap; gap: 6px; }
.preset {
  background: var(--color-darker-2); border: 1px solid var(--terminal-border-color);
  color: var(--color-text-muted); padding: 6px 12px; border-radius: 16px; font-size: 0.85em; cursor: pointer;
}
.preset:hover { color: var(--color-text); border-color: rgba(var(--primary-rgb), 0.4); }
.preset.active { background: rgba(var(--primary-rgb), 0.15); color: var(--color-primary); border-color: rgba(var(--primary-rgb), 0.4); }

.cron-row { display: flex; flex-direction: column; gap: 6px; }
.cron-label { font-size: 0.85em; color: var(--color-text-muted); }
.cron-input, .tz-input {
  background: var(--color-darker-2); border: 1px solid var(--terminal-border-color);
  color: var(--color-text); padding: 8px 12px; border-radius: 6px; font-family: var(--font-family-mono);
}

.preview { display: flex; flex-direction: column; gap: 6px; }
.preview-loading, .preview-error { font-size: 0.85em; padding: 8px; }
.preview-error { color: var(--color-red); }
.preview-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; }
.preview-list li {
  font-family: var(--font-family-mono); font-size: 0.85em; color: var(--color-text);
  padding: 4px 8px; background: var(--color-darker-1); border-radius: 4px;
}
.preview-list li i { color: var(--color-primary); margin-right: 6px; }

.error-banner { color: var(--color-red); padding: 8px 12px; border: 1px solid rgba(var(--red-rgb), 0.3); border-radius: 6px; font-size: 0.85em; }

.modal-foot {
  display: flex; gap: 8px; justify-content: flex-end;
  padding: 16px 20px; border-top: 1px solid var(--terminal-border-color);
}
.btn {
  background: rgba(var(--primary-rgb), 0.15); color: var(--color-primary);
  border: 1px solid rgba(var(--primary-rgb), 0.4); padding: 8px 16px; border-radius: 6px; cursor: pointer;
  display: inline-flex; align-items: center; gap: 6px;
}
.btn:hover:not(:disabled) { background: rgba(var(--primary-rgb), 0.25); }
.btn:disabled { opacity: 0.4; cursor: not-allowed; }
.btn.ghost {
  background: transparent; color: var(--color-text-muted);
  border-color: var(--terminal-border-color);
}
.btn.ghost:hover { color: var(--color-text); }
</style>
