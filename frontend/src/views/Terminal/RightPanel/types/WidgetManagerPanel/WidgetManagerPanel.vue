<template>
  <div class="ui-panel widgets-panel">
    <!-- Selected Widget Details -->
    <div v-if="selectedWidget" class="panel-section selected-widget-section">
      <div class="selected-widget-header">
        <h2>Selected Widget Details</h2>
      </div>
      <div class="selected-widget-content">
        <div class="widget-details">
          <div class="detail-row main-detail">
            <span class="label"><i :class="selectedWidget.icon || 'fas fa-puzzle-piece'"></i> Name:</span>
            <span class="value name">{{ selectedWidget.name }}</span>
          </div>
          <div class="detail-row">
            <span class="label"><i class="fas fa-info-circle"></i> Desc:</span>
            <span class="value description">{{ selectedWidget.description || 'N/A' }}</span>
          </div>
          <div class="detail-row">
            <span class="label"><i class="fas fa-tag"></i> Type:</span>
            <span class="value">{{ selectedWidget.widget_type || 'built-in' }}</span>
          </div>
          <div class="detail-row">
            <span class="label"><i class="fas fa-folder"></i> Category:</span>
            <span class="value">{{ selectedWidget.category }}</span>
          </div>
          <div class="detail-row">
            <span class="label"><i class="fas fa-expand-arrows-alt"></i> Size:</span>
            <span class="value">{{ formatSize(selectedWidget) }}</span>
          </div>
          <div v-if="selectedWidget.version" class="detail-row">
            <span class="label"><i class="fas fa-code-branch"></i> Version:</span>
            <span class="value">{{ selectedWidget.version }}</span>
          </div>
        </div>

        <div v-if="selectedWidget._isCustom" class="widget-actions">
          <BaseButton variant="primary" @click="$emit('panel-action', 'edit-widget', selectedWidget)">
            <i class="fas fa-pen"></i> Edit Widget
          </BaseButton>
          <BaseButton variant="secondary" @click="$emit('panel-action', 'duplicate-widget', selectedWidget)">
            <i class="fas fa-copy"></i> Duplicate
          </BaseButton>
          <BaseButton variant="secondary" @click="$emit('panel-action', 'export-widget', selectedWidget)">
            <i class="fas fa-file-export"></i> Export
          </BaseButton>
          <BaseButton variant="danger" @click="$emit('panel-action', 'delete-widget', selectedWidget)">
            <i class="fas fa-trash"></i> Delete
          </BaseButton>
        </div>
      </div>
    </div>

    <!-- Placeholder when no widget selected -->
    <div v-else class="panel-section placeholder-section">
      <p>Select a widget to view details.</p>
      <BaseButton variant="primary" class="create-widget-button" @click="$emit('panel-action', 'navigate', 'WidgetForgeScreen')">
        <i class="fas fa-plus"></i>
        Create New Widget
      </BaseButton>
    </div>

    <!-- Resources Section -->
    <ResourcesSection />
  </div>
</template>

<script>
import ResourcesSection from '@/views/_components/common/ResourcesSection.vue';
import BaseButton from '@/views/Terminal/_components/BaseButton.vue';

export default {
  name: 'WidgetManagerPanel',
  components: { ResourcesSection, BaseButton },
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
.ui-panel.widgets-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
  background: var(--color-background-soft);
  color: var(--color-text);
  min-height: 0;
}

/* Common Section Styling */
.panel-section {
  border-radius: 0px;
  padding: 15px;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color-light);
}

.panel-section h2 {
  color: var(--color-primary);
  font-size: 1.1em;
  margin: 0 0 15px 0;
  border-bottom: 1px solid rgba(var(--primary-rgb), 0.1);
  padding-bottom: 8px;
}

.widget-details {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.detail-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.95em;
}

.detail-row .label {
  color: var(--color-white);
  display: flex;
  align-items: center;
  gap: 10px;
}

.detail-row .label i {
  width: 14px;
  text-align: center;
  color: var(--color-primary);
}

.detail-row .value {
  color: var(--color-primary);
  text-align: right;
}

.detail-row .value.name {
  font-weight: bold;
}

.detail-row .value.description {
  color: var(--color-text);
  max-width: 60%;
  text-align: right;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.widget-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 10px;
  border-top: 1px dashed rgba(var(--primary-rgb), 0.2);
  padding-top: 15px;
}

.placeholder-section {
  text-align: center;
  color: var(--color-text);
  padding: 30px 15px;
  border: 1px dashed var(--terminal-border-color-light);
  font-style: italic;
  border-radius: 4px;
  display: flex;
  flex-direction: column;
  height: fit-content;
}

.placeholder-section p {
  margin: 0 0 16px 0;
}

.create-widget-button {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
</style>
