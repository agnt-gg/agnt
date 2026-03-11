<template>
  <div class="experiment-forge-panel">
    <!-- Panel Header -->
    <div class="panel-header">
      <h2 class="title">/ Experiment Forge</h2>
    </div>

    <!-- Panel Content -->
    <div class="panel-content">
      <div class="template-list">
        <button
          class="template-btn"
          v-for="t in templates"
          :key="t.label"
        >
          <i :class="t.icon"></i> {{ t.label }}
        </button>
      </div>

      <div class="recent-section">
        <h4 class="section-label">Recent</h4>
        <div class="recent-list">
          <div
            v-for="e in recent"
            :key="e.id"
            class="recent-item"
          >
            <span class="name">{{ e.name }}</span>
            <span class="status" :class="e.status">{{ e.status }}</span>
          </div>
          <p v-if="!recent.length" class="empty">No recent experiments</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { computed } from 'vue';
import { useStore } from 'vuex';

export default {
  name: 'ExperimentForgePanel',
  emits: ['panel-action'],
  setup() {
    const store = useStore();

    return {
      templates: [
        { label: 'Quick A/B Test', icon: 'fas fa-vial' },
        { label: 'Benchmark Suite', icon: 'fas fa-trophy' },
        { label: 'Exploratory Run', icon: 'fas fa-compass' },
      ],
      recent: computed(() => (store.getters['experiments/allExperiments'] || []).slice(0, 5)),
    };
  },
};
</script>

<style scoped>
.experiment-forge-panel {
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

.template-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.template-btn {
  padding: 8px 12px;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color-light);
  border-radius: 0px;
  color: var(--color-text);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.85em;
  width: 100%;
  text-align: left;
  transition: all 0.2s;
}

.template-btn:hover {
  background: rgba(var(--primary-rgb), 0.1);
}

.template-btn i {
  width: 14px;
  text-align: center;
  color: var(--color-primary);
}

.section-label {
  color: var(--color-text-muted);
  font-size: 0.85em;
  margin: 0 0 8px 0;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.recent-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.recent-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.85em;
  padding: 4px 0;
}

.name {
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.status {
  font-size: 0.75em;
  padding: 1px 6px;
  border-radius: 3px;
}

.status.running {
  color: #3b82f6;
  background: rgba(59, 130, 246, 0.1);
}

.status.completed {
  color: var(--color-primary);
  background: rgba(var(--primary-rgb), 0.1);
}

.status.planned {
  color: var(--color-text-muted);
  background: rgba(150, 150, 150, 0.1);
}

.empty {
  color: var(--color-text-muted);
  font-size: 0.85em;
  font-style: italic;
  margin: 0;
}
</style>
