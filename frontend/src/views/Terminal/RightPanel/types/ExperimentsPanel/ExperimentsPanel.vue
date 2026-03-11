<template>
  <div class="ui-panel experiments-panel">
    <!-- Selected Experiment Details -->
    <div v-if="selectedExperiment" class="panel-section selected-experiment-section">
      <div class="selected-header">
        <h2>Experiment Details</h2>
        <span class="status-badge" :class="selectedExperiment.status">{{ selectedExperiment.status }}</span>
      </div>

      <div class="selected-content">
        <div class="experiment-details">
          <div class="detail-row main-detail">
            <span class="label"><i class="fas fa-flask"></i> Name:</span>
            <span class="value name">{{ selectedExperiment.name }}</span>
          </div>
          <div class="detail-row">
            <span class="label"><i class="fas fa-tag"></i> Type:</span>
            <span class="value">{{ selectedExperiment.type }}</span>
          </div>
          <div class="detail-row">
            <span class="label"><i class="fas fa-cog"></i> Max Iterations:</span>
            <span class="value">{{ selectedExperiment.config?.maxIterations || 3 }}</span>
          </div>
        </div>

        <div v-if="selectedExperiment.hypothesis" class="hypothesis-section">
          <h3>Hypothesis</h3>
          <p class="hypothesis-text">"{{ selectedExperiment.hypothesis }}"</p>
        </div>

        <div v-if="selectedExperiment.result" class="results-section">
          <h3>Results</h3>
          <div class="result-details">
            <div class="detail-row">
              <span class="label"><i class="fas fa-gavel"></i> Decision:</span>
              <span class="value decision" :class="selectedExperiment.result.decision">{{ selectedExperiment.result.decision }}</span>
            </div>
            <div class="detail-row">
              <span class="label"><i class="fas fa-chart-line"></i> Delta:</span>
              <span class="value" :class="(selectedExperiment.result.delta || 0) >= 0 ? 'pos' : 'neg'">
                {{ (selectedExperiment.result.delta || 0) >= 0 ? '+' : '' }}{{ (selectedExperiment.result.delta || 0).toFixed(3) }}
              </span>
            </div>
          </div>
        </div>

        <div class="experiment-actions">
          <BaseButton
            v-if="selectedExperiment.status === 'planned'"
            @click="$emit('panel-action', 'run-experiment', selectedExperiment)"
            variant="primary"
            full-width
          >
            <i class="fas fa-play"></i>
            Run Experiment
          </BaseButton>
          <BaseButton
            @click="$emit('panel-action', 'delete-experiment', selectedExperiment)"
            variant="danger"
            full-width
          >
            <i class="fas fa-trash"></i>
            Delete Experiment
          </BaseButton>
        </div>
      </div>
    </div>

    <!-- Placeholder when no experiment selected -->
    <div v-else class="panel-section placeholder-section">
      <p>Select an experiment to view details.</p>
      <BaseButton variant="primary" class="create-button" @click="$emit('panel-action', 'navigate', 'ExperimentForgeScreen')">
        <i class="fas fa-plus"></i>
        Create Experiment
      </BaseButton>
    </div>

    <!-- Resources Section -->
    <ResourcesSection />
  </div>
</template>

<script>
import BaseButton from '@/views/Terminal/_components/BaseButton.vue';
import ResourcesSection from '@/views/_components/common/ResourcesSection.vue';

export default {
  name: 'ExperimentsPanel',
  components: { BaseButton, ResourcesSection },
  props: {
    selectedExperiment: {
      type: Object,
      default: null,
    },
  },
  emits: ['panel-action'],
};
</script>

<style scoped>
.experiments-panel {
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

.status-badge {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.75em;
  font-weight: 500;
  text-transform: capitalize;
}

.status-badge.planned {
  background: rgba(150, 150, 150, 0.15);
  color: #999;
}

.status-badge.running {
  background: rgba(59, 130, 246, 0.15);
  color: #3b82f6;
}

.status-badge.completed {
  background: rgba(var(--primary-rgb), 0.15);
  color: var(--color-primary);
}

.status-badge.failed {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}

.selected-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.experiment-details {
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

.hypothesis-section {
  border-top: 1px dashed rgba(var(--primary-rgb), 0.2);
  padding-top: 12px;
}

.hypothesis-section h3 {
  color: var(--color-grey);
  font-size: 0.8em;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin: 0 0 8px 0;
}

.hypothesis-text {
  margin: 0;
  font-style: italic;
  color: var(--color-text);
  font-size: 0.9em;
  line-height: 1.5;
}

.results-section {
  border-top: 1px dashed rgba(var(--primary-rgb), 0.2);
  padding-top: 12px;
}

.results-section h3 {
  color: var(--color-grey);
  font-size: 0.8em;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin: 0 0 8px 0;
}

.result-details {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.decision {
  font-weight: 600;
  text-transform: uppercase;
}

.decision.keep {
  color: var(--color-primary) !important;
}

.decision.discard {
  color: #ef4444 !important;
}

.decision.iterate {
  color: #f59e0b !important;
}

.pos {
  color: var(--color-primary) !important;
}

.neg {
  color: #ef4444 !important;
}

.experiment-actions {
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

.create-button {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
</style>
