<template>
  <div class="widget-forge-right-panel">
    <!-- Widget config summary -->
    <div class="config-section">
      <div class="section-header">
        <i class="fas fa-sliders-h"></i>
        <span>Widget Config</span>
      </div>

      <div class="config-list">
        <div class="config-item">
          <span class="config-label">Type</span>
          <span class="config-value">{{ widgetType }}</span>
        </div>
        <div class="config-item">
          <span class="config-label">Category</span>
          <span class="config-value">{{ widgetCategory }}</span>
        </div>
        <div class="config-item">
          <span class="config-label">Default Size</span>
          <span class="config-value">{{ widgetSize }}</span>
        </div>
      </div>
    </div>

    <!-- Security info -->
    <div class="info-section">
      <div class="section-header">
        <i class="fas fa-shield-alt"></i>
        <span>Security</span>
      </div>
      <div class="info-list">
        <div class="info-item">
          <i class="fas fa-lock"></i>
          <span>HTML widgets run in sandboxed iframes</span>
        </div>
        <div class="info-item">
          <i class="fas fa-ban"></i>
          <span>No direct access to app data</span>
        </div>
        <div class="info-item">
          <i class="fas fa-check-circle"></i>
          <span>Templates are pre-verified safe</span>
        </div>
      </div>
    </div>

    <!-- Keyboard shortcuts -->
    <div class="info-section">
      <div class="section-header">
        <i class="fas fa-keyboard"></i>
        <span>Tips</span>
      </div>
      <div class="info-list">
        <div class="info-item">
          <i class="fas fa-lightbulb"></i>
          <span>Start with a template, then customize</span>
        </div>
        <div class="info-item">
          <i class="fas fa-eye"></i>
          <span>Preview auto-refreshes after 500ms</span>
        </div>
        <div class="info-item">
          <i class="fas fa-file-export"></i>
          <span>Export widgets as .agnt-widget.json</span>
        </div>
      </div>
    </div>

    <!-- Resources Section -->
    <ResourcesSection />
  </div>
</template>

<script>
import { computed } from 'vue';
import { useStore } from 'vuex';
import ResourcesSection from '@/views/_components/common/ResourcesSection.vue';

export default {
  name: 'WidgetForgePanel',
  components: { ResourcesSection },
  emits: ['panel-action'],
  setup() {
    const store = useStore();

    const activeDefinition = computed(() => store.getters['widgetDefinitions/activeDefinition']);

    const widgetType = computed(() => {
      if (activeDefinition.value) return activeDefinition.value.widget_type || 'html';
      return 'html';
    });

    const widgetCategory = computed(() => {
      if (activeDefinition.value) return activeDefinition.value.category || 'custom';
      return 'custom';
    });

    const widgetSize = computed(() => {
      const def = activeDefinition.value;
      if (def?.default_size) return `${def.default_size.cols}×${def.default_size.rows}`;
      return '4×3';
    });

    return { widgetType, widgetCategory, widgetSize };
  },
};
</script>

<style scoped>
.widget-forge-right-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
  background: var(--color-background-soft);
  color: var(--color-text);
  min-height: 0;
}

.config-section,
.info-section {
  padding: 12px;
  border: 1px solid var(--terminal-border-color-light);
  background: var(--color-darker-0);
  border-radius: 4px;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--terminal-border-color-light);
  margin-bottom: 10px;
  font-size: 11px;
  letter-spacing: 1px;
  text-transform: uppercase;
  color: var(--color-green);
  font-weight: 600;
}

.section-header i {
  font-size: 11px;
}

.config-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.config-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.config-label {
  font-size: 10px;
  letter-spacing: 1px;
  text-transform: uppercase;
  color: var(--color-text-muted, #556);
}

.config-value {
  font-size: 12px;
  color: var(--color-light-0, #aab);
  text-transform: capitalize;
}

.info-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.info-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 10px;
  color: var(--color-text-muted, #556);
  line-height: 1.4;
}

.info-item i {
  width: 14px;
  text-align: center;
  font-size: 10px;
  color: var(--color-green);
  margin-top: 1px;
  opacity: 0.5;
}
</style>
