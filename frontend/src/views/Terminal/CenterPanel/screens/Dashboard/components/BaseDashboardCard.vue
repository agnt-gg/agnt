<template>
  <div class="dashboard-card" :class="{ 'in-widget': inWidget }">
    <div v-if="title && !inWidget" class="card-header">
      <h4>{{ title }}</h4>
    </div>
    <div class="card-content">
      <div v-if="sectionTitle" class="section-title">{{ sectionTitle }}</div>
      <slot></slot>
    </div>
  </div>
</template>

<script>
import { inject } from 'vue';

export default {
  name: 'BaseDashboardCard',
  props: {
    title: {
      type: String,
      default: '',
    },
    sectionTitle: {
      type: String,
      default: '',
    },
  },
  setup() {
    const inWidget = inject('isInsideWidgetCanvas', false);
    return { inWidget };
  },
};
</script>

<style scoped>
.dashboard-card {
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  /* font-family: var(--font-family-mono); */
  font-size: 0.85em;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.dashboard-card.in-widget {
  background: transparent;
  border: none;
  border-radius: 0;
}

.card-header {
  padding: 8px 12px;
  border-bottom: 1px solid var(--terminal-border-color);
  background: var(--color-darker-0);
}

.card-header h4 {
  margin: 0;
  color: var(--color-green);
  font-weight: bold;
  font-size: var(--font-size-sm);
}

.card-content {
  padding: 12px;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: var(--font-size-sm);
}

.section-title {
  color: var(--color-text-muted);
  margin-bottom: 8px;
  font-size: var(--font-size-sm);
}
</style>
