<template>
  <div class="ui-panel runs-panel">
    <!-- Panel Header -->
    <div class="panel-header">
      <h2 class="title">/ Runs</h2>
      <div class="panel-stats">
        <span class="stat-item">
          <i class="fas fa-play-circle"></i>
          {{ totalExecutions }}
        </span>
      </div>
    </div>

    <!-- Run Statistics -->
    <div class="runs-stats-section">
      <h4 class="section-title">
        <i class="fas fa-chart-bar"></i>
        Run Statistics
      </h4>
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">{{ totalExecutions }}</div>
          <div class="stat-label">Total</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{{ activeExecutions }}</div>
          <div class="stat-label">Active</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{{ completedCount }}</div>
          <div class="stat-label">Completed</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{{ failedCount }}</div>
          <div class="stat-label">Failed</div>
        </div>
      </div>

      <!-- Type breakdown -->
      <div class="type-breakdown">
        <div class="type-item">
          <i class="fas fa-robot"></i>
          <span>{{ agentCount }} Agents</span>
        </div>
        <div class="type-item">
          <i class="fas fa-bullseye"></i>
          <span>{{ goalCount }} Goals</span>
        </div>
        <div class="type-item">
          <i class="fas fa-project-diagram"></i>
          <span>{{ workflowCount }} Workflows</span>
        </div>
      </div>
    </div>

    <!-- Run Filters -->
    <div class="run-filters-section">
      <h4 class="section-title">
        <i class="fas fa-filter"></i>
        Filter Runs
      </h4>
      <div class="filter-list">
        <div class="filter-item" :class="{ active: currentFilter === 'all' }" @click="setFilter('all')">
          <i class="fas fa-list"></i>
          <span>All Runs</span>
          <span class="filter-count">{{ totalExecutions }}</span>
        </div>
        <div class="filter-item" :class="{ active: currentFilter === 'running' }" @click="setFilter('running')">
          <i class="fas fa-play"></i>
          <span>Running</span>
          <span class="filter-count">{{ runningCount }}</span>
        </div>
        <div class="filter-item" :class="{ active: currentFilter === 'completed' }" @click="setFilter('completed')">
          <i class="fas fa-check"></i>
          <span>Completed</span>
          <span class="filter-count">{{ completedCount }}</span>
        </div>
        <div class="filter-item" :class="{ active: currentFilter === 'failed' }" @click="setFilter('failed')">
          <i class="fas fa-times"></i>
          <span>Failed</span>
          <span class="filter-count">{{ failedCount }}</span>
        </div>
        <div class="filter-item" :class="{ active: currentFilter === 'stopped' }" @click="setFilter('stopped')">
          <i class="fas fa-stop"></i>
          <span>Stopped</span>
          <span class="filter-count">{{ stoppedCount }}</span>
        </div>
      </div>
    </div>

    <!-- Quick Actions -->
    <div class="quick-actions-section">
      <h4 class="section-title">
        <i class="fas fa-bolt"></i>
        Quick Actions
      </h4>
      <div class="action-buttons">
        <button @click="refreshRuns" class="action-button">
          <i class="fas fa-sync"></i>
          Refresh Runs
        </button>
        <button @click="clearFilters" class="action-button">
          <i class="fas fa-filter"></i>
          Clear Filters
        </button>
        <button @click="exportRuns" class="action-button">
          <i class="fas fa-download"></i>
          Export Runs
        </button>
      </div>
    </div>
  </div>
</template>

<script>
import { defineComponent, ref, computed, inject } from 'vue';
import { useStore } from 'vuex';

