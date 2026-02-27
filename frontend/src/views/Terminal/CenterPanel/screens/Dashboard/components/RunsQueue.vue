<template>
  <BaseDashboardCard title="RUNS QUEUE & THROUGHPUT">
    <div class="queue-stats">
      <div class="stat-line">
        <div class="stat-group">
          <span class="label">Queued:</span>
          <span class="value clickable">[{{ queuedRuns }}]</span>
        </div>
        <div class="stat-group">
          <span class="label">Running:</span>
          <span class="value">{{ runningRuns }}</span>
        </div>
        <div class="stat-group">
          <span class="label">Completed:</span>
          <span class="value">{{ completedRuns }}</span>
        </div>
        <div class="stat-group">
          <span class="label">Failed:</span>
          <span class="value">{{ failedRuns }}</span>
        </div>
        <div class="stat-group">
          <span class="label">p95:</span>
          <span class="value">{{ latencyP95 }}s</span>
        </div>
      </div>
    </div>
    <div class="throughput-chart">
      <div class="chart-row">
        <span class="time-label">&lt;5s:</span>
        <span class="count-label">{{ throughputData.lessThanFive }}</span>
        <div class="chart-bar">
          <div class="bar-fill" :style="{ width: getBarWidth(throughputData.lessThanFive) + '%' }"></div>
        </div>
      </div>
      <div class="chart-row">
        <span class="time-label">5-15s:</span>
        <span class="count-label">{{ throughputData.fiveToFifteen }}</span>
        <div class="chart-bar">
          <div class="bar-fill" :style="{ width: getBarWidth(throughputData.fiveToFifteen) + '%' }"></div>
        </div>
      </div>
      <div class="chart-row">
        <span class="time-label">15-30s:</span>
        <span class="count-label">{{ throughputData.fifteenToThirty }}</span>
        <div class="chart-bar">
          <div class="bar-fill" :style="{ width: getBarWidth(throughputData.fifteenToThirty) + '%' }"></div>
        </div>
      </div>
      <div class="chart-row">
        <span class="time-label">30-60s:</span>
        <span class="count-label">{{ throughputData.thirtyToSixty }}</span>
        <div class="chart-bar">
          <div class="bar-fill" :style="{ width: getBarWidth(throughputData.thirtyToSixty) + '%' }"></div>
        </div>
      </div>
      <div class="chart-row">
        <span class="time-label">60s+:</span>
        <span class="count-label">{{ throughputData.sixtyPlus }}</span>
        <div class="chart-bar">
          <div class="bar-fill" :style="{ width: getBarWidth(throughputData.sixtyPlus) + '%' }"></div>
        </div>
      </div>
    </div>
  </BaseDashboardCard>
</template>

<script>
import BaseDashboardCard from './BaseDashboardCard.vue';

export default {
  name: 'RunsQueue',
  components: {
    BaseDashboardCard,
  },
  props: {
    runsData: {
      type: Object,
      default: () => ({
        queued: 341,
        running: 28,
        latencyP95: 420,
        throughput: {
          lessThanFive: 850,
          fiveToFifteen: 120,
          fifteenToThirty: 45,
          thirtyToSixty: 18,
          sixtyPlus: 10,
        },
      }),
    },
  },
  computed: {
    queuedRuns() {
      return this.runsData.queued || 0;
    },
    runningRuns() {
      return this.runsData.running || 0;
    },
    completedRuns() {
      return this.runsData.completed || 0;
    },
    failedRuns() {
      return this.runsData.failed || 0;
    },
    latencyP95() {
      return this.runsData.latencyP95 || 0;
    },
    throughputData() {
      return this.runsData.throughput;
    },
    maxThroughput() {
      const values = [
        this.throughputData.lessThanFive,
        this.throughputData.fiveToFifteen,
        this.throughputData.fifteenToThirty,
        this.throughputData.thirtyToSixty,
        this.throughputData.sixtyPlus,
      ];
      return Math.max(...values, 1); // Minimum 1 to avoid division by zero
    },
  },
  methods: {
    getBarWidth(count) {
      // Calculate percentage based on max value
      return Math.min((count / this.maxThroughput) * 100, 100);
    },
  },
};
</script>

<style scoped>
.queue-stats {
  border-bottom: 1px solid var(--terminal-border-color);
  padding-bottom: 8px;
  margin-bottom: 12px;
}

.stat-line {
  display: flex;
  flex-wrap: nowrap;
  gap: 12px;
  font-size: 0.75em;
  justify-content: space-between;
}

.stat-group {
  display: flex;
  align-items: center;
  gap: 4px;
}

.label {
  color: var(--color-text-muted);
  font-weight: bold;
  white-space: nowrap;
  width: fit-content;
}

.value {
  color: var(--color-text);
  white-space: nowrap;
}

.value.clickable {
  color: var(--color-primary);
  background: var(--color-darker-1);
  padding: 2px 4px;
  border-radius: 2px;
  border: 1px solid var(--terminal-border-color);
  cursor: pointer;
  transition: all 0.2s ease;
}

.value.clickable:hover {
  background: var(--color-darker-2);
  transform: translateY(-1px);
}

.throughput-chart {
  flex: 1;
  display: grid;
  grid-template-columns: auto auto 1fr;
  gap: 4px 8px;
  align-items: center;
}

.chart-row {
  display: contents;
}

.time-label {
  color: var(--color-text-muted);
  font-weight: bold;
  font-size: 0.8em;
  white-space: nowrap;
}

.count-label {
  color: var(--color-text);
  font-weight: bold;
  font-size: 0.8em;
  text-align: right;
  min-width: 40px;
}

.chart-bar {
  height: 16px;
  background: var(--color-darker-1);
  border-radius: 2px;
  position: relative;
  overflow: hidden;
}

.bar-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--color-primary), var(--color-secondary));
  color: var(--color-primary);
  font-size: 0.7em;
  line-height: 16px;
  padding-left: 2px;
  transition: width 0.3s ease;
  text-shadow: none;
  font-weight: bold;
}
</style>
