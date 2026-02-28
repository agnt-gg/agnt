<template>
  <div class="engine-header">
    <div class="engine-grid">
      <div class="status-metrics">
        <div class="status-node active">
          <div class="node-core"></div>
          <span class="node-label">AUTOMATION ENGINE</span>
          <span class="node-value">{{ systemActivity }}%</span>
        </div>

        <div class="metric-card">
          <div class="metric-icon">◈</div>
          <div class="metric-data">
            <span class="metric-value">{{ activeWorkflowsCount }}</span>
            <span class="metric-label">Active Workflows</span>
          </div>
        </div>

        <div class="metric-card">
          <div class="metric-icon">◆</div>
          <div class="metric-data">
            <span class="metric-value">{{ avgExecutionTime }}s</span>
            <span class="metric-label">Avg Run Duration</span>
          </div>
        </div>

        <div class="metric-card">
          <div class="metric-icon">◊</div>
          <div class="metric-data">
            <span class="metric-value">{{ successRate }}%</span>
            <span class="metric-label">Success Rate</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { mapGetters } from 'vuex';

export default {
  name: 'EngineHeader',
  computed: {
    ...mapGetters('goals', ['activeGoals', 'completedGoals', 'allGoals']),
    ...mapGetters('workflows', ['activeWorkflows']),
    ...mapGetters('executionHistory', ['getExecutions']),
    ...mapGetters('agents', ['allAgents']),

    systemActivity() {
      // Calculate system activity based on active goals, workflows, and agents
      const activeGoalsCount = this.activeGoals?.length || 0;
      const activeWorkflowsCount = this.activeWorkflows?.length || 0;
      const activeAgentsCount = this.allAgents?.filter((a) => a.status === 'ACTIVE')?.length || 0;

      // Base activity on number of active items (max 100%)
      const totalActive = activeGoalsCount + activeWorkflowsCount + activeAgentsCount;

      // Scale to percentage (assuming 10+ active items = 100%)
      const activity = Math.min(100, Math.round((totalActive / 10) * 100));

      // If nothing is active, show low baseline activity
      return totalActive > 0 ? Math.max(activity, 15) : 5;
    },

    activeWorkflowsCount() {
      // Return count of active workflows
      return this.activeWorkflows?.length || 0;
    },

    avgExecutionTime() {
      // Calculate average execution duration from execution history
      const executions = this.getExecutions || [];

      if (executions.length === 0) return 0;

      // Calculate duration for each execution
      const durations = executions
        .filter((exec) => exec.startTime && exec.endTime)
        .map((exec) => {
          const start = new Date(exec.startTime);
          const end = new Date(exec.endTime);
          return end - start; // Duration in milliseconds
        })
        .filter((duration) => duration > 0 && duration < 3600000); // Filter out invalid or > 1 hour

      if (durations.length === 0) return 0;

      // Calculate average and convert to seconds
      const avgMs = durations.reduce((sum, d) => sum + d, 0) / durations.length;
      return Math.round(avgMs / 1000); // Convert to seconds
    },

    successRate() {
      // Calculate success rate from goals and executions
      const goals = this.allGoals || [];
      const executions = this.getExecutions || [];

      // Count completed vs failed goals
      const completedGoals = goals.filter((g) => g.status === 'completed' || g.status === 'validated').length;
      const failedGoals = goals.filter((g) => g.status === 'failed').length;

      // Count successful vs failed executions
      const successfulExecs = executions.filter((e) => e.status === 'completed' || e.status === 'success' || e.status === 'validated').length;
      const failedExecs = executions.filter((e) => e.status === 'failed' || e.status === 'error').length;

      const totalCompleted = completedGoals + successfulExecs;
      const totalFailed = failedGoals + failedExecs;
      const total = totalCompleted + totalFailed;

      if (total === 0) return 0;

      return Math.round((totalCompleted / total) * 100);
    },
  },
};
</script>

<style scoped>
.engine-header {
  border-bottom: 1px solid var(--terminal-border-color);
  padding: 0 12px 4px 12px;
}

.engine-grid {
  display: flex;
  gap: 12px;
  align-items: center;
}

.status-node {
  display: flex;
  align-items: center;
  gap: 8px;
}

.node-core {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: linear-gradient(135deg, rgba(var(--green-rgb), 0.2) 0%, rgba(18, 224, 255, 0.2) 100%);
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}

.node-core::before {
  content: '';
  position: absolute;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgba(var(--green-rgb), 0.8);
  animation: system-pulse 2s ease-in-out infinite;
}

@keyframes system-pulse {
  0%,
  100% {
    transform: scale(0.8);
    opacity: 0.8;
  }
  50% {
    transform: scale(1.2);
    opacity: 1;
  }
}

.node-label {
  font-size: 0.55em;
  font-weight: 500;
  color: var(--color-text-muted);
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.node-value {
  font-size: 0.85em;
  font-weight: 200;
  color: var(--color-text);
  font-variant-numeric: tabular-nums;
}

.status-metrics {
  display: flex;
  width: 100%;
  gap: 8px;
  justify-content: space-between;
  align-items: center;
}

.metric-card {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  background: rgba(127, 129, 147, 0.03);
  border-radius: 4px;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.metric-card:hover {
  background: rgba(var(--green-rgb), 0.08);
}

.metric-icon {
  font-size: 0.7em;
  color: var(--color-blue);
}

.metric-data {
  display: flex;
  flex-direction: row;
  align-items: baseline;
  gap: 4px;
}

.metric-value {
  font-size: 0.75em;
  font-weight: 400;
  color: var(--color-text);
  font-variant-numeric: tabular-nums;
}

.metric-label {
  font-size: 0.55em;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

@media (max-width: 768px) {
  .engine-header {
    padding: 12px 16px;
  }

  .engine-grid {
    grid-template-columns: 1fr;
    gap: 16px;
  }

  .status-metrics {
    flex-wrap: wrap;
    gap: 12px;
  }

  .metric-card {
    flex: 1;
    min-width: 120px;
    padding: 10px 12px;
  }
}
</style>
