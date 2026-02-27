<template>
  <div class="agnt-score-breakdown">
    <!-- Compact Header -->
    <!-- <div class="score-header">
      <div class="score-main">
        <span class="score-label"><span style="color: var(--color-green)">$</span>AGNT SCORE</span>
        <span class="score-value">{{ formattedScore }}</span>
        <span class="score-tier">{{ scoreTier }}</span>
      </div>
      <button class="refresh-btn" @click="refreshScore" :disabled="isLoading">
        <span v-if="!isLoading">🔄</span>
        <span v-else>⏳</span>
      </button>
    </div> -->

    <!-- Tier Progress Bar -->
    <div class="tier-progress">
      <div class="tier-bar">
        <div class="tier-fill" :style="{ width: getTierProgress() }"></div>
        <div class="tier-markers">
          <div class="tier-marker" style="left: 8.3%">
            <span class="marker-label">🥉 Bronze</span>
            <span class="marker-value">10K</span>
          </div>
          <div class="tier-marker" style="left: 16.6%">
            <span class="marker-label">🥈 Silver</span>
            <span class="marker-value">25K</span>
          </div>
          <div class="tier-marker" style="left: 33.3%">
            <span class="marker-label">🥇 Gold</span>
            <span class="marker-value">50K</span>
          </div>
          <div class="tier-marker" style="left: 50%">
            <span class="marker-label">💎 Diamond</span>
            <span class="marker-value">100K</span>
          </div>
          <div class="tier-marker" style="left: 75%">
            <span class="marker-label">👑 Legend</span>
            <span class="marker-value">500K</span>
          </div>
          <div class="tier-marker" style="left: 100%">
            <span class="marker-label">🐐 GOAT</span>
            <span class="marker-value">1M</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Compact Breakdown Grid -->
    <div class="breakdown-grid">
      <!-- Productivity -->
      <div class="breakdown-card">
        <div class="card-header">
          <span class="card-icon">🎯</span>
          <span class="card-title">Productivity</span>
          <span class="card-score">{{ (breakdown.productivity || 0).toLocaleString() }}</span>
        </div>
        <div class="card-bar">
          <div class="bar-fill productivity-bar" :style="{ width: getCategoryPercentage('productivity') }">
            <span class="bar-label">{{ getCategoryPercentage('productivity') }}</span>
          </div>
        </div>
        <div class="card-details">
          <div class="detail-row">
            <span>⏱️ Seconds Automated: {{ getSecondsAutomated() }}</span>
            <span
              >× 0.1 = <span class="total-value">+{{ (details.productivity?.secondsAutomated || 0).toLocaleString() }}</span></span
            >
          </div>
          <div class="detail-row">
            <span>✅ Completed Goals: {{ getCompletedGoalsCount() }}</span>
            <span
              >× 50 = <span class="total-value">+{{ (details.productivity?.completedGoals || 0).toLocaleString() }}</span></span
            >
          </div>
          <div class="detail-row">
            <span>🎯 Success Rate: {{ getSuccessRate() }}%</span>
            <span
              >× 20 = <span class="total-value">+{{ (details.productivity?.executionSuccessRate || 0).toLocaleString() }}</span></span
            >
          </div>
        </div>
      </div>

      <!-- Engagement -->
      <div class="breakdown-card">
        <div class="card-header">
          <span class="card-icon">🔥</span>
          <span class="card-title">Engagement</span>
          <span class="card-score">{{ (breakdown.engagement || 0).toLocaleString() }}</span>
        </div>
        <div class="card-bar">
          <div class="bar-fill engagement-bar" :style="{ width: getCategoryPercentage('engagement') }">
            <span class="bar-label">{{ getCategoryPercentage('engagement') }}</span>
          </div>
        </div>
        <div class="card-details">
          <div class="detail-row">
            <span>🎯 Active Goals: {{ getActiveGoalsCount() }}</span>
            <span
              >× 100 = <span class="total-value">+{{ (details.engagement?.activeGoals || 0).toLocaleString() }}</span></span
            >
          </div>
          <div class="detail-row">
            <span>🤖 Active Agents: {{ getActiveAgentsCount() }}</span>
            <span
              >× 100 = <span class="total-value">+{{ (details.engagement?.activeAgents || 0).toLocaleString() }}</span></span
            >
          </div>
          <div class="detail-row">
            <span>⚙️ Active Workflows: {{ getActiveWorkflowsCount() }}</span>
            <span
              >× 50 = <span class="total-value">+{{ (details.engagement?.activeWorkflows || 0).toLocaleString() }}</span></span
            >
          </div>
          <div class="detail-row">
            <span>🔥 Login Streak: {{ getLoginStreak() }} days</span>
            <span
              >× 100 = <span class="total-value">+{{ (details.engagement?.loginStreak || 0).toLocaleString() }}</span></span
            >
          </div>
          <div class="detail-row">
            <span>📅 Daily Runs: {{ getDailyRuns() }}</span>
            <span
              >× 50 = <span class="total-value">+{{ (details.engagement?.dailyRuns || 0).toLocaleString() }}</span></span
            >
          </div>
        </div>
      </div>

      <!-- Infrastructure -->
      <div class="breakdown-card">
        <div class="card-header">
          <span class="card-icon">🛠️</span>
          <span class="card-title">Infrastructure</span>
          <span class="card-score">{{ (breakdown.infrastructure || 0).toLocaleString() }}</span>
        </div>
        <div class="card-bar">
          <div class="bar-fill infrastructure-bar" :style="{ width: getCategoryPercentage('infrastructure') }">
            <span class="bar-label">{{ getCategoryPercentage('infrastructure') }}</span>
          </div>
        </div>
        <div class="card-details">
          <div class="detail-row">
            <span>⚙️ Total Workflows: {{ getTotalWorkflowsCount() }}</span>
            <span
              >× 50 = <span class="total-value">+{{ (details.infrastructure?.totalWorkflows || 0).toLocaleString() }}</span></span
            >
          </div>
          <div class="detail-row">
            <span>🔧 Custom Tools: {{ getCustomToolsCount() }}</span>
            <span
              >× 20 = <span class="total-value">+{{ (details.infrastructure?.customTools || 0).toLocaleString() }}</span></span
            >
          </div>
          <div class="detail-row">
            <span>🔌 Integrations: {{ getIntegrationsCount() }}</span>
            <span
              >× 25 = <span class="total-value">+{{ (details.infrastructure?.integrations || 0).toLocaleString() }}</span></span
            >
          </div>
          <div class="detail-row">
            <span>📦 Tool Inventory: {{ getToolInventoryCount() }}</span>
            <span
              >× 10 = <span class="total-value">+{{ (details.infrastructure?.toolInventory || 0).toLocaleString() }}</span></span
            >
          </div>
        </div>
      </div>

      <!-- Efficiency -->
      <div class="breakdown-card">
        <div class="card-header">
          <span class="card-icon">⚡</span>
          <span class="card-title">Efficiency</span>
          <span class="card-score">{{ (breakdown.efficiency || 0).toLocaleString() }}</span>
        </div>
        <div class="card-bar">
          <div class="bar-fill efficiency-bar" :style="{ width: getCategoryPercentage('efficiency') }">
            <span class="bar-label">{{ getCategoryPercentage('efficiency') }}</span>
          </div>
        </div>
        <div class="card-details">
          <div class="detail-row">
            <span>✅ Workflow Success: {{ getWorkflowSuccessRate() }}%</span>
            <span
              >× 50 = <span class="total-value">+{{ (details.efficiency?.workflowSuccessRate || 0).toLocaleString() }}</span></span
            >
          </div>
          <div class="detail-row">
            <span>💚 Integration Health: {{ getIntegrationHealthRate() }}%</span>
            <span
              >× 30 = <span class="total-value">+{{ (details.efficiency?.integrationHealth || 0).toLocaleString() }}</span></span
            >
          </div>
          <div class="detail-row">
            <span>⚡ Avg Latency: {{ getAvgLatency() }}s</span>
            <span
              >= <span class="total-value">+{{ (details.efficiency?.executionLatency || 0).toLocaleString() }}</span></span
            >
          </div>
        </div>
      </div>

      <!-- Network -->
      <div class="breakdown-card network-card">
        <div class="card-header">
          <span class="card-icon">🌐</span>
          <span class="card-title">Network</span>
          <span class="card-score">{{ (breakdown.network || 0).toLocaleString() }}</span>
          <span class="boost-badge">20X</span>
        </div>
        <div class="card-bar">
          <div class="bar-fill network-bar" :style="{ width: getCategoryPercentage('network') }">
            <span class="bar-label">{{ getCategoryPercentage('network') }}</span>
          </div>
        </div>
        <div class="card-details">
          <div class="detail-row">
            <span>👥 Total Referrals: {{ getTotalReferrals() }}</span>
            <span>+{{ getActualReferralCredits() }} Ref Score</span>
          </div>
          <div class="detail-row highlight">
            <span>💰 Referral Score</span>
            <span
              >× 20 = <span class="total-value">+{{ getNetworkPoints() }}</span></span
            >
          </div>
          <div class="detail-note">
            {{ getTotalReferrals() }} users referred = {{ getActualReferralCredits() }} credits × 20 = {{ getNetworkPoints() }} pts
          </div>
        </div>
      </div>

      <!-- Scale -->
      <div class="breakdown-card scale-card">
        <div class="card-header">
          <span class="card-icon">📊</span>
          <span class="card-title">Scale</span>
          <span class="card-score">{{ (breakdown.scale || 0).toLocaleString() }}</span>
        </div>
        <div class="card-bar">
          <div class="bar-fill scale-bar" :style="{ width: getCategoryPercentage('scale') }">
            <span class="bar-label">{{ getCategoryPercentage('scale') }}</span>
          </div>
        </div>
        <div class="card-details">
          <div class="detail-row">
            <span>🔄 Total Executions: {{ getTotalExecutions() }}</span>
            <span
              >× 0.5 = <span class="total-value">+{{ (details.scale?.totalExecutions || 0).toLocaleString() }}</span></span
            >
          </div>
          <div class="detail-row">
            <span>⚙️ Node Executions: {{ getTotalNodeExecutions() }}</span>
            <span
              >× 0.01 = <span class="total-value">+{{ (details.scale?.totalNodeExecutions || 0).toLocaleString() }}</span></span
            >
          </div>
          <div class="detail-row">
            <span>✅ Node Success: {{ getNodeSuccessRate() }}%</span>
            <span
              >× 10 = <span class="total-value">+{{ (details.scale?.nodeSuccessRate || 0).toLocaleString() }}</span></span
            >
          </div>
          <div class="detail-row">
            <span>🤖 Total Agents: {{ getTotalAgents() }}</span>
            <span
              >× 50 = <span class="total-value">+{{ (details.scale?.totalAgents || 0).toLocaleString() }}</span></span
            >
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { computed } from 'vue';
import { useStore } from 'vuex';

