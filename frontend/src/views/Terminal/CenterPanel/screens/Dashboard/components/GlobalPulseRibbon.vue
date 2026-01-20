<template>
  <div class="global-pulse-ribbon">
    <div class="pulse-section agnt-score-section">
      <span class="pulse-label"><span style="color: var(--color-green)">AGNT</span> XP:</span>
      <span class="agnt-score-value">{{ agntScoreData?.formatted || '0' }}</span>
    </div>
    <!-- <div class="pulse-section">
      <span class="pulse-label">Goals:</span>
      <span class="pulse-item clickable">[{{ goalsData.active }} active]</span>
      <span class="pulse-item clickable">[{{ goalsData.done }} done]</span>
    </div> -->
    <div class="pulse-section">
      <span class="pulse-label">Agents:</span>
      <span class="pulse-item clickable">[{{ agentsData.active }}]</span>
    </div>
    <div class="pulse-section">
      <span class="pulse-label">Workflows:</span>
      <span class="pulse-item clickable">[{{ workflowsData.count }}]</span>
    </div>
    <div class="pulse-section">
      <span class="pulse-label">Tools:</span>
      <span class="pulse-item clickable">[{{ toolsData.count }}]</span>
    </div>
    <div class="pulse-section">
      <span class="pulse-label">Runs:</span>
      <span class="pulse-item clickable">[{{ runsData.queued }} queued]</span>
      <span class="pulse-item clickable">[{{ formatNumber(runsData.daily) }}/24h]</span>
    </div>
    <div class="pulse-section">
      <span class="pulse-label">Integrations:</span>
      <span class="pulse-item clickable">[{{ integrationsData.count }}]</span>
    </div>
    <div class="pulse-section" v-if="daysStreak > 0">
      <span class="pulse-label">Streak:</span>
      <span class="pulse-item clickable" style="color: #ff9d00">[{{ daysStreak }} days 🔥]</span>
    </div>
    <!-- <div class="pulse-section status-section">
      <span class="pulse-label">Status:</span>
      <span :class="['status-indicator', statusClass]">{{ statusIcon }} {{ statusData.health }}</span>
      <span class="pulse-text">SLA: {{ statusData.sla }}%</span>
      <span class="pulse-text">Latency p95: {{ statusData.latency }}ms</span>
      <span class="pulse-text">Cost: ${{ statusData.cost }}/day</span>
    </div> -->
  </div>
</template>

<script>
export default {
  name: 'GlobalPulseRibbon',
  props: {
    agntScoreData: {
      type: Object,
      default: () => ({ total: 0, formatted: '0', breakdown: {} }),
    },
    goalsData: {
      type: Object,
      default: () => ({ active: 0, done: 0 }),
    },
    agentsData: {
      type: Object,
      default: () => ({ active: 0, total: 0 }),
    },
    workflowsData: {
      type: Object,
      default: () => ({ count: 0 }),
    },
    toolsData: {
      type: Object,
      default: () => ({ count: 0 }),
    },
    runsData: {
      type: Object,
      default: () => ({ queued: 0, daily: 0 }),
    },
    integrationsData: {
      type: Object,
      default: () => ({ count: 0 }),
    },
    daysStreak: {
      type: Number,
      default: 0,
    },
    statusData: {
      type: Object,
      default: () => ({
        health: 'Unknown',
        sla: 0,
        latency: 0,
        cost: 0,
      }),
    },
  },
  computed: {
    statusIcon() {
      const health = this.statusData.health?.toLowerCase() || '';
      if (health.includes('healthy')) return '🟢';
      if (health.includes('degraded')) return '🟡';
      if (health.includes('critical') || health.includes('unhealthy')) return '🔴';
      return '⚪';
    },
    statusClass() {
      const health = this.statusData.health?.toLowerCase() || '';
      if (health.includes('healthy')) return 'status-healthy';
      if (health.includes('degraded')) return 'status-degraded';
      if (health.includes('critical') || health.includes('unhealthy')) return 'status-critical';
      return 'status-unknown';
    },
  },
  methods: {
    formatNumber(num) {
      if (num >= 1000) {
        return (num / 1000).toFixed(1) + 'k';
      }
      return num.toString();
    },
  },
};
</script>

<style scoped>
.global-pulse-ribbon {
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  padding: 6px 16px;
  border-radius: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: center;
  justify-content: space-between;
  font-family: var(--font-family-mono);
  font-size: 0.9em;
}

.pulse-section {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.pulse-label {
  color: var(--color-text-muted);
  font-weight: bold;
}

.pulse-item {
  color: var(--color-green);
  background: var(--color-darker-1);
  padding: 2px 6px;
  border-radius: 2px;
  border: 1px solid var(--terminal-border-color);
  transition: all 0.2s ease;
}

.pulse-item:hover {
  background: var(--color-darker-2);
  transform: translateY(-1px);
}

.pulse-text {
  color: var(--color-text);
}

.status-section {
  margin-left: auto;
}

.status-indicator {
  font-weight: bold;
}

.status-healthy {
  color: var(--color-green);
}

.status-degraded {
  color: var(--color-yellow);
}

.status-critical {
  color: var(--color-red);
}

.status-unknown {
  color: var(--color-text-muted);
}

.agnt-score-section {
  background: rgba(25, 239, 131, 0.05);
  padding: 4px 12px;
  border-radius: 4px;
  border: 1px solid rgba(25, 239, 131, 0.2);
}

.agnt-score-value {
  color: var(--color-green);
  font-weight: bold;
  font-size: 1.1em;
  text-shadow: 0 0 8px rgba(25, 239, 131, 0.3);
  letter-spacing: 0.5px;
  /* Prevent any layout shifts or animations */
  min-width: 60px;
  display: inline-block;
  text-align: left;
}

/* .clickable {
  cursor: pointer;
} */

@media (max-width: 768px) {
  .global-pulse-ribbon {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }

  .status-section {
    margin-left: 0;
  }
}
</style>
