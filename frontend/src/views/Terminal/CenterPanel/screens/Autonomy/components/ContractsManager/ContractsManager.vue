<template>
  <div class="contracts-manager">
    <div class="manager-header">
      <h3>Runtime Contracts</h3>
      <p class="subtitle">Refinement-type invariants mined from successful executions. PRD-091 Layer 5.</p>
    </div>

    <div class="filter-row">
      <button v-for="opt in statusOptions" :key="opt"
              :class="['chip', { active: filterStatus === opt }]"
              @click="setStatus(opt)">{{ opt || 'All' }}</button>
      <div class="totals">
        <span>{{ contracts.length }} contracts</span>
        <span class="violations" v-if="totalViolations > 0">
          <i class="fas fa-exclamation-triangle"></i> {{ totalViolations }} total violations
        </span>
      </div>
    </div>

    <div v-if="isLoading && !contracts.length" class="empty-state">Loading…</div>

    <div v-else-if="!contracts.length" class="empty-state">
      <i class="fas fa-file-contract"></i>
      <div>No contracts yet.</div>
      <div class="hint">Contracts emerge from tool usage patterns. Run insight extraction or trigger a tool rollup to see proposals.</div>
    </div>

    <div v-else class="contract-list">
      <div v-for="c in contracts" :key="c.id" class="contract-row">
        <div class="row-main">
          <div class="row-title">
            <span class="target-chip">{{ c.target_type }}{{ c.target_id ? ':' + c.target_id : '' }}</span>
            <span class="name">{{ c.name }}</span>
            <span v-if="c.status !== 'active'" class="off-chip">{{ c.status }}</span>
            <span class="confidence" :title="'Confidence: ' + (c.confidence * 100).toFixed(0) + '%'">
              {{ (c.confidence * 100).toFixed(0) }}%
            </span>
          </div>
          <div class="row-predicate">
            <code>{{ formatPredicate(c.predicate) }}</code>
          </div>
          <div class="row-meta">
            <span><i class="fas fa-check-circle"></i> {{ c.evidence_count }} confirmations</span>
            <span :class="{ bad: c.violation_count > 0 }">
              <i class="fas fa-times-circle"></i> {{ c.violation_count }} violations
            </span>
            <span>source: {{ c.source }}</span>
            <span>{{ formatDate(c.created_at) }}</span>
          </div>
        </div>
        <div class="row-actions">
          <button class="icon-btn" :title="c.status === 'active' ? 'Pause' : 'Activate'" @click="toggle(c)">
            <i :class="c.status === 'active' ? 'fas fa-pause' : 'fas fa-play'"></i>
          </button>
          <button class="icon-btn danger" title="Delete" @click="remove(c.id)">
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
  name: 'ContractsManager',
  components: { SimpleModal },
  setup() {
    const store = useStore();
    const simpleModalRef = ref(null);
    const filterStatus = ref('active');
    const statusOptions = ['active', 'paused', 'superseded', ''];

    const contracts = computed(() => store.getters['contracts/allContracts']);
    const totalViolations = computed(() => store.getters['contracts/totalViolations']);
    const isLoading = computed(() => store.getters['contracts/isLoading']);
    const error = computed(() => store.getters['contracts/error']);

    const formatPredicate = (p) => {
      if (!p) return '';
      const { type, field, max, min, equals, forbidden } = p;
      if (type === 'numeric_bound') return `${field}: ${min != null ? '>=' + min + ', ' : ''}${max != null ? '<=' + max : ''}`;
      if (type === 'always_succeeds') return `${field} === "${equals}"`;
      if (type === 'never_value') return `${field} ∉ [${(forbidden || []).join(', ')}]`;
      return JSON.stringify(p);
    };

    const formatDate = (s) => {
      if (!s) return '—';
      try { return new Date(s).toLocaleDateString(); } catch { return s; }
    };

    const setStatus = (s) => {
      filterStatus.value = s;
      store.dispatch('contracts/fetchContracts', s ? { status: s } : {});
    };
    const toggle = async (c) => {
      const next = c.status === 'active' ? 'paused' : 'active';
      try { await store.dispatch('contracts/updateContractStatus', { id: c.id, status: next }); } catch (e) { /* surfaced */ }
    };
    const remove = async (id) => {
      const ok = await simpleModalRef.value?.showModal({
        title: 'Delete contract?',
        message: 'The contract and its violation history will be permanently removed.',
        confirmText: 'Delete', cancelText: 'Cancel',
        confirmClass: 'btn-danger',
      });
      if (!ok) return;
      try { await store.dispatch('contracts/deleteContract', id); } catch (e) { /* surfaced */ }
    };

    onMounted(() => store.dispatch('contracts/fetchContracts', { status: 'active' }));

    return { simpleModalRef, contracts, totalViolations, isLoading, error, filterStatus, statusOptions, formatPredicate, formatDate, setStatus, toggle, remove };
  },
};
</script>