export default {
  name: 'AgntScoreBreakdown',
  setup() {
    const store = useStore();

    const scoreData = computed(() => store.state.userStats.agntScore);
    const formattedScore = computed(() => scoreData.value?.formatted || '0');
    const breakdown = computed(() => scoreData.value?.breakdown || {});
    const details = computed(() => scoreData.value?.details || {});
    const isLoading = computed(() => store.getters['userStats/isActivityLoading']);
    const referralBalance = computed(() => store.state.userStats.referralBalance);

    // Calculate workflow run percentage for efficiency display
    const allWorkflows = computed(() => store.getters['workflows/allWorkflows'] || []);
    const activeWorkflows = computed(() => store.getters['workflows/activeWorkflows'] || []);
    const workflowRunPercentage = computed(() => {
      if (allWorkflows.value.length === 0) return 0;
      return Math.round((activeWorkflows.value.length / allWorkflows.value.length) * 100);
    });

    const scoreTier = computed(() => {
      const score = scoreData.value?.total || 0;
      if (score >= 100000) return '🐐 GOAT';
      if (score >= 50000) return '👑 Legend';
      if (score >= 10000) return '💎 Diamond';
      if (score >= 5000) return '🥇 Gold';
      if (score >= 2500) return '🥈 Silver';
      if (score >= 1000) return '🥉 Bronze';
      return '🌱 Starter';
    });

    const getBarWidth = (category) => {
      const value = breakdown.value[category] || 0;
      const maxValue = Math.max(...Object.values(breakdown.value));
      if (maxValue === 0) return '0%';
      return `${(value / maxValue) * 100}%`;
    };

    const refreshScore = async () => {
      await Promise.all([
        store.dispatch('userStats/fetchStats'),
        store.dispatch('userStats/fetchReferralBalance'),
        store.dispatch('goals/fetchGoals'),
        store.dispatch('agents/fetchAgents'),
        store.dispatch('workflows/fetchWorkflows'),
        store.dispatch('tools/fetchTools'),
        store.dispatch('executionHistory/fetchExecutions'),
        store.dispatch('appAuth/fetchConnectedApps'),
      ]);
      store.dispatch('userStats/calculateAndStoreAgntScore');
    };

    // Helper methods to get actual unit counts
    const getSecondsAutomated = () => {
      return (store.state.userStats.totalSecondsAutomated || 0).toLocaleString();
    };

    const getCompletedGoalsCount = () => {
      const allGoals = store.getters['goals/allGoals'] || [];
      return allGoals.filter((g) => g.status === 'completed' || g.status === 'validated').length.toLocaleString();
    };

    const getSuccessRate = () => {
      const executions = store.getters['executionHistory/getExecutions'] || [];
      const completed = executions.filter((e) => e.status === 'completed').length;
      return executions.length > 0 ? Math.round((completed / executions.length) * 100) : 0;
    };

    const getActiveGoalsCount = () => {
      return (store.getters['goals/activeGoals'] || []).length.toLocaleString();
    };

    const getActiveAgentsCount = () => {
      const allAgents = store.getters['agents/allAgents'] || [];
      return allAgents.filter((a) => a.status === 'ACTIVE').length.toLocaleString();
    };

    const getActiveWorkflowsCount = () => {
      return (store.getters['workflows/activeWorkflows'] || []).length.toLocaleString();
    };

    const getLoginStreak = () => {
      return (store.state.userStats.loginStreak || 0).toLocaleString();
    };

    const getDailyRuns = () => {
      const executions = store.getters['executionHistory/getExecutions'] || [];
      const now = new Date();
      const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      return executions
        .filter((exec) => {
          if (!exec.startTime) return false;
          const startTime = new Date(exec.startTime);
          return startTime >= twentyFourHoursAgo;
        })
        .length.toLocaleString();
    };

    const getTotalWorkflowsCount = () => {
      return (store.state.userStats.totalWorkflows || 0).toLocaleString();
    };

    const getCustomToolsCount = () => {
      return (store.state.userStats.totalCustomTools || 0).toLocaleString();
    };

    const getIntegrationsCount = () => {
      const healthCheck = store.getters['appAuth/providerHealthDetails'] || [];
      const connected = store.getters['appAuth/connectedApps'] || [];
      return Math.max(healthCheck.length, connected.length).toLocaleString();
    };

    const getToolInventoryCount = () => {
      return (store.getters['tools/allTools'] || []).length.toLocaleString();
    };

    const getWorkflowSuccessRate = () => {
      const allWorkflows = store.getters['workflows/allWorkflows'] || [];
      const completed = allWorkflows.filter((w) => w.status === 'completed' || w.status === 'stopped').length;
      const failed = allWorkflows.filter((w) => w.status === 'error' || w.status === 'insufficient-credits').length;
      return allWorkflows.length > 0 ? Math.round((completed / (completed + failed || 1)) * 100) : 0;
    };

    const getIntegrationHealthRate = () => {
      const allProviders = store.state.appAuth.allProviders || [];
      const connectedApps = store.getters['appAuth/connectedApps'] || [];
      const totalAvailable = allProviders.length;
      const connected = connectedApps.length;
      return totalAvailable > 0 ? Math.round((connected / totalAvailable) * 100) : 0;
    };

    const getAvgLatency = () => {
      const executions = store.getters['executionHistory/getExecutions'] || [];
      const completed = executions.filter((exec) => exec.startTime && exec.endTime);
      if (completed.length === 0) return 0;
      const avgMs =
        completed.reduce((sum, exec) => {
          const duration = new Date(exec.endTime) - new Date(exec.startTime);
          return sum + duration;
        }, 0) / completed.length;
      return Math.round(avgMs / 1000).toLocaleString();
    };

    const getTotalReferrals = () => {
      return (store.state.userStats.referralTree.stats.total || 0).toLocaleString();
    };

    // Network card helper methods
    const getActualReferralCredits = () => {
      const totalReferrals = store.state.userStats.referralTree.stats.total || 0;
      // Only show credits if there are actual referrals
      if (totalReferrals === 0) return '0';
      return (referralBalance.value || 0).toLocaleString();
    };

    const getNetworkPoints = () => {
      const totalReferrals = store.state.userStats.referralTree.stats.total || 0;
      // Only calculate points if there are actual referrals
      if (totalReferrals === 0) return '0';
      return ((referralBalance.value || 0) * 20).toLocaleString();
    };

    // Scale card helper methods
    const getTotalExecutions = () => {
      return (store.state.userStats.totalExecutions || 0).toLocaleString();
    };

    const getTotalNodeExecutions = () => {
      return (store.state.userStats.totalSecondsAutomated || 0).toLocaleString();
    };

    const getNodeSuccessRate = () => {
      const totalNodes = store.state.userStats.totalSecondsAutomated || 0;
      if (totalNodes === 0) return 0;
      // Since we don't have failed node data from API, assume 100% success rate
      return 100;
    };

    const getTotalAgents = () => {
      return (store.getters['agents/allAgents'] || []).length.toLocaleString();
    };

    const getTierProgress = () => {
      const score = scoreData.value?.total || 0;

      // Logarithmic scale matching the tier marker positions
      if (score === 0) return '0%';
      if (score >= 1000000) return '100%';

      // Calculate position based on tier thresholds
      if (score < 10000) {
        // 0 to 1K = 0% to 8.3%
        return `${(score / 10000) * 8.3}%`;
      } else if (score < 25000) {
        // 1K to 2.5K = 8.3% to 16.6%
        return `${8.3 + ((score - 10000) / 15000) * 8.3}%`;
      } else if (score < 50000) {
        // 2.5K to 5K = 16.6% to 33.3%
        return `${16.6 + ((score - 25000) / 25000) * 16.7}%`;
      } else if (score < 100000) {
        // 5K to 10K = 33.3% to 50%
        return `${33.3 + ((score - 50000) / 50000) * 16.7}%`;
      } else if (score < 500000) {
        // 10K to 50K = 50% to 75%
        return `${50 + ((score - 100000) / 400000) * 25}%`;
      } else {
        // 50K to 100K = 75% to 100%
        return `${75 + ((score - 500000) / 500000) * 25}%`;
      }
    };

    const getCategoryPercentage = (category) => {
      const value = breakdown.value[category] || 0;
      const total = scoreData.value?.total || 0;
      if (total === 0) return '0%';
      return `${Math.round((value / total) * 100)}%`;
    };

    return {
      formattedScore,
      breakdown,
      details,
      scoreTier,
      isLoading,
      referralBalance,
      workflowRunPercentage,
      getBarWidth,
      refreshScore,
      getSecondsAutomated,
      getCompletedGoalsCount,
      getSuccessRate,
      getActiveGoalsCount,
      getActiveAgentsCount,
      getActiveWorkflowsCount,
      getLoginStreak,
      getDailyRuns,
      getTotalWorkflowsCount,
      getCustomToolsCount,
      getIntegrationsCount,
      getToolInventoryCount,
      getWorkflowSuccessRate,
      getIntegrationHealthRate,
      getAvgLatency,
      getTotalReferrals,
      getActualReferralCredits,
      getNetworkPoints,
      getTotalExecutions,
      getTotalNodeExecutions,
      getNodeSuccessRate,
      getTotalAgents,
      getTierProgress,
      getCategoryPercentage,
    };
  },
};
</script>

