<template>
  <div class="ct-root">
    <div class="ct-title" v-if="chartTitle">{{ chartTitle }}</div>
    <div class="ct-chart-area" ref="chartArea">
      <!-- Simple bar chart rendered with CSS -->
      <div v-if="chartType === 'bar'" class="ct-bar-chart">
        <div
          v-for="(item, index) in chartData"
          :key="index"
          class="ct-bar-item"
        >
          <div class="ct-bar-label">{{ item.label }}</div>
          <div class="ct-bar-track">
            <div class="ct-bar-fill" :style="barStyle(item, index)"></div>
          </div>
          <div class="ct-bar-value">{{ item.value }}</div>
        </div>
      </div>

      <!-- Simple horizontal progress bars for 'progress' type -->
      <div v-else-if="chartType === 'progress'" class="ct-progress-chart">
        <div
          v-for="(item, index) in chartData"
          :key="index"
          class="ct-progress-item"
        >
          <div class="ct-progress-header">
            <span class="ct-progress-label">{{ item.label }}</span>
            <span class="ct-progress-value">{{ item.value }}%</span>
          </div>
          <div class="ct-progress-track">
            <div class="ct-progress-fill" :style="progressStyle(item, index)"></div>
          </div>
        </div>
      </div>

      <!-- Fallback: list view -->
      <div v-else class="ct-list">
        <div v-for="(item, index) in chartData" :key="index" class="ct-list-item">
          <span class="ct-list-dot" :style="{ background: getColor(index) }"></span>
          <span class="ct-list-label">{{ item.label }}</span>
          <span class="ct-list-value">{{ item.value }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { computed } from 'vue';

const COLORS = ['#19ef83', '#12e0ff', '#e53d8f', '#ffd700', '#7d3de5', '#ff9500', '#ff4757'];

export default {
  name: 'ChartWidgetTemplate',
  props: {
    config: { type: Object, default: () => ({}) },
    definition: { type: Object, default: () => ({}) },
  },
  setup(props) {
    const chartTitle = computed(() => props.config.title || '');
    const chartType = computed(() => props.config.chart_type || 'bar');

    const chartData = computed(() => {
      const data = props.config.data || [];
      if (Array.isArray(data)) return data;
      return [];
    });

    const maxValue = computed(() => {
      return Math.max(...chartData.value.map((d) => parseFloat(d.value) || 0), 1);
    });

    function getColor(index) {
      return COLORS[index % COLORS.length];
    }

    function barStyle(item, index) {
      const pct = ((parseFloat(item.value) || 0) / maxValue.value) * 100;
      return {
        width: pct + '%',
        background: item.color || getColor(index),
      };
    }

    function progressStyle(item, index) {
      const val = Math.min(100, Math.max(0, parseFloat(item.value) || 0));
      return {
        width: val + '%',
        background: item.color || getColor(index),
      };
    }

    return {
      chartTitle,
      chartType,
      chartData,
      getColor,
      barStyle,
      progressStyle,
    };
  },
};
</script>

<style scoped>
.ct-root {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 12px;
  gap: 8px;
}

.ct-title {
  font-size: 11px;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: var(--color-green);
  font-weight: 600;
  flex-shrink: 0;
}

.ct-chart-area {
  flex: 1;
  overflow-y: auto;
}

/* Bar chart */
.ct-bar-chart {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ct-bar-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ct-bar-label {
  font-size: 10px;
  color: var(--color-text-muted, #667);
  width: 60px;
  text-align: right;
  flex-shrink: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ct-bar-track {
  flex: 1;
  height: 14px;
  background: rgba(255,255,255,0.04);
  border-radius: 2px;
  overflow: hidden;
}

.ct-bar-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.3s ease;
}

.ct-bar-value {
  font-size: 10px;
  color: var(--color-light-0, #aab);
  width: 40px;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}

/* Progress chart */
.ct-progress-chart {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ct-progress-item {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.ct-progress-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.ct-progress-label {
  font-size: 10px;
  color: var(--color-text-muted, #667);
}

.ct-progress-value {
  font-size: 10px;
  color: var(--color-light-0, #aab);
  font-variant-numeric: tabular-nums;
}

.ct-progress-track {
  height: 6px;
  background: rgba(255,255,255,0.04);
  border-radius: 3px;
  overflow: hidden;
}

.ct-progress-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.3s ease;
}

/* List view */
.ct-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ct-list-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
}

.ct-list-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.ct-list-label {
  flex: 1;
  font-size: 11px;
  color: var(--color-text-muted, #667);
}

.ct-list-value {
  font-size: 11px;
  color: var(--color-light-0, #aab);
  font-variant-numeric: tabular-nums;
}
</style>
