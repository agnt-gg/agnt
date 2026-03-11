<template>
  <div class="experiment-insights-panel">
    <!-- Panel Header -->
    <div class="panel-header">
      <h2 class="title">/ Insights</h2>
    </div>

    <!-- Panel Content -->
    <div class="panel-content">
      <div class="nav-list">
        <button
          v-for="n in navItems"
          :key="n.id"
          class="nav-btn"
          :class="{ active: active === n.id }"
          @click="active = n.id"
        >
          <i :class="n.icon"></i> {{ n.label }}
        </button>
      </div>

      <div class="summary-section">
        <h4 class="section-label">Summary</h4>
        <div class="summary-list">
          <div class="summary-row">
            <span class="label"><i class="fas fa-flask"></i> Experiments:</span>
            <span class="value">{{ stats.total || 0 }}</span>
          </div>
          <div class="summary-row">
            <span class="label"><i class="fas fa-check-circle"></i> Success Rate:</span>
            <span class="value">{{ stats.successRate || 0 }}%</span>
          </div>
          <div class="summary-row">
            <span class="label"><i class="fas fa-chart-line"></i> Avg Delta:</span>
            <span class="value" :class="(stats.avgDelta || 0) >= 0 ? 'pos' : 'neg'">
              {{ (stats.avgDelta || 0) >= 0 ? '+' : '' }}{{ (stats.avgDelta || 0).toFixed(3) }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, computed } from 'vue';
import { useStore } from 'vuex';

export default {
  name: 'ExperimentInsightsPanel',
  emits: ['panel-action'],
  setup() {
    const store = useStore();

    return {
      active: ref('overview'),
      navItems: [
        { id: 'overview', label: 'Overview', icon: 'fas fa-tachometer-alt' },
        { id: 'by-skill', label: 'By Skill', icon: 'fas fa-brain' },
        { id: 'timeline', label: 'Timeline', icon: 'fas fa-clock' },
      ],
      stats: computed(() => store.getters['experiments/experimentStats'] || {}),
    };
  },
};
</script>

<style scoped>
.experiment-insights-panel {
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

.nav-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.nav-btn {
  padding: 8px 12px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 0px;
  color: var(--color-text);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.85em;
  width: 100%;
  text-align: left;
  transition: all 0.15s;
}

.nav-btn:hover {
  background: rgba(var(--primary-rgb), 0.05);
}

.nav-btn.active {
  background: rgba(var(--primary-rgb), 0.1);
  border-color: rgba(var(--primary-rgb), 0.3);
  color: var(--color-primary);
}

.nav-btn i {
  width: 14px;
  text-align: center;
}

.section-label {
  color: var(--color-text-muted);
  font-size: 0.85em;
  margin: 0 0 8px 0;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.summary-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.summary-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.95em;
}

.summary-row .label {
  color: var(--color-text-muted);
  display: flex;
  align-items: center;
  gap: 10px;
}

.summary-row .label i {
  width: 14px;
  text-align: center;
  color: var(--color-primary);
}

.summary-row .value {
  color: var(--color-primary);
  text-align: right;
  font-weight: 500;
}

.pos {
  color: var(--color-primary) !important;
}

.neg {
  color: #ef4444 !important;
}
</style>
