<template>
  <div class="mutations-viewer">
    <div class="manager-header">
      <h3>Mutation History</h3>
      <p class="subtitle">Every router-applied change is recorded with a snapshot and fitness baseline for auto-revert. PRD-091 Layer 7.</p>
    </div>

    <div class="stats-row">
      <div class="stat">
        <span class="num">{{ appliedCount }}</span><span class="label">applied</span>
      </div>
      <div class="stat">
        <span class="num warn">{{ revertedCount }}</span><span class="label">reverted</span>
      </div>
      <div class="stat">
        <span class="num bad">{{ failedCount }}</span><span class="label">failed</span>
      </div>
    </div>

    <div v-if="isLoading && !history.length" class="empty-state">Loading…</div>

    <div v-else-if="!history.length" class="empty-state">
      <i class="fas fa-code-branch"></i>
      <div>No mutations yet.</div>
      <div class="hint">Enable the autonomy router in the Autonomy section to start auto-applying insights.</div>
    </div>

    <div v-else class="mutation-list">
      <div v-for="m in history" :key="m.id" class="mutation-row" :class="m.status">
        <div class="row-main">
          <div class="row-title">
            <span class="via-chip" :class="m.applied_via">{{ m.applied_via }}</span>
            <span class="target">{{ m.target_type }}{{ m.target_id ? ':' + (m.target_id || '').slice(0, 12) : '' }}</span>
            <span :class="['status', m.status]">{{ formatStatus(m.status) }}</span>
            <span v-if="m.delta != null" :class="['delta', m.delta > 0 ? 'pos' : 'neg']">
              {{ m.delta > 0 ? '+' : '' }}{{ m.delta.toFixed(3) }} Δ
            </span>
          </div>
          <div class="row-meta">
            <span>fitness: {{ formatFitness(m.fitness_before) }} → {{ formatFitness(m.fitness_after) }}</span>
            <span v-if="m.snapshot_kind">snap: {{ m.snapshot_kind }}</span>
            <span>{{ formatDate(m.created_at) }}</span>
            <span v-if="m.reverted_at" class="reverted-info">reverted: {{ formatDate(m.reverted_at) }} — {{ m.revert_reason }}</span>
          </div>
          <div v-if="m.notes" class="row-notes">{{ m.notes }}</div>
        </div>
        <div class="row-actions">
          <button class="icon-btn" v-if="m.status === 'applied' && m.fitness_before != null" title="Canary check" @click="canary(m.id)">
            <i class="fas fa-heartbeat"></i>
          </button>
          <button class="icon-btn danger" v-if="m.status === 'applied'" title="Revert" @click="revert(m.id)">
            <i class="fas fa-undo"></i>
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
  name: 'MutationsViewer',
  components: { SimpleModal },
  setup() {
    const store = useStore();
    const simpleModalRef = ref(null);
    const history = computed(() => store.getters['mutations/allMutations']);
    const appliedCount = computed(() => store.getters['mutations/appliedCount']);
    const revertedCount = computed(() => store.getters['mutations/revertedCount']);
    const failedCount = computed(() => store.getters['mutations/failedCount']);
    const isLoading = computed(() => store.getters['mutations/isLoading']);
    const error = computed(() => store.getters['mutations/error']);

    const formatStatus = (s) => (s || '').replace(/_/g, ' ');
    const formatFitness = (v) => v == null ? '—' : Number(v).toFixed(3);
    const formatDate = (s) => {
      if (!s) return '—';
      try { return new Date(s).toLocaleString(); } catch { return s; }
    };

    const canary = async (id) => {
      try {
        const v = await store.dispatch('mutations/canaryCheck', id);
        const regression = !!v?.regression;
        await simpleModalRef.value?.showModal({
          title: regression ? 'Regression detected' : 'Canary OK',
          message: regression
            ? `Fitness dropped by ${Math.abs(v.delta || 0).toFixed(3)}. Current fitness: ${(v.fitnessAfter ?? 0).toFixed(3)}.`
            : `Δ = ${(v?.delta ?? 0).toFixed(3)}. Mutation looks healthy.`,
          confirmText: 'OK',
          showCancel: false,
          confirmClass: regression ? 'btn-danger' : 'btn-primary',
        });
      } catch (e) { /* surfaced */ }
    };
    const revert = async (id) => {
      const reason = await simpleModalRef.value?.showModal({
        title: 'Revert mutation',
        message: 'Why are you reverting? This will roll back any snapshot taken at apply time.',
        isPrompt: true,
        placeholder: 'reason',
        defaultValue: 'manual revert',
        confirmText: 'Revert', cancelText: 'Cancel',
        confirmClass: 'btn-danger',
      });
      if (reason == null || reason === '') return;
      try { await store.dispatch('mutations/revertMutation', { id, reason }); } catch (e) { /* surfaced */ }
    };

    onMounted(() => store.dispatch('mutations/fetchHistory'));

    return { simpleModalRef, history, appliedCount, revertedCount, failedCount, isLoading, error, formatStatus, formatFitness, formatDate, canary, revert };
  },
};
</script>

