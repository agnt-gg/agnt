<template>
  <div class="ui-panel experiment-forge-panel">
    <!-- Live Preview Section -->
    <div class="panel-section preview-section">
      <div class="selected-header">
        <h2>Live Preview</h2>
      </div>

      <div class="preview-content">
        <div class="detail-row main-detail">
          <span class="label"><i class="fas fa-running"></i> Estimated Runs:</span>
          <span class="value name">{{ estimated }} total</span>
        </div>
        <div class="detail-row">
          <span class="label"><i class="fas fa-info-circle"></i> Breakdown:</span>
          <span class="value">~15 examples x 2 variants</span>
        </div>
      </div>
    </div>

    <!-- Config Summary Section -->
    <div class="panel-section config-section">
      <div class="selected-header">
        <h2>Config Summary</h2>
      </div>

      <div class="config-content">
        <div class="detail-row">
          <span class="label"><i class="fas fa-redo"></i> Max Iterations:</span>
          <span class="value">{{ form?.config?.maxIterations || 3 }}</span>
        </div>
        <div class="detail-row">
          <span class="label"><i class="fas fa-chart-line"></i> Min Delta:</span>
          <span class="value">{{ form?.config?.minDelta || 0.05 }}</span>
        </div>
      </div>
    </div>

    <!-- Resources Section -->
    <ResourcesSection />
  </div>
</template>

<script>
import { computed } from 'vue';
import ResourcesSection from '@/views/_components/common/ResourcesSection.vue';

export default {
  name: 'ExperimentForgePanel',
  components: { ResourcesSection },
  props: {
    form: {
      type: Object,
      default: () => ({}),
    },
  },
  emits: ['panel-action'],
  setup(props) {
    return {
      estimated: computed(() => 15 * 2 * (props.form?.config?.runsPerExample || 1)),
    };
  },
};
</script>

<style scoped>
.experiment-forge-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
  overflow-y: auto;
  min-height: 0;
}

.panel-section {
  border-radius: 0px;
  padding: 15px;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color-light);
}

.panel-section h2 {
  color: var(--color-primary);
  font-size: 1.1em;
  margin: 0;
}

.selected-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 15px;
  border-bottom: 1px solid rgba(var(--primary-rgb), 0.1);
  padding-bottom: 8px;
}

.selected-header h2 {
  margin: 0;
  padding: 0;
  border: none;
}

.preview-content,
.config-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.detail-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.95em;
}

.detail-row .label {
  color: var(--color-text-muted);
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
  color: var(--color-text);
  font-size: 1.1em;
}

.main-detail {
  margin-bottom: 5px;
}
</style>
