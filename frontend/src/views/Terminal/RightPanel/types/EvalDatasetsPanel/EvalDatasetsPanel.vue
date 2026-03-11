<template>
  <div class="ui-panel eval-datasets-panel">
    <!-- Selected Dataset Details -->
    <div v-if="selectedDataset" class="panel-section selected-dataset-section">
      <div class="selected-header">
        <h2>Dataset Details</h2>
        <span class="source-badge">{{ selectedDataset.source }}</span>
      </div>

      <div class="selected-content">
        <div class="dataset-details">
          <div class="detail-row main-detail">
            <span class="label"><i class="fas fa-database"></i> Name:</span>
            <span class="value name">{{ selectedDataset.name }}</span>
          </div>
          <div class="detail-row">
            <span class="label"><i class="fas fa-tag"></i> Category:</span>
            <span class="value">{{ selectedDataset.category || '-' }}</span>
          </div>
          <div class="detail-row">
            <span class="label"><i class="fas fa-list"></i> Items:</span>
            <span class="value">{{ itemCount }}</span>
          </div>
          <div class="detail-row">
            <span class="label"><i class="fas fa-code-branch"></i> Source:</span>
            <span class="value">{{ selectedDataset.source }}</span>
          </div>
        </div>

        <div class="splits-section">
          <h3>Data Split</h3>
          <div class="split-details">
            <div class="detail-row">
              <span class="label"><span class="dot train"></span> Train:</span>
              <span class="value">{{ trainCount }}</span>
            </div>
            <div class="detail-row">
              <span class="label"><span class="dot val"></span> Validation:</span>
              <span class="value">{{ valCount }}</span>
            </div>
            <div class="detail-row">
              <span class="label"><span class="dot holdout"></span> Holdout:</span>
              <span class="value">{{ holdoutCount }}</span>
            </div>
          </div>
        </div>

        <div class="dataset-actions">
          <BaseButton
            @click="$emit('panel-action', 'delete-dataset', selectedDataset)"
            variant="danger"
            full-width
          >
            <i class="fas fa-trash"></i>
            Delete Dataset
          </BaseButton>
        </div>
      </div>
    </div>

    <!-- Placeholder when no dataset selected -->
    <div v-else class="panel-section placeholder-section">
      <p>Select a dataset to view details.</p>
    </div>

    <!-- Resources Section -->
    <ResourcesSection />
  </div>
</template>

<script>
import { computed } from 'vue';
import BaseButton from '@/views/Terminal/_components/BaseButton.vue';
import ResourcesSection from '@/views/_components/common/ResourcesSection.vue';

export default {
  name: 'EvalDatasetsPanel',
  components: { BaseButton, ResourcesSection },
  props: {
    selectedDataset: {
      type: Object,
      default: null,
    },
  },
  emits: ['panel-action'],
  setup(props) {
    const items = computed(() => {
      const i = props.selectedDataset?.items;
      if (Array.isArray(i)) return i;
      try { return JSON.parse(i || '[]'); } catch { return []; }
    });
    const sc = computed(() => {
      const s = props.selectedDataset?.split_config;
      if (typeof s === 'object' && s) return s;
      try { return JSON.parse(s || '{}'); } catch { return {}; }
    });
    const ic = computed(() => items.value.length);

    return {
      itemCount: ic,
      trainCount: computed(() => Math.floor(ic.value * (sc.value.trainRatio || 0.6))),
      valCount: computed(() => Math.floor(ic.value * (sc.value.valRatio || 0.2))),
      holdoutCount: computed(() => ic.value - Math.floor(ic.value * (sc.value.trainRatio || 0.6)) - Math.floor(ic.value * (sc.value.valRatio || 0.2))),
    };
  },
};
</script>

<style scoped>
.eval-datasets-panel {
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

.source-badge {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.75em;
  background: rgba(var(--primary-rgb), 0.1);
  color: var(--color-primary);
  text-transform: capitalize;
}

.selected-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.dataset-details {
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
  text-wrap-mode: nowrap;
}

.main-detail {
  margin-bottom: 5px;
}

.splits-section {
  border-top: 1px dashed rgba(var(--primary-rgb), 0.2);
  padding-top: 12px;
}

.splits-section h3 {
  color: var(--color-grey);
  font-size: 0.8em;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin: 0 0 8px 0;
}

.split-details {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}

.dot.train {
  background: var(--color-primary);
}

.dot.val {
  background: #3b82f6;
}

.dot.holdout {
  background: #f59e0b;
}

.dataset-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-top: 1px dashed rgba(var(--primary-rgb), 0.2);
  padding-top: 12px;
}

.placeholder-section {
  text-align: center;
  color: var(--color-text);
  padding: 30px 15px;
  border: 1px dashed var(--terminal-border-color-light);
  background: var(--color-darker-0);
  border-radius: 4px;
  display: flex;
  flex-direction: column;
  height: fit-content;
}

.placeholder-section p {
  font-style: italic;
  margin: 0 0 16px 0;
  padding: 0;
}
</style>