<style scoped>
.mutations-viewer { display: flex; flex-direction: column; gap: 16px; }
.manager-header h3 { color: var(--color-light-green); font-size: 1.2em; font-weight: 500; margin: 0 0 4px 0; }
.subtitle { color: var(--color-text-muted); font-size: 0.85em; opacity: 0.8; margin: 0; }

.stats-row { display: flex; gap: 12px; }
.stat {
  flex: 1; background: var(--color-darker-1); border: 1px solid var(--terminal-border-color);
  border-radius: 8px; padding: 12px 16px; display: flex; flex-direction: column;
}
.stat .num { font-size: 1.8em; font-family: var(--font-family-mono); font-weight: 600; color: var(--color-primary); }
.stat .num.warn { color: var(--color-yellow); }
.stat .num.bad { color: var(--color-red); }
.stat .label { font-size: 0.75em; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.5px; }

.empty-state { padding: 32px; text-align: center; color: var(--color-text-muted); border: 1px dashed var(--terminal-border-color); border-radius: 8px; }
.empty-state i { font-size: 2em; opacity: 0.4; display: block; margin-bottom: 8px; }
.hint { font-size: 0.85em; opacity: 0.7; margin-top: 4px; }

.mutation-list { display: flex; flex-direction: column; gap: 8px; }
.mutation-row {
  display: flex; justify-content: space-between; align-items: flex-start; gap: 12px;
  background: var(--color-darker-1); border: 1px solid var(--terminal-border-color);
  border-radius: 8px; padding: 12px 16px;
}
.mutation-row.reverted { opacity: 0.65; border-left: 3px solid var(--color-yellow); }
.mutation-row.apply_failed { border-left: 3px solid var(--color-red); }
.row-main { flex: 1; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.row-title { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.via-chip {
  font-family: var(--font-family-mono); font-size: 0.75em; padding: 2px 8px; border-radius: 4px;
  background: rgba(var(--blue-rgb), 0.1); color: var(--color-blue); text-transform: uppercase;
}
.via-chip.direct { background: rgba(var(--green-rgb), 0.1); color: var(--color-green); }
.via-chip.gated { background: rgba(var(--yellow-rgb), 0.1); color: var(--color-yellow); }
.target { font-family: var(--font-family-mono); font-size: 0.85em; }
.status { font-size: 0.75em; padding: 2px 6px; border-radius: 3px; text-transform: uppercase; letter-spacing: 0.3px; }
.status.applied { background: rgba(var(--green-rgb), 0.1); color: var(--color-green); }
.status.reverted { background: rgba(var(--yellow-rgb), 0.1); color: var(--color-yellow); }
.status.apply_failed { background: rgba(var(--red-rgb), 0.1); color: var(--color-red); }
.delta { margin-left: auto; font-family: var(--font-family-mono); font-size: 0.85em; }
.delta.pos { color: var(--color-green); }
.delta.neg { color: var(--color-red); }
.row-meta { display: flex; flex-wrap: wrap; gap: 12px; font-size: 0.8em; color: var(--color-text-muted); }
.reverted-info { color: var(--color-yellow); }
.row-notes { font-size: 0.85em; color: var(--color-text-muted); font-style: italic; }
.row-actions { display: flex; gap: 6px; align-items: flex-start; }
.icon-btn {
  background: transparent; border: 1px solid var(--terminal-border-color); color: var(--color-text-muted);
  width: 32px; height: 32px; border-radius: 6px; cursor: pointer; transition: all 0.15s;
}
.icon-btn:hover { background: rgba(var(--primary-rgb), 0.1); color: var(--color-primary); border-color: var(--color-primary); }
.icon-btn.danger:hover { background: rgba(var(--red-rgb), 0.1); color: var(--color-red); border-color: var(--color-red); }
.error-banner { color: var(--color-red); padding: 8px 12px; border: 1px solid rgba(var(--red-rgb), 0.3); border-radius: 6px; }
</style>
