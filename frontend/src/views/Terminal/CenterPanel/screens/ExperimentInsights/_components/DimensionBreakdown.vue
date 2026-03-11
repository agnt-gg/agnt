<template>
  <div class="dimension-breakdown">
    <div v-for="dim in dimensions" :key="dim.name" class="dimension-row">
      <div class="dim-header">
        <span class="dim-name">{{ dim.name }}</span>
        <span class="dim-delta" :class="dim.delta > 0 ? 'positive' : dim.delta < 0 ? 'negative' : ''">
          {{ dim.delta > 0 ? '+' : '' }}{{ dim.delta.toFixed(3) }}
        </span>
      </div>
      <div class="dim-bars">
        <div class="bar-row">
          <span class="bar-label">Baseline</span>
          <div class="bar-track">
            <div class="bar-fill baseline" :style="{ width: Math.min(dim.baseline * 100, 100) + '%' }"></div>
          </div>
          <span class="bar-value">{{ dim.baseline.toFixed(3) }}</span>
        </div>
        <div class="bar-row">
          <span class="bar-label">Mutated</span>
          <div class="bar-track">
            <div class="bar-fill mutated" :class="dim.delta > 0 ? 'improved' : dim.delta < 0 ? 'regressed' : ''" :style="{ width: Math.min(dim.mutated * 100, 100) + '%' }"></div>
          </div>
          <span class="bar-value">{{ dim.mutated.toFixed(3) }}</span>
        </div>
      </div>
    </div>
    <div v-if="dimensions.length === 0" class="no-data">No dimension data available.</div>
  </div>
</template>

<script setup>
defineProps({ dimensions: { type: Array, required: true, default: () => [] } });
</script>

<style scoped>
.dimension-breakdown {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.dimension-row {
  padding: 12px;
  background: rgba(0, 0, 0, 0.15);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
}

.dim-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.dim-name {
  font-size: 0.9em;
  font-weight: 500;
  color: var(--color-text);
  text-transform: capitalize;
}

.dim-delta {
  font-size: 0.85em;
  font-weight: 600;
  font-family: monospace;
  color: var(--color-grey);
}

.dim-delta.positive {
  color: var(--color-green);
}

.dim-delta.negative {
  color: var(--color-red);
}

.dim-bars {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.bar-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.bar-label {
  font-size: 0.7em;
  color: var(--color-grey);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  width: 56px;
  text-align: right;
  flex-shrink: 0;
}

.bar-track {
  flex: 1;
  height: 8px;
  background: rgba(var(--green-rgb), 0.05);
  border-radius: 4px;
  overflow: hidden;
}

.bar-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.5s ease;
}

.bar-fill.baseline {
  background: rgba(150, 150, 150, 0.4);
}

.bar-fill.mutated {
  background: rgba(var(--green-rgb), 0.4);
}

.bar-fill.mutated.improved {
  background: var(--color-green);
}

.bar-fill.mutated.regressed {
  background: var(--color-red);
}

.bar-value {
  font-size: 0.7em;
  color: var(--color-grey);
  font-family: monospace;
  letter-spacing: 0.5px;
  width: 48px;
  flex-shrink: 0;
}

.no-data {
  font-size: 0.85em;
  color: var(--color-text-muted);
  text-align: center;
  padding: 16px;
}
</style>