<style scoped>
.contracts-manager { display: flex; flex-direction: column; gap: 16px; }
.manager-header h3 { color: var(--color-light-green); font-size: 1.2em; font-weight: 500; margin: 0 0 4px 0; }
.subtitle { color: var(--color-text-muted); font-size: 0.85em; opacity: 0.8; margin: 0; }

.filter-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.chip {
  background: transparent; border: 1px solid var(--terminal-border-color); color: var(--color-text-muted);
  padding: 4px 12px; border-radius: 16px; font-size: 0.85em; cursor: pointer; text-transform: capitalize;
}
.chip.active { background: rgba(var(--primary-rgb), 0.15); color: var(--color-primary); border-color: rgba(var(--primary-rgb), 0.4); }
.totals { margin-left: auto; display: flex; gap: 12px; font-size: 0.85em; color: var(--color-text-muted); }
.totals .violations { color: var(--color-orange); }

.empty-state { padding: 32px; text-align: center; color: var(--color-text-muted); border: 1px dashed var(--terminal-border-color); border-radius: 8px; }
.empty-state i { font-size: 2em; opacity: 0.4; display: block; margin-bottom: 8px; }
.hint { font-size: 0.85em; opacity: 0.7; margin-top: 4px; }

.contract-list { display: flex; flex-direction: column; gap: 8px; }
.contract-row {
  display: flex; justify-content: space-between; align-items: flex-start; gap: 12px;
  background: var(--color-darker-1); border: 1px solid var(--terminal-border-color);
  border-radius: 8px; padding: 12px 16px;
}
.row-main { flex: 1; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.row-title { display: flex; align-items: center; gap: 10px; }
.target-chip {
  font-family: var(--font-family-mono); font-size: 0.8em;
  background: rgba(var(--blue-rgb), 0.1); color: var(--color-blue);
  padding: 2px 8px; border-radius: 4px;
}
.name { font-weight: 500; color: var(--color-text); }
.off-chip { font-size: 0.75em; padding: 2px 6px; border-radius: 4px; background: rgba(127,127,127,0.15); color: var(--color-text-muted); }
.confidence { margin-left: auto; font-size: 0.85em; font-family: var(--font-family-mono); color: var(--color-text-muted); }
.row-predicate code {
  font-family: var(--font-family-mono); font-size: 0.85em;
  background: var(--color-darker-2); padding: 4px 8px; border-radius: 4px;
  color: var(--color-light-green); display: inline-block;
}
.row-meta { display: flex; flex-wrap: wrap; gap: 12px; font-size: 0.8em; color: var(--color-text-muted); }
.row-meta i { margin-right: 4px; opacity: 0.7; }
.row-meta .bad { color: var(--color-orange); }
.row-actions { display: flex; gap: 6px; }
.icon-btn {
  background: transparent; border: 1px solid var(--terminal-border-color); color: var(--color-text-muted);
  width: 32px; height: 32px; border-radius: 6px; cursor: pointer; transition: all 0.15s;
}
.icon-btn:hover { background: rgba(var(--primary-rgb), 0.1); color: var(--color-primary); border-color: var(--color-primary); }
.icon-btn.danger:hover { background: rgba(var(--red-rgb), 0.1); color: var(--color-red); border-color: var(--color-red); }
.error-banner { color: var(--color-red); padding: 8px 12px; border: 1px solid rgba(var(--red-rgb), 0.3); border-radius: 6px; }
</style>
