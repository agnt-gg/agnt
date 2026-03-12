<template>
  <div class="experiments-panel">
    <!-- Panel Header -->
    <div class="panel-header">
      <h2 class="title">/ Evolution</h2>
      <div class="panel-stats">
        <span v-if="pendingInsightCount > 0" class="stat-item pending-badge">
          <i class="fas fa-lightbulb"></i>
          {{ pendingInsightCount }}
        </span>
        <span class="stat-item">
          <i class="fas fa-flask"></i>
          {{ totalExperiments }}
        </span>
      </div>
    </div>

    <!-- Panel Content -->
    <div class="panel-content">
      <!-- Insight stats -->
      <div v-if="hasInsightStats" class="section-label">Insights</div>
      <div v-if="hasInsightStats" class="stats-grid">
        <div class="stat-card">
          <div class="stat-value pending-val">{{ insightStats?.statusCounts?.pending || 0 }}</div>
          <div class="stat-label">Pending</div>
        </div>
        <div class="stat-card">
          <div class="stat-value applied-val">{{ insightStats?.statusCounts?.applied || 0 }}</div>
          <div class="stat-label">Applied</div>
        </div>
      </div>

      <!-- Target breakdown -->
      <div v-if="hasTargetCounts" class="target-breakdown">
        <div v-for="(count, type) in insightStats?.targetCounts" :key="type" class="target-row">
          <i :class="targetIcon(type)"></i>
          <span class="target-type">{{ type }}</span>
          <span class="target-count">{{ count }}</span>
        </div>
      </div>

      <!-- Experiment stats -->
      <div class="section-label">Experiments</div>
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
        <button @click="refreshAll" class="action-button">
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
  props: {
    insightStats: { type: Object, default: null },
    pendingInsightCount: { type: Number, default: 0 },
  },
  emits: ['panel-action'],
  setup(props, { emit }) {
    const store = useStore();
    const all = computed(() => store.getters['experiments/allExperiments'] || []);

    const hasInsightStats = computed(() => {
      const sc = props.insightStats?.statusCounts;
      return sc && (sc.pending || sc.applied || sc.rejected);
    });

    const hasTargetCounts = computed(() => {
      const tc = props.insightStats?.targetCounts;
      return tc && Object.keys(tc).length > 0;
    });

    const targetIcon = (t) => ({ agent: 'fas fa-robot', skill: 'fas fa-puzzle-piece', workflow: 'fas fa-project-diagram', tool: 'fas fa-wrench' }[t] || 'fas fa-cube');

    const refreshAll = () => {
      store.dispatch('experiments/fetchExperiments', { force: true });
      store.dispatch('insights/fetchInsights');
      store.dispatch('insights/fetchStats');
    };

    return {
      store,
      emit,
      hasInsightStats,
      hasTargetCounts,
      targetIcon,
      refreshAll,
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

.stat-item.pending-badge {
  color: #f59e0b;
  opacity: 1;
  font-weight: 600;
}

.panel-content {
  flex: 1;
  overflow-y: auto;
  scrollbar-width: none;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.panel-content::-webkit-scrollbar {
  display: none;
}

.section-label {
  font-size: 0.7em;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--color-grey);
  margin-top: 4px;
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

.stat-value.pending-val { color: #f59e0b; }
.stat-value.applied-val { color: var(--color-green); }

.stat-label {
  font-size: 0.8em;
  color: var(--color-text-muted);
  text-transform: uppercase;
}

/* Target breakdown */
.target-breakdown {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.target-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color-light);
  font-size: 0.85em;
}
.target-row i {
  color: var(--color-grey);
  width: 14px;
  text-align: center;
  font-size: 0.9em;
}
.target-type {
  flex: 1;
  color: var(--color-text);
  text-transform: capitalize;
}
.target-count {
  color: var(--color-primary);
  font-weight: 600;
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