<style scoped>
.agnt-score-breakdown {
  display: flex;
  flex-direction: column;
  gap: 16px;
  font-size: 1em;
  margin-top: 16px;
}

/* Compact Header */
.score-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
}

.score-main {
  display: flex;
  align-items: center;
  gap: 12px;
}

.score-label {
  font-size: 0.75em;
  color: var(--color-text-muted);
  font-weight: bold;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.score-value {
  font-size: 1.5em;
  font-weight: bold;
  color: var(--color-primary);
}

.score-tier {
  font-size: 0.9em;
  color: var(--color-primary);
  padding: 2px 8px;
  background: rgba(var(--primary-rgb), 0.1);
  border-radius: 4px;
}

.refresh-btn {
  padding: 4px 8px;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 4px;
  color: var(--color-text);
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 1em;
}

.refresh-btn:hover:not(:disabled) {
  background: rgba(127, 129, 147, 0.1);
  border-color: var(--color-primary);
}

.refresh-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Tier Progress Bar */
.tier-progress {
  padding: 16px 10px 40px 0px;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  overflow: hidden;
}

.tier-bar {
  position: relative;
  width: 100%;
  height: 8px;
  background: rgba(127, 129, 147, 0.2);
  border-radius: 4px;
  overflow: visible;
  margin: 0 20px;
  width: calc(100% - 40px);
}

.tier-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--color-primary) 0%, var(--color-secondary) 100%);
  border-radius: 4px;
  transition: width 0.8s cubic-bezier(0.4, 0, 0.2, 1);
}

