<template>
  <div class="widget-right-panel">
    <div v-if="selectedWidget" class="widget-details">
      <div class="widget-header">
        <div class="widget-icon-large">
          <i :class="selectedWidget.icon || 'fas fa-puzzle-piece'"></i>
        </div>
        <div class="widget-header-info">
          <h2 class="widget-title">{{ selectedWidget.name }}</h2>
          <div class="widget-type-badge">{{ selectedWidget.widget_type || 'built-in' }}</div>
        </div>
      </div>

      <div class="widget-description">
        {{ selectedWidget.description || 'No description available' }}
      </div>

      <div class="widget-meta">
        <div class="meta-item">
          <span class="meta-label">Category</span>
          <span class="meta-value">{{ selectedWidget.category }}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Size</span>
          <span class="meta-value">{{ formatSize(selectedWidget) }}</span>
        </div>
        <div v-if="selectedWidget.version" class="meta-item">
          <span class="meta-label">Version</span>
          <span class="meta-value">{{ selectedWidget.version }}</span>
        </div>
      </div>

      <div v-if="selectedWidget._isCustom" class="widget-actions">
        <button class="action-btn primary-btn" @click="$emit('panel-action', 'edit-widget', selectedWidget)">
          <i class="fas fa-pen"></i> Edit Widget
        </button>
        <button class="action-btn" @click="$emit('panel-action', 'duplicate-widget', selectedWidget)">
          <i class="fas fa-copy"></i> Duplicate
        </button>
        <button class="action-btn" @click="$emit('panel-action', 'export-widget', selectedWidget)">
          <i class="fas fa-file-export"></i> Export
        </button>
        <button class="action-btn danger-btn" @click="$emit('panel-action', 'delete-widget', selectedWidget)">
          <i class="fas fa-trash"></i> Delete
        </button>
      </div>
    </div>

    <div v-else class="no-widget-selected">
      <div class="empty-icon"><i class="fas fa-puzzle-piece"></i></div>
      <p>Select a widget to view details</p>
      <button class="action-btn primary-btn" @click="$emit('panel-action', 'navigate', 'WidgetForgeScreen')">
        <i class="fas fa-plus"></i> Create New Widget
      </button>
    </div>

    <!-- Resources Section -->
    <ResourcesSection />
  </div>
</template>

<script>
import ResourcesSection from '@/views/_components/common/ResourcesSection.vue';

export default {
  name: 'WidgetManagerPanel',
  components: { ResourcesSection },
  props: {
    selectedWidget: {
      type: Object,
      default: null,
    },
  },
  emits: ['panel-action'],
  setup() {
    function formatSize(widget) {
      const size = widget.defaultSize || widget.default_size;
      if (!size) return '—';
      return `${size.cols}×${size.rows}`;
    }

    return { formatSize };
  },
};
</script>

<style scoped>
.widget-right-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
  background: var(--color-background-soft);
  color: var(--color-text);
  min-height: 0;
}

.widget-details {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 15px;
  border: 1px solid var(--terminal-border-color-light);
  background: var(--color-darker-0);
  border-radius: 4px;
}

.widget-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--terminal-border-color-light);
}

.widget-icon-large {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: rgba(var(--green-rgb), 0.08);
  color: var(--color-green);
  font-size: 16px;
}

.widget-header-info {
  flex: 1;
}

.widget-title {
  color: var(--color-green);
  font-size: 1.1em;
  margin: 0 0 2px 0;
}

.widget-type-badge {
  font-size: 9px;
  letter-spacing: 1px;
  text-transform: uppercase;
  color: var(--color-text-muted, #556);
}

.widget-description {
  color: var(--color-text);
  font-size: 0.9em;
  line-height: 1.4;
}

.widget-meta {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.02);
  border-radius: 4px;
  border: 1px solid var(--terminal-border-color-light);
}

.meta-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.meta-label {
  font-size: 10px;
  letter-spacing: 1px;
  text-transform: uppercase;
  color: var(--color-text-muted, #556);
}

.meta-value {
  font-size: 12px;
  color: var(--color-light-0, #aab);
}

.widget-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
  border-top: 1px dashed var(--terminal-border-color-light);
  padding-top: 12px;
}

.action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 6px;
  background: none;
  color: var(--color-text-muted, #667);
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.12s;
  letter-spacing: 0.5px;
}

.action-btn:hover {
  color: var(--color-light-0, #aab);
  border-color: rgba(255, 255, 255, 0.1);
}

.action-btn.primary-btn {
  color: var(--color-green);
  border-color: rgba(var(--green-rgb), 0.2);
  background: rgba(var(--green-rgb), 0.04);
}

.action-btn.primary-btn:hover {
  background: rgba(var(--green-rgb), 0.1);
  border-color: rgba(var(--green-rgb), 0.3);
}

.action-btn.danger-btn:hover {
  color: var(--color-red);
  border-color: rgba(var(--red-rgb), 0.2);
  background: rgba(var(--red-rgb), 0.04);
}

.no-widget-selected {
  text-align: center;
  color: var(--color-text);
  padding: 30px 15px;
  border: 1px dashed var(--terminal-border-color-light);
  background: var(--color-darker-0);
  border-radius: 4px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.empty-icon {
  font-size: 28px;
  color: var(--color-text-muted, #334);
  opacity: 0.3;
}

.no-widget-selected p {
  font-style: italic;
  margin: 0;
  color: var(--color-text-muted, #556);
  font-size: 12px;
}
</style>
