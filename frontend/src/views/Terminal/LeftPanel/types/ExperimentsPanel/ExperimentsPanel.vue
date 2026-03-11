<template>
  <div class="experiments-panel">
    <!-- Panel Header -->
    <div class="panel-header">
      <h2 class="title">/ Experiments</h2>
      <div class="panel-stats">
        <span class="stat-item">
          <i class="fas fa-flask"></i>
          {{ totalExperiments }}
        </span>
      </div>
    </div>

    <!-- Panel Content -->
    <div class="panel-content">
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">{{ totalExperiments }}</div>
          <div class="stat-label">Total</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{{ runningCount }}</div>
          <div class="stat-label">Running</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{{ completedCount }}</div>
          <div class="stat-label">Done</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{{ failedCount }}</div>
          <div class="stat-label">Failed</div>
        </div>
      </div>

      <div class="action-buttons">
        <button @click="emit('panel-action', 'navigate', 'ExperimentsScreen')" class="action-button">
          <i class="fas fa-plus"></i> New Experiment
        </button>
        <button @click="store.dispatch('experiments/fetchExperiments', { force: true })" class="action-button">
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
  name: 'ExperimentsPanel',
  emits: ['panel-action'],
  setup(props, { emit }) {
    const store = useStore();
    const all = computed(() => store.getters['experiments/allExperiments'] || []);

    return {
      store,
      emit,
      totalExperiments: computed(() => all.value.length),
      runningCount: computed(() => all.value.filter(e => e.status === 'running').length),
      completedCount: computed(() => all.value.filter(e => e.status === 'completed').length),
      failedCount: computed(() => all.value.filter(e => e.status === 'failed').length),
    };
  },
};
</script>

<style scoped>
.experiments-panel {
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

.stats-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

.stat-card {
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color-light);
  padding: 12px;
  border-radius: 0px;
  text-align: center;
}

.stat-value {
  font-size: 1.8em;
  font-weight: bold;
  color: var(--color-primary);
  margin-bottom: 4px;
}

.stat-label {
  font-size: 0.8em;
  color: var(--color-text-muted);
  text-transform: uppercase;
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
