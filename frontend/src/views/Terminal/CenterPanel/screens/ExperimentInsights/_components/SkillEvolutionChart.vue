<template>
  <div class="evolution-chart">
    <div class="chart-area" ref="chartArea">
      <svg v-if="data.length > 0" :viewBox="`0 0 ${chartWidth} ${chartHeight}`" class="chart-svg" preserveAspectRatio="none">
        <!-- Grid lines -->
        <line v-for="i in 5" :key="'grid-' + i" :x1="padding" :x2="chartWidth - padding" :y1="padding + ((i - 1) / 4) * plotHeight" :y2="padding + ((i - 1) / 4) * plotHeight" class="grid-line" />

        <!-- Data line -->
        <polyline :points="linePoints" class="data-line" fill="none" />

        <!-- Data points -->
        <circle v-for="(point, idx) in dataPoints" :key="'point-' + idx" :cx="point.x" :cy="point.y" r="4" class="data-point" :class="point.variant" />
      </svg>

      <!-- Y-axis labels -->
      <div class="y-labels">
        <span v-for="i in 5" :key="'y-' + i" class="y-label" :style="{ top: (((i - 1) / 4) * 100) + '%' }">{{ (maxScore - ((i - 1) / 4) * (maxScore - minScore)).toFixed(2) }}</span>
      </div>
    </div>

    <!-- X-axis labels -->
    <div class="x-labels">
      <span v-for="point in data" :key="'x-' + point.iteration" class="x-label">{{ point.iteration }}</span>
    </div>

    <!-- Legend -->
    <div class="chart-legend">
      <span class="legend-item"><span class="legend-dot baseline"></span> Baseline</span>
      <span class="legend-item"><span class="legend-dot mutated"></span> Mutated</span>
    </div>

    <div v-if="data.length === 0" class="no-data">No evolution data available.</div>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({ data: { type: Array, required: true, default: () => [] } });

const chartWidth = 600;
const chartHeight = 200;
const padding = 40;
const plotWidth = chartWidth - padding * 2;
const plotHeight = chartHeight - padding * 2;

const scores = computed(() => props.data.map((d) => d.score));
const minScore = computed(() => scores.value.length > 0 ? Math.min(...scores.value) * 0.95 : 0);
const maxScore = computed(() => scores.value.length > 0 ? Math.max(...scores.value) * 1.05 : 1);
const scoreRange = computed(() => maxScore.value - minScore.value || 1);

const dataPoints = computed(() => {
  if (props.data.length === 0) return [];
  const xStep = props.data.length > 1 ? plotWidth / (props.data.length - 1) : plotWidth / 2;
  return props.data.map((d, i) => ({
    x: padding + (props.data.length > 1 ? i * xStep : plotWidth / 2),
    y: padding + plotHeight - ((d.score - minScore.value) / scoreRange.value) * plotHeight,
    variant: d.variant || 'mutated',
  }));
});

const linePoints = computed(() => dataPoints.value.map((p) => `${p.x},${p.y}`).join(' '));
</script>

<style scoped>
.evolution-chart {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.chart-area {
  position: relative;
  height: 200px;
}

.chart-svg {
  width: 100%;
  height: 100%;
}

.grid-line {
  stroke: var(--terminal-border-color);
  stroke-width: 0.5;
  stroke-dasharray: 4, 4;
}

.data-line {
  stroke: var(--color-green);
  stroke-width: 2;
  stroke-linejoin: round;
}

.data-point {
  fill: var(--color-green);
  stroke: rgba(0, 0, 0, 0.15);
  stroke-width: 2;
  transition: r 0.15s;
  cursor: pointer;
}

.data-point:hover {
  r: 6;
}

.data-point.baseline {
  fill: #999;
}

.data-point.mutated {
  fill: var(--color-green);
}

.data-point.control {
  fill: #3b82f6;
}

/* Y-axis Labels */
.y-labels {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 6px 0;
}

.y-label {
  font-size: 0.7em;
  color: var(--color-grey);
  font-family: monospace;
  letter-spacing: 0.5px;
}

/* X-axis Labels */
.x-labels {
  display: flex;
  justify-content: space-between;
  padding: 0 40px;
}

.x-label {
  font-size: 0.7em;
  color: var(--color-grey);
  letter-spacing: 0.5px;
}

/* Legend */
.chart-legend {
  display: flex;
  gap: 16px;
  justify-content: center;
  padding: 4px 0;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.7em;
  color: var(--color-grey);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.legend-dot.baseline {
  background: #999;
}

.legend-dot.mutated {
  background: var(--color-green);
}

.no-data {
  font-size: 0.85em;
  color: var(--color-text-muted);
  text-align: center;
  padding: 40px;
}
</style>