export default {
  name: 'RunsPanel',
  props: {
    executions: {
      type: Array,
      default: () => [],
    },
    selectedExecutionId: {
      type: String,
      default: null,
    },
    currentFilter: {
      type: String,
      default: 'all',
    },
  },
  emits: ['panel-action'],
  setup(props, { emit }) {
    const store = useStore();
    const playSound = inject('playSound', () => {});

    // Read directly from Vuex so data is available immediately (not dependent on center screen props)
    const executions = computed(() => store.getters['executionHistory/getExecutions'] || []);

    // Computed statistics
    const totalExecutions = computed(() => executions.value.length);

    const activeExecutions = computed(() => {
      return executions.value.filter((exec) => exec.status === 'running' || exec.status === 'started').length;
    });

    const runningCount = computed(() => {
      return executions.value.filter((exec) => exec.status === 'running' || exec.status === 'started').length;
    });

    const completedCount = computed(() => {
      return executions.value.filter((exec) => exec.status === 'completed').length;
    });

    const failedCount = computed(() => {
      return executions.value.filter((exec) => exec.status === 'failed' || exec.status === 'error').length;
    });

    const stoppedCount = computed(() => {
      return executions.value.filter((exec) => exec.status === 'stopped').length;
    });

    const pendingCount = computed(() => {
      return executions.value.filter((exec) => exec.status === 'pending').length;
    });

    // Type breakdown counts
    const agentCount = computed(() => {
      return executions.value.filter((exec) => exec.isAgentExecution || exec.type === 'agent' || exec.id?.startsWith('agent-')).length;
    });

    const goalCount = computed(() => {
      return executions.value.filter((exec) => exec.isGoalExecution || exec.type === 'goal' || exec.id?.startsWith('goal-')).length;
    });

    const workflowCount = computed(() => {
      return executions.value.filter((exec) => {
        const isAgent = exec.isAgentExecution || exec.type === 'agent' || exec.id?.startsWith('agent-');
        const isGoal = exec.isGoalExecution || exec.type === 'goal' || exec.id?.startsWith('goal-');
        return !isAgent && !isGoal;
      }).length;
    });

    // Recent executions (last 5)
    const recentExecutionsList = computed(() => {
      return [...executions.value]
        .sort((a, b) => {
          const dateA = new Date(a.startTime || a.created_at || 0);
          const dateB = new Date(b.startTime || b.created_at || 0);
          return dateB - dateA;
        })
        .slice(0, 5);
    });

    // Methods
    const setFilter = (filter) => {
      playSound('typewriterKeyPress');
      emit('panel-action', 'filter-changed', { filter });
    };

    const selectExecution = (execution) => {
      playSound('typewriterKeyPress');
      emit('panel-action', 'execution-selected', execution);
    };

    const refreshRuns = () => {
      playSound('typewriterKeyPress');
      emit('panel-action', 'refresh-runs');
    };

    const clearFilters = () => {
      playSound('typewriterKeyPress');
      emit('panel-action', 'filter-changed', { filter: 'all' });
    };

    const exportRuns = () => {
      playSound('typewriterKeyPress');
      const runsData = executions.value;
      const dataStr = JSON.stringify(runsData, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `runs-export-${new Date().toISOString().split('T')[0]}.json`;
      link.click();
      URL.revokeObjectURL(url);
      emit('panel-action', 'show-feedback', {
        type: 'success',
        message: '[Runs] Runs exported successfully.',
      });
    };

    // Helper methods
    const getStatusIcon = (status) => {
      const icons = {
        running: 'fas fa-play',
        completed: 'fas fa-check',
        failed: 'fas fa-times',
        stopped: 'fas fa-stop',
        pending: 'fas fa-clock',
        started: 'fas fa-play',
      };
      return icons[status] || 'fas fa-question';
    };

    const formatDuration = (duration) => {
      if (!duration) return 'N/A';
      if (typeof duration === 'number') {
        const minutes = Math.floor(duration / 60);
        const seconds = duration % 60;
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
      }
      return duration;
    };

    const formatRelativeDate = (dateString) => {
      if (!dateString) return 'Unknown';

      const date = new Date(dateString);
      const now = new Date();
      const diffMs = now - date;
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);

      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      if (diffDays < 7) return `${diffDays}d ago`;

      return date.toLocaleDateString();
    };

    return {
      totalExecutions,
      activeExecutions,
      runningCount,
      completedCount,
      failedCount,
      stoppedCount,
      pendingCount,
      agentCount,
      goalCount,
      workflowCount,
      recentExecutionsList,
      setFilter,
      selectExecution,
      refreshRuns,
      clearFilters,
      exportRuns,
      getStatusIcon,
      formatDuration,
      formatRelativeDate,
    };
  },
};
</script>

<style scoped>
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
  color: var(--color-green);
  font-family: var(--font-family-primary);
  font-size: 16px;
  font-weight: 400;
  letter-spacing: 0.48px;
  margin: 0;
}

.panel-stats {
  display: flex;
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

.stat-item i {
  width: 14px;
  text-align: center;
}

.ui-panel {
  display: flex;
  flex-direction: column;
  gap: 20px;
  width: 100%;
  height: 100%;
  position: relative;
  padding-right: 4px;
  z-index: 3;
  overflow-y: auto;
  scrollbar-color: var(--color-duller-navy) transparent;
  scrollbar-width: thin;
}

.section-title {
  color: var(--color-text-muted);
  font-size: 0.9em;
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 16px 0;
  font-weight: 600;
  opacity: 0.95;
}

.section-title i {
  color: var(--color-green);
}

/* Run Statistics */
.runs-stats-section,
.run-filters-section,
.recent-runs-section,
.quick-actions-section {
  background: transparent;
  border: 1px solid var(--terminal-border-color);
  padding: 16px;
  border-radius: 8px;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

.stat-card {
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  padding: 12px;
  border-radius: 6px;
  text-align: center;
}

.stat-value {
  font-size: 1.8em;
  font-weight: bold;
  color: var(--color-text);
  margin-bottom: 4px;
}

.stat-label {
  font-size: 0.8em;
  color: var(--color-secondary);
  text-transform: uppercase;
}

/* Type Breakdown */
.type-breakdown {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--terminal-border-color);
}

.type-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.85em;
  color: var(--color-text-muted);
}

