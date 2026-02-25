<template>
  <div class="lf-root">
    <div class="lf-header" v-if="feedTitle">
      <span class="lf-title">{{ feedTitle }}</span>
      <span class="lf-badge">{{ items.length }}</span>
    </div>
    <div class="lf-list">
      <div v-for="(item, index) in items" :key="index" class="lf-item">
        <div class="lf-dot" :style="{ background: item.color || dotColor(index) }"></div>
        <div class="lf-content">
          <div class="lf-text">{{ item.text || item.label || item }}</div>
          <div class="lf-meta" v-if="item.time || item.meta">{{ item.time || item.meta }}</div>
        </div>
      </div>
      <div v-if="items.length === 0" class="lf-empty">
        <i class="fas fa-rss"></i>
        <span>No items</span>
      </div>
    </div>
  </div>
</template>

<script>
import { computed } from 'vue';

const COLORS = ['#19ef83', '#12e0ff', '#e53d8f', '#ffd700', '#7d3de5', '#ff9500'];

export default {
  name: 'LiveFeedTemplate',
  props: {
    config: { type: Object, default: () => ({}) },
    definition: { type: Object, default: () => ({}) },
  },
  setup(props) {
    const feedTitle = computed(() => props.config.title || '');

    const items = computed(() => {
      const data = props.config.items || props.config.data || [];
      const max = props.config.max_items || 50;
      return Array.isArray(data) ? data.slice(0, max) : [];
    });

    function dotColor(index) {
      return COLORS[index % COLORS.length];
    }

    return { feedTitle, items, dotColor };
  },
};
</script>

<style scoped>
.lf-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  gap: 4px;
}

.lf-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px 4px;
  flex-shrink: 0;
}

.lf-title {
  font-size: 11px;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: var(--color-green);
  font-weight: 600;
}

.lf-badge {
  font-size: 9px;
  padding: 1px 6px;
  border-radius: 8px;
  background: rgba(var(--green-rgb), 0.1);
  color: var(--color-green);
}

.lf-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 12px 8px;
}

.lf-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 5px 0;
  border-bottom: 1px solid rgba(255,255,255,0.02);
}

.lf-item:last-child {
  border-bottom: none;
}

.lf-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  margin-top: 4px;
  flex-shrink: 0;
}

.lf-content {
  flex: 1;
  min-width: 0;
}

.lf-text {
  font-size: 11px;
  color: var(--color-light-0, #aab);
  line-height: 1.3;
}

.lf-meta {
  font-size: 9px;
  color: var(--color-text-muted, #445);
  margin-top: 1px;
}

.lf-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px;
  color: var(--color-text-muted, #334);
  font-size: 11px;
}
</style>
