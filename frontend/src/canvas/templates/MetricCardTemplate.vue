<template>
  <div class="mt-card" :style="cardStyle">
    <div class="mt-label">{{ displayLabel }}</div>
    <div class="mt-value" :style="{ color: valueColor }">{{ displayValue }}</div>
    <div v-if="displaySubtext" class="mt-subtext">{{ displaySubtext }}</div>
    <div v-if="showTrend" class="mt-trend" :class="trendClass">
      <i :class="trendIcon"></i>
      <span>{{ trendText }}</span>
    </div>
  </div>
</template>

<script>
import { computed } from 'vue';

export default {
  name: 'MetricCardTemplate',
  props: {
    config: { type: Object, default: () => ({}) },
    definition: { type: Object, default: () => ({}) },
  },
  setup(props) {
    const displayLabel = computed(() => props.config.label || 'Metric');
    const displayValue = computed(() => props.config.value || '0');
    const displaySubtext = computed(() => props.config.subtext || '');
    const valueColor = computed(() => props.config.value_color || 'var(--color-green)');
    const showTrend = computed(() => props.config.trend !== undefined && props.config.trend !== null);
    const trendValue = computed(() => parseFloat(props.config.trend) || 0);

    const trendClass = computed(() => (trendValue.value >= 0 ? 'mt-trend-up' : 'mt-trend-down'));
    const trendIcon = computed(() => (trendValue.value >= 0 ? 'fas fa-arrow-up' : 'fas fa-arrow-down'));
    const trendText = computed(() => {
      const abs = Math.abs(trendValue.value);
      return `${abs}%`;
    });

    const cardStyle = computed(() => ({
      background: props.config.background || 'rgba(255,255,255,0.02)',
    }));

    return {
      displayLabel,
      displayValue,
      displaySubtext,
      valueColor,
      showTrend,
      trendClass,
      trendIcon,
      trendText,
      cardStyle,
    };
  },
};
</script>

<style scoped>
.mt-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 16px;
  gap: 6px;
  text-align: center;
  border-radius: 4px;
}

.mt-label {
  font-size: 10px;
  letter-spacing: 2px;
  text-transform: uppercase;
  color: var(--color-text-muted, #556);
  font-weight: 600;
}

.mt-value {
  font-size: 32px;
  font-weight: 700;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.mt-subtext {
  font-size: 10px;
  color: var(--color-text-muted, #445);
}

.mt-trend {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 12px;
}

.mt-trend-up {
  color: var(--color-green);
  background: rgba(var(--green-rgb), 0.08);
}

.mt-trend-down {
  color: var(--color-red);
  background: rgba(var(--red-rgb), 0.08);
}

.mt-trend i {
  font-size: 9px;
}
</style>