.type-item i {
  font-size: 0.9em;
}

.type-item i.fa-robot {
  color: rgb(167, 139, 250);
}

.type-item i.fa-bullseye {
  color: rgb(248, 113, 113);
}

.type-item i.fa-project-diagram {
  color: rgb(96, 165, 250);
}

/* Filter Lists */
.filter-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.filter-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
  color: var(--color-text-muted);
  border: 1px solid transparent;
}

.filter-item:hover {
  background: rgba(var(--green-rgb), 0.1);
  color: var(--color-text);
}

.filter-item.active {
  background: rgba(var(--green-rgb), 0.15);
  border-color: rgba(var(--green-rgb), 0.3);
  color: var(--color-green);
}

.filter-item i {
  width: 16px;
  text-align: center;
  font-size: 0.9em;
}

.filter-item span:first-of-type {
  flex: 1;
  font-size: 0.9em;
}

.filter-count {
  background: var(--color-darker-0);
  color: var(--color-secondary);
  padding: 2px 6px;
  border-radius: 10px;
  font-size: 0.8em;
  font-weight: 600;
  min-width: 20px;
  text-align: center;
  border: 2px solid var(--terminal-border-color);
  opacity: 0.5;
}

.filter-item.active .filter-count {
  color: var(--color-text);
  opacity: 1;
  border-color: var(--color-green);
}

/* Recent Runs */
.recent-runs-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 200px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(var(--green-rgb), 0.3) transparent;
}

.recent-run-item {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
  padding: 8px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
  border: 1px solid transparent;
}

.recent-run-item:hover {
  background: rgba(var(--green-rgb), 0.08);
  border-color: rgba(var(--green-rgb), 0.2);
}

.recent-run-item.selected {
  background: rgba(var(--green-rgb), 0.15);
  border-color: var(--color-green);
}

.run-info {
  flex: 1;
  min-width: 0;
}

.run-name {
  font-size: 0.85em;
  font-weight: 500;
  color: var(--color-text);
  margin-bottom: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.run-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.75em;
}

.run-status {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 2px 4px;
  border-radius: 8px;
  font-weight: 500;
  text-transform: uppercase;
}

.run-status.running {
  background: rgba(34, 197, 94, 0.2);
  color: var(--color-green);
}

.run-status.completed {
  background: rgba(59, 130, 246, 0.2);
  color: var(--color-blue);
}

.run-status.failed {
  background: rgba(239, 68, 68, 0.2);
  color: var(--color-red);
}

.run-status.stopped {
  background: rgba(156, 163, 175, 0.2);
  color: var(--color-grey);
}

.run-status.pending {
  background: rgba(255, 193, 7, 0.2);
  color: var(--color-yellow);
}

.run-status.started {
  background: rgba(34, 197, 94, 0.2);
  color: var(--color-green);
}

.run-status i {
  font-size: 0.8em;
}

.run-duration {
  color: var(--color-green);
  font-weight: 600;
}

.run-date {
  font-size: 0.75em;
  color: var(--color-text-muted);
  white-space: nowrap;
  opacity: 0.8;
}

.no-runs {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 20px;
  color: var(--color-text-muted);
  opacity: 0.7;
}

.no-runs i {
  font-size: 1.5em;
  color: rgba(127, 129, 147, 0.3);
}

.no-runs span {
  font-size: 0.85em;
}

/* Action Buttons */
.action-buttons {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.action-button {
  padding: 8px 16px;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 4px;
  color: var(--color-text);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: all 0.2s;
  font-size: 0.9em;
  justify-content: flex-start;
  width: 100%;
}

.action-button:hover {
  background: rgba(var(--green-rgb), 0.1);
  border-color: rgba(var(--green-rgb), 0.5);
}

.action-button i {
  width: 16px;
  text-align: center;
}

/* Responsive adjustments */
@media (max-width: 768px) {
  .stats-grid {
    grid-template-columns: 1fr;
    gap: 8px;
  }

  .stat-card {
    padding: 8px;
  }

  .stat-value {
    font-size: 1.2em;
  }
}
</style>
