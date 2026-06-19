<template>
  <div class="schedules-manager">
    <div class="manager-header">
      <h3>Scheduled Goals</h3>
      <p class="subtitle">Cron-driven recurring goal execution. PRD-091 Layer 1.</p>
    </div>

    <div v-if="isLoading && !schedules.length" class="empty-state">Loading…</div>

    <div v-else-if="!schedules.length" class="empty-state">
      <i class="fas fa-clock"></i>
      <div>No schedules yet.</div>
      <div class="hint">Open a goal and click the schedule icon to set a cadence.</div>
    </div>

    <div v-else class="schedule-list">
      <div v-for="s in schedules" :key="s.id" class="schedule-row">
        <div class="row-main">
          <div class="row-title">
            <i class="fas fa-bullseye"></i>
            <span class="target">{{ goalLabel(s.target_id) }}</span>
            <span class="cron-chip">{{ s.cron }}</span>
            <span v-if="!s.enabled" class="off-chip">disabled</span>
          </div>
          <div class="row-meta">
            <span><i class="far fa-clock"></i> next: {{ formatDate(s.next_run) }}</span>
            <span v-if="s.last_run"><i class="fas fa-history"></i> last: {{ formatDate(s.last_run) }}</span>
            <span v-if="s.last_status" :class="['status-chip', s.last_status]">{{ s.last_status }}</span>
            <span><i class="fas fa-repeat"></i> {{ s.run_count }} runs</span>
            <span class="tz">{{ s.timezone }}</span>
          </div>
        </div>
        <div class="row-actions">
          <button class="icon-btn" title="Fire now" @click="fireNow(s.id)">
            <i class="fas fa-play"></i>
          </button>
          <button class="icon-btn" :title="s.enabled ? 'Pause' : 'Enable'" @click="toggleEnabled(s)">
            <i :class="s.enabled ? 'fas fa-pause' : 'fas fa-play-circle'"></i>
          </button>
          <button class="icon-btn danger" title="Delete" @click="remove(s.id)">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </div>
    </div>

    <div v-if="error" class="error-banner">{{ error }}</div>
    <SimpleModal ref="simpleModalRef" />
  </div>
</template>

<script>
import { computed, onMounted, ref } from 'vue';
import { useStore } from 'vuex';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';

export default {
  name: 'SchedulesManager',
  components: { SimpleModal },
  setup() {
    const simpleModalRef = ref(null);
    const store = useStore();
    const schedules = computed(() => store.getters['schedules/allSchedules']);
    const isLoading = computed(() => store.getters['schedules/isLoading']);
    const error = computed(() => store.getters['schedules/error']);
    const goals = computed(() => store.state.goals?.goals || []);

    const goalLabel = (id) => {
      const g = goals.value.find(x => x.id === id);
      return g ? g.title : id ? id.slice(0, 8) : 'Unknown';
    };

    const formatDate = (s) => {
      if (!s) return '—';
      try { return new Date(s).toLocaleString(); } catch { return s; }
    };

    const fireNow = async (id) => {
      try { await store.dispatch('schedules/fireNow', id); } catch (e) { /* surfaced via error */ }
    };
    const toggleEnabled = async (s) => {
      try { await store.dispatch('schedules/updateSchedule', { id: s.id, patch: { enabled: !s.enabled } }); } catch (e) { /* surfaced */ }
    };
    const remove = async (id) => {
      const ok = await simpleModalRef.value?.showModal({
        title: 'Delete schedule?',
        message: 'This will stop all future firings for this schedule.',
        confirmText: 'Delete', cancelText: 'Cancel',
        confirmClass: 'btn-danger',
      });
      if (!ok) return;
      try { await store.dispatch('schedules/deleteSchedule', id); } catch (e) { /* surfaced */ }
    };

    onMounted(() => {
      store.dispatch('schedules/fetchSchedules');
      if (!goals.value.length) store.dispatch('goals/fetchGoals');
    });

    return { simpleModalRef, schedules, isLoading, error, goalLabel, formatDate, fireNow, toggleEnabled, remove };
  },
};
</script>

<style scoped>
.schedules-manager { display: flex; flex-direction: column; gap: 16px; }
.manager-header h3 { color: var(--color-light-green); font-size: 1.2em; font-weight: 500; margin: 0 0 4px 0; }
.subtitle { color: var(--color-text-muted); font-size: 0.85em; opacity: 0.8; margin: 0; }
.empty-state { padding: 32px; text-align: center; color: var(--color-text-muted); border: 1px dashed var(--terminal-border-color); border-radius: 8px; }
.empty-state i { font-size: 2em; opacity: 0.4; display: block; margin-bottom: 8px; }
.hint { font-size: 0.85em; opacity: 0.7; margin-top: 4px; }
.schedule-list { display: flex; flex-direction: column; gap: 8px; }
.schedule-row {
  display: flex; justify-content: space-between; align-items: center; gap: 12px;
  background: var(--color-darker-1); border: 1px solid var(--terminal-border-color); border-radius: 8px;
  padding: 12px 16px;
}
.row-main { flex: 1; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.row-title { display: flex; align-items: center; gap: 10px; font-weight: 500; }
.target { color: var(--color-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cron-chip {
  font-family: var(--font-family-mono); font-size: 0.85em; color: var(--color-primary);
  background: rgba(var(--primary-rgb), 0.1); padding: 2px 8px; border-radius: 4px;
}
.off-chip { font-size: 0.75em; padding: 2px 6px; border-radius: 4px; background: rgba(127,127,127,0.15); color: var(--color-text-muted); }
.row-meta { display: flex; flex-wrap: wrap; gap: 12px; font-size: 0.8em; color: var(--color-text-muted); }
.row-meta i { margin-right: 4px; opacity: 0.7; }
.tz { font-family: var(--font-family-mono); opacity: 0.7; }
.status-chip { padding: 1px 6px; border-radius: 3px; font-size: 0.85em; }
.status-chip.completed { color: var(--color-green); background: rgba(var(--green-rgb), 0.1); }
.status-chip.failed { color: var(--color-red); background: rgba(var(--red-rgb), 0.1); }
.status-chip.cron_invalid { color: var(--color-red); background: rgba(var(--red-rgb), 0.1); }
.row-actions { display: flex; gap: 6px; }
.icon-btn {
  background: transparent; border: 1px solid var(--terminal-border-color); color: var(--color-text-muted);
  width: 32px; height: 32px; border-radius: 6px; cursor: pointer; transition: all 0.15s;
}
.icon-btn:hover { background: rgba(var(--primary-rgb), 0.1); color: var(--color-primary); border-color: var(--color-primary); }
.icon-btn.danger:hover { background: rgba(var(--red-rgb), 0.1); color: var(--color-red); border-color: var(--color-red); }
.error-banner { color: var(--color-red); padding: 8px 12px; border: 1px solid rgba(var(--red-rgb), 0.3); border-radius: 6px; }
</style>