.tier-markers {
  position: relative;
  width: 100%;
  height: 40px;
  margin-top: 8px;
}

.tier-marker {
  position: absolute;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.tier-marker::before {
  content: '';
  position: absolute;
  top: -16px;
  width: 2px;
  height: 12px;
  background: var(--terminal-border-color);
}

.marker-label {
  font-size: 0.75em;
  color: var(--color-text);
  white-space: nowrap;
  font-weight: 600;
}

.marker-value {
  font-size: 0.7em;
  color: var(--color-text-muted);
}

/* Compact Grid */
.breakdown-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

.breakdown-card {
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  padding: 16px;
  transition: all 0.2s ease;
}

.breakdown-card:hover {
  border-color: var(--color-primary);
  transform: translateY(-2px);
}

/* Card Header */
.card-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--terminal-border-color);
}

.card-icon {
  font-size: 1.2em;
}

.card-title {
  flex: 1;
  font-weight: 600;
  color: var(--color-text);
  font-size: 0.9em;
}

.card-score {
  font-weight: bold;
  color: var(--color-primary);
  font-size: 0.95em;
}

.boost-badge {
  font-size: 0.65em;
  color: var(--color-primary);
  background: rgba(var(--primary-rgb), 0.2);
  padding: 3px 4px 0;
  border-radius: 3px;
  font-weight: bold;
}

