<template>
  <div class="eval-datasets-panel">
    <!-- Panel Header -->
    <div class="panel-header">
      <h2 class="title">/ Eval Datasets</h2>
      <div class="panel-stats">
        <span class="stat-item">
          <i class="fas fa-database"></i>
          {{ total }}
        </span>
      </div>
    </div>

    <!-- Panel Content -->
    <div class="panel-content">
      <div class="source-list">
        <div
          v-for="s in sources"
          :key="s.name"
          class="source-row"
        >
          <i :class="s.icon"></i>
          <span class="source-name">{{ s.name }}</span>
          <span class="source-count">{{ s.count }}</span>
        </div>
      </div>

      <div class="action-buttons">
        <button @click="emit('panel-action', 'create-dataset')" class="action-button">
          <i class="fas fa-plus"></i> New Dataset
        </button>
        <button @click="store.dispatch('experiments/fetchEvalDatasets', { force: true })" class="action-button">
          <i class="fas fa-sync"></i> Refresh
        </button>
      </div>
    </div>
  </div>
</template>

<script>
import { computed } from 'vue';
import { useStore } from 'vuex';

export default {
  name: 'EvalDatasetsPanel',
  emits: ['panel-action'],
  setup(props, { emit }) {
    const store = useStore();
    const ds = computed(() => store.getters['experiments/allEvalDatasets'] || []);
    const sources = computed(() => [
      { name: 'synthetic', icon: 'fas fa-robot', count: ds.value.filter(d => d.source === 'synthetic').length },
      { name: 'historical', icon: 'fas fa-history', count: ds.value.filter(d => d.source === 'historical').length },
      { name: 'golden', icon: 'fas fa-star', count: ds.value.filter(d => d.source === 'golden').length },
      { name: 'manual', icon: 'fas fa-pencil-alt', count: ds.value.filter(d => d.source === 'manual').length },
    ]);

    return {
      store,
      emit,
      total: computed(() => ds.value.length),
      sources,
    };
  },
};
</script>

<style scoped>
.eval-datasets-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  gap: 16px;
}

.panel-header {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  padding: 0 0 12px 0;
  border-bottom: 1px solid var(--terminal-border-color-light);
  user-select: none;
}

.panel-header .title {
  color: var(--color-primary);
  font-family: var(--font-family-primary);
  font-size: 16px;
  font-weight: 400;
  letter-spacing: 0.48px;
  margin: 0;
}

.panel-stats {
  display: flex;
  align-items: center;
  gap: 12px;
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--color-light-med-navy);
  font-size: 0.85em;
  opacity: 0.8;
}

.panel-content {
  flex: 1;
  overflow-y: auto;
  scrollbar-width: none;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.panel-content::-webkit-scrollbar {
  display: none;
}

.source-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.source-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.85em;
  color: var(--color-text);
}

.source-row i {
  width: 14px;
  text-align: center;
  color: var(--color-primary);
}

.source-name {
  flex: 1;
  text-transform: capitalize;
}

.source-count {
  color: var(--color-text-muted);
}

.action-buttons {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.action-button {
  padding: 8px 16px;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color-light);
  border-radius: 0px;
  color: var(--color-text);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: all 0.2s;
  font-size: 0.9em;
  width: 100%;
}

.action-button:hover {
  background: rgba(var(--primary-rgb), 0.1);
  border-color: rgba(var(--primary-rgb), 0.5);
}

.action-button i {
  width: 14px;
  text-align: center;
  color: var(--color-primary);
}
</style>
