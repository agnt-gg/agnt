<template>
  <!-- The left panel of a collection screen (Agents, Workflows, Tools, Skills):
       what you have at a glance, and the few items you most likely want next.
       Filtering lives in the centre's search; this panel never filters. -->
  <div class="collection-stats-panel">
    <div class="panel-header">
      <h2 class="title">/ {{ title }}</h2>
    </div>

    <div class="stat-grid">
      <div v-for="stat in stats" :key="stat.label" class="stat-tile" :class="stat.tone ? 'tone-' + stat.tone : ''">
        <span class="stat-value">{{ stat.value }}</span>
        <span class="stat-label">{{ stat.label }}</span>
      </div>
    </div>

    <section v-for="list in lists" :key="list.title" class="stat-list">
      <h4>{{ list.title }}</h4>
      <p v-if="!list.items.length" class="stat-empty">{{ list.empty || 'Nothing yet.' }}</p>
      <button
        v-for="item in list.items"
        :key="item.id"
        type="button"
        class="stat-row"
        @click="$emit('panel-action', 'select-item', { id: item.id })"
      >
        <i :class="item.icon || icon" aria-hidden="true"></i>
        <span class="stat-row-label">{{ item.label }}</span>
        <span v-if="item.meta" class="stat-row-meta">{{ item.meta }}</span>
      </button>
    </section>
  </div>
</template>

<script>
export default {
  name: 'CollectionStatsPanel',
  props: {
    title: { type: String, required: true },
    icon: { type: String, default: 'fas fa-circle' },
    /** [{ label, value, tone?: 'good' | 'warn' | 'bad' }] */
    stats: { type: Array, default: () => [] },
    /** [{ title, empty?, items: [{ id, label, meta?, icon? }] }] */
    lists: { type: Array, default: () => [] },
  },
  emits: ['panel-action'],
};
</script>

<style scoped>
.collection-stats-panel {
  display: flex;
  flex-direction: column;
  gap: 18px;
  height: 100%;
  overflow-y: auto;
  scrollbar-width: none;
}

.panel-header {
  padding: 0 0 12px;
  border-bottom: 1px solid var(--terminal-border-color-light);
  user-select: none;
}

.panel-header .title {
  color: var(--color-primary);
  font-family: var(--font-family-primary);
  font-size: 16px;
  font-weight: 400;
  letter-spacing: 0.48px;
  margin: 0;
}

.stat-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.stat-tile {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 12px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 10px;
  background: rgba(var(--primary-rgb), 0.03);
}

.stat-value {
  font-size: 22px;
  line-height: 1.1;
  color: var(--color-text);
  font-variant-numeric: tabular-nums;
}

.stat-label {
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.tone-good .stat-value {
  color: var(--text-green);
}
.tone-warn .stat-value {
  color: var(--text-yellow);
}
.tone-bad .stat-value {
  color: var(--color-red);
}

.stat-list h4 {
  margin: 0 0 6px;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.stat-empty {
  margin: 0;
  font-size: 12px;
  color: var(--color-text-muted);
}

.stat-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 7px 8px;
  border: 0;
  border-radius: 7px;
  background: none;
  color: var(--color-text);
  font: inherit;
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
}

.stat-row:hover,
.stat-row:focus-visible {
  background: rgba(var(--primary-rgb), 0.08);
  outline: none;
}

.stat-row i {
  width: 14px;
  color: var(--color-text-muted);
  font-size: 11px;
}

.stat-row-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stat-row-meta {
  flex-shrink: 0;
  font-size: 10.5px;
  color: var(--color-text-muted);
}
</style>