/* Progress Bar */
.card-bar {
  width: 100%;
  height: 16px;
  background: rgba(127, 129, 147, 0.2);
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 8px;
}

.bar-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--color-primary) 0%, var(--color-secondary) 100%);
  border-radius: 4px;
  transition: width 0.8s cubic-bezier(0.4, 0, 0.2, 1);
  min-width: 2%;
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding-right: 6px;
}

.bar-fill::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.3), transparent);
  animation: shimmer 2s infinite;
  z-index: 0;
}

@keyframes shimmer {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(100%);
  }
}

.bar-label {
  position: relative;
  z-index: 1;
  font-size: 0.75em;
  font-weight: 700;
  color: var(--color-darker-3);
  text-shadow: 0 0 3px rgba(255, 255, 255, 0.8);
  white-space: nowrap;
  margin-bottom: -2px;
}

/* Details */
.card-details {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.detail-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.85em;
  padding: 2px 0;
}

.detail-row span:first-child {
  color: var(--color-text-muted);
}

.detail-row span:last-child {
  color: var(--color-text-muted);
  font-weight: 600;
}

.detail-row span:last-child .total-value {
  color: var(--color-primary) !important;
}

.detail-row.highlight {
  background: rgba(var(--primary-rgb), 0.05);
  padding: 4px 6px;
  border-radius: 4px;
  margin: 2px 0;
}

.detail-note {
  font-size: 0.75em;
  color: var(--color-primary);
  text-align: center;
  padding: 4px;
  background: rgba(var(--primary-rgb), 0.05);
  border-radius: 4px;
  margin-top: 4px;
  font-style: italic;
}

@media (max-width: 1200px) {
  .breakdown-grid {
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  }
}

@media (max-width: 768px) {
  .breakdown-grid {
    grid-template-columns: 1fr;
  }

  .score-main {
    flex-wrap: wrap;
  }
}
</style>
