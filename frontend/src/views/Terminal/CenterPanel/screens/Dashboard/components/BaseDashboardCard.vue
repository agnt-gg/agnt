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
  color: var(--color-text);
  font-weight: bold;
  font-size: var(--font-size-sm);
}

.card-content {
  padding: 12px;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: var(--font-size-sm);
  /*
   * auto, not hidden.
   *
   * A card is height-constrained by its grid row, so content that does not fit
   * has to go somewhere. `hidden` chose to make it UNREACHABLE — the run queue
   * stats ran off the right edge and were simply cut, with no way to see them.
   * `auto` shows a scrollbar only in exactly that failure case, so nothing is
   * ever silently truncated. It cannot regress anything `hidden` allowed:
   * both clip escaping children identically, and cards whose inner lists
   * already scroll (AgentsSwarm, GoalsMap) never overflow this box at all.
   */
  overflow: auto;
}

.section-title {
  color: var(--color-text-muted);
  margin-bottom: 8px;
  font-size: var(--font-size-sm);
}
</style>
