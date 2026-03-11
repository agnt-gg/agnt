<template>
  <div class="ui-panel experiments-panel">
    <!-- ═══ EXPERIMENT DETAILS ═══ -->
    <template v-if="selectedExperiment && !selectedDataset">
      <div class="panel-section">
        <div class="selected-header">
          <h2>{{ selectedExperiment.name }}</h2>
          <span class="status-badge" :class="selectedExperiment.status">{{ selectedExperiment.status }}</span>
        </div>

        <!-- Core Info -->
        <div class="detail-grid">
          <div class="detail-item">
            <span class="detail-label">Type</span>
            <span class="detail-value">{{ selectedExperiment.type || 'ab_test' }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Skill</span>
            <span class="detail-value">{{ selectedExperiment.skill_name || selectedExperiment.skillId || '-' }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Iterations</span>
            <span class="detail-value">{{ selectedExperiment.config?.maxIterations || '-' }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Runs/Example</span>
            <span class="detail-value">{{ selectedExperiment.config?.runsPerExample || '-' }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Min Delta</span>
            <span class="detail-value">{{ selectedExperiment.config?.minDelta || '-' }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Created</span>
            <span class="detail-value">{{ formatDate(selectedExperiment.created_at) }}</span>
          </div>
        </div>

        <!-- Hypothesis -->
        <div v-if="selectedExperiment.hypothesis" class="sub-section">
          <h3><i class="fas fa-lightbulb"></i> Hypothesis</h3>
          <p class="hypothesis-text">"{{ selectedExperiment.hypothesis }}"</p>
        </div>

        <!-- Results (completed experiments) -->
        <div v-if="selectedExperiment.result" class="sub-section">
          <h3><i class="fas fa-chart-bar"></i> Results</h3>
          <div class="result-stats">
            <div class="result-stat">
              <span class="result-label">Decision</span>
              <span class="result-value decision" :class="selectedExperiment.result.decision">{{ selectedExperiment.result.decision || 'pending' }}</span>
            </div>
            <div class="result-stat">
              <span class="result-label">Delta</span>
              <span class="result-value" :class="deltaClass(selectedExperiment.result.delta)">
                {{ formatDelta(selectedExperiment.result.delta) }}
              </span>
            </div>
            <div v-if="selectedExperiment.result.baseline_score != null" class="result-stat">
              <span class="result-label">Baseline</span>
              <span class="result-value">{{ selectedExperiment.result.baseline_score?.toFixed(3) }}</span>
            </div>
            <div v-if="selectedExperiment.result.treatment_score != null" class="result-stat">
              <span class="result-label">Treatment</span>
              <span class="result-value">{{ selectedExperiment.result.treatment_score?.toFixed(3) }}</span>
            </div>
          </div>

          <!-- Per-dimension breakdown -->
          <div v-if="dimensions.length > 0" class="dimension-breakdown">
            <h4>Dimensions</h4>
            <div v-for="dim in dimensions" :key="dim.name" class="dim-row">
              <span class="dim-name">{{ dim.name }}</span>
              <div class="dim-bar-container">
                <div class="dim-bar baseline" :style="{ width: (dim.baseline * 100) + '%' }"></div>
                <div class="dim-bar treatment" :style="{ width: (dim.mutated * 100) + '%' }"></div>
              </div>
              <span class="dim-delta" :class="dim.delta > 0 ? 'pos' : dim.delta < 0 ? 'neg' : ''">
                {{ dim.delta > 0 ? '+' : '' }}{{ dim.delta.toFixed(3) }}
              </span>
            </div>
            <div class="dim-legend">
              <span class="legend-item"><span class="legend-dot baseline"></span> Baseline</span>
              <span class="legend-item"><span class="legend-dot treatment"></span> Treatment</span>
            </div>
          </div>
        </div>

        <!-- Run history -->
        <div v-if="experimentRuns.length > 0" class="sub-section">
          <h3><i class="fas fa-list"></i> Runs ({{ experimentRuns.length }})</h3>
          <div class="runs-list">
            <div v-for="(run, idx) in experimentRuns" :key="run.id || idx" class="run-item">
              <span class="run-num">#{{ idx + 1 }}</span>
              <span class="run-variant" :class="run.variant">{{ run.variant }}</span>
              <span class="run-score">{{ run.metrics?.composite?.toFixed(3) || run.evaluation_score?.toFixed(3) || '-' }}</span>
            </div>
          </div>
        </div>

        <!-- Constraint gates -->
        <div v-if="constraintGates.length > 0" class="sub-section">
          <h3><i class="fas fa-shield-alt"></i> Constraints</h3>
          <div class="constraints-list">
            <span v-for="gate in constraintGates" :key="gate" class="constraint-chip">{{ gate }}</span>
          </div>
        </div>

        <!-- Actions -->
        <div class="panel-actions">
          <BaseButton v-if="selectedExperiment.status === 'planned'" @click="$emit('panel-action', 'run-experiment', selectedExperiment)" variant="primary" full-width>
            <i class="fas fa-play"></i> Run Experiment
          </BaseButton>
          <BaseButton @click="$emit('panel-action', 'delete-experiment', selectedExperiment)" variant="danger" full-width>
            <i class="fas fa-trash"></i> Delete
          </BaseButton>
        </div>
      </div>
    </template>

    <!-- ═══ DATASET DETAILS ═══ -->
    <template v-else-if="selectedDataset">
      <div class="panel-section">
        <div class="selected-header">
          <h2>{{ selectedDataset.name }}</h2>
          <span class="source-badge">{{ selectedDataset.source || 'manual' }}</span>
        </div>

        <div class="detail-grid">
          <div class="detail-item">
            <span class="detail-label">Skill</span>
            <span class="detail-value">{{ selectedDataset.skill_name || '-' }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Category</span>
            <span class="detail-value">{{ selectedDataset.category || '-' }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Examples</span>
            <span class="detail-value">{{ itemCount }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Created</span>
            <span class="detail-value">{{ formatDate(selectedDataset.created_at) }}</span>
          </div>
        </div>

        <!-- Data split -->
        <div class="sub-section">
          <h3><i class="fas fa-chart-pie"></i> Data Split</h3>
          <div class="split-bar">
            <div class="split-segment train" :style="{ flex: trainCount }"><span v-if="trainCount > 0">{{ trainCount }}</span></div>
            <div class="split-segment val" :style="{ flex: valCount }"><span v-if="valCount > 0">{{ valCount }}</span></div>
            <div class="split-segment holdout" :style="{ flex: holdoutCount }"><span v-if="holdoutCount > 0">{{ holdoutCount }}</span></div>
          </div>
          <div class="split-legend">
            <span class="legend-item"><span class="legend-dot train-dot"></span> Train ({{ trainCount }})</span>
            <span class="legend-item"><span class="legend-dot val-dot"></span> Validation ({{ valCount }})</span>
            <span class="legend-item"><span class="legend-dot holdout-dot"></span> Holdout ({{ holdoutCount }})</span>
          </div>
        </div>

        <!-- Example items preview -->
        <div v-if="datasetItems.length > 0" class="sub-section">
          <h3><i class="fas fa-list-alt"></i> Examples ({{ datasetItems.length }})</h3>
          <div class="examples-list">
            <div v-for="(item, idx) in previewItems" :key="idx" class="example-item">
              <span class="example-num">#{{ idx + 1 }}</span>
              <div class="example-content">
                <div v-if="item.input" class="example-field">
                  <span class="field-label">Input</span>
                  <span class="field-value">{{ truncate(typeof item.input === 'string' ? item.input : JSON.stringify(item.input), 120) }}</span>
                </div>
                <div v-if="item.expected_output || item.expected" class="example-field">
                  <span class="field-label">Expected</span>
                  <span class="field-value">{{ truncate(typeof (item.expected_output || item.expected) === 'string' ? (item.expected_output || item.expected) : JSON.stringify(item.expected_output || item.expected), 120) }}</span>
                </div>
                <div v-if="item.split" class="example-split">
                  <span class="split-chip" :class="item.split">{{ item.split }}</span>
                </div>
              </div>
            </div>
            <div v-if="datasetItems.length > 5" class="more-items">
              + {{ datasetItems.length - 5 }} more examples
            </div>
          </div>
        </div>

        <div class="panel-actions">
          <BaseButton @click="$emit('panel-action', 'delete-dataset', selectedDataset)" variant="danger" full-width>
            <i class="fas fa-trash"></i> Delete Dataset
          </BaseButton>
        </div>
      </div>
    </template>

    <!-- ═══ PLACEHOLDER ═══ -->
    <template v-else>
      <div class="panel-section placeholder-section">
        <i class="fas fa-flask"></i>
        <p>Select an experiment or dataset to view details.</p>
      </div>
    </template>

    <ResourcesSection />
  </div>
</template>

<script>
import { computed } from 'vue';
import BaseButton from '@/views/Terminal/_components/BaseButton.vue';
import ResourcesSection from '@/views/_components/common/ResourcesSection.vue';

export default {
  name: 'ExperimentsPanel',
  components: { BaseButton, ResourcesSection },
  props: {
    selectedExperiment: { type: Object, default: null },
    selectedDataset: { type: Object, default: null },
  },
  emits: ['panel-action'],
  setup(props) {
    // Experiment helpers
    const experimentRuns = computed(() => props.selectedExperiment?.runs || []);

    const dimensions = computed(() => {
      const perDim = props.selectedExperiment?.result?.per_dimension;
      if (!perDim) return [];
      return Object.entries(perDim).map(([name, data]) => ({
        name,
        baseline: data.control ?? 0,
        mutated: data.treatment ?? 0,
        delta: data.delta ?? (data.treatment ?? 0) - (data.control ?? 0),
      }));
    });

    const constraintGates = computed(() => {
      const cfg = props.selectedExperiment?.config?.constraintGates;
      if (!cfg) return [];
      return Object.entries(cfg).filter(([, v]) => v).map(([k]) => k.replace(/([A-Z])/g, ' $1').trim());
    });

    // Dataset helpers
    const datasetItems = computed(() => {
      const i = props.selectedDataset?.items;
      if (Array.isArray(i)) return i;
      try { return JSON.parse(i || '[]'); } catch { return []; }
    });

    const splitConfig = computed(() => {
      const s = props.selectedDataset?.split_config;
      if (typeof s === 'object' && s) return s;
      try { return JSON.parse(s || '{}'); } catch { return {}; }
    });

    const itemCount = computed(() => datasetItems.value.length);
    const trainCount = computed(() => Math.floor(itemCount.value * (splitConfig.value.trainRatio || 0.6)));
    const valCount = computed(() => Math.floor(itemCount.value * (splitConfig.value.valRatio || 0.2)));
    const holdoutCount = computed(() => itemCount.value - trainCount.value - valCount.value);
    const previewItems = computed(() => datasetItems.value.slice(0, 5));

    const formatDate = (d) => {
      if (!d) return '-';
      const diff = Date.now() - new Date(d);
      if (diff < 60000) return 'just now';
      if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
      if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
      return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    };

    const formatDelta = (d) => {
      if (d == null) return '-';
      return `${d > 0 ? '+' : ''}${d.toFixed(3)}`;
    };

    const deltaClass = (d) => {
      if (d == null) return '';
      return d > 0 ? 'pos' : d < 0 ? 'neg' : '';
    };

    const truncate = (text, max) => (!text ? '' : text.length > max ? text.slice(0, max) + '...' : text);

    return {
      experimentRuns, dimensions, constraintGates,
      datasetItems, itemCount, trainCount, valCount, holdoutCount, previewItems,
      formatDate, formatDelta, deltaClass, truncate,
    };
  },
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

/* Header */
.selected-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(var(--primary-rgb), 0.1);
}
.selected-header h2 {
  margin: 0;
  color: var(--color-text);
  font-size: 1em;
  font-weight: 600;
  word-break: break-word;
  line-height: 1.3;
}
.status-badge {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.7em;
  font-weight: 500;
  text-transform: capitalize;
  white-space: nowrap;
  flex-shrink: 0;
}
.status-badge.planned { background: rgba(150,150,150,0.15); color: #999; }
.status-badge.running { background: rgba(59,130,246,0.15); color: #3b82f6; }
.status-badge.completed { background: rgba(var(--green-rgb),0.15); color: var(--color-green); }
.status-badge.failed { background: rgba(239,68,68,0.15); color: #ef4444; }
.source-badge {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.7em;
  background: rgba(var(--primary-rgb), 0.1);
  color: var(--color-primary);
  text-transform: capitalize;
  flex-shrink: 0;
}

/* Detail grid */
.detail-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-bottom: 4px;
}
.detail-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.detail-label {
  font-size: 0.65em;
  color: var(--color-grey);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.detail-value {
  font-size: 0.85em;
  color: var(--color-text);
  word-break: break-word;
}

/* Sub-sections */
.sub-section {
  border-top: 1px dashed rgba(var(--primary-rgb), 0.15);
  padding-top: 12px;
  margin-top: 12px;
}
.sub-section h3 {
  color: var(--color-grey);
  font-size: 0.75em;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin: 0 0 8px 0;
  display: flex;
  align-items: center;
  gap: 6px;
}
.sub-section h3 i {
  color: var(--color-green);
  font-size: 0.9em;
}
.sub-section h4 {
  color: var(--color-grey);
  font-size: 0.7em;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin: 10px 0 6px;
}

/* Hypothesis */
.hypothesis-text {
  margin: 0;
  font-style: italic;
  color: var(--color-grey);
  font-size: 0.85em;
  line-height: 1.4;
}

/* Results */
.result-stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.result-stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.result-label {
  font-size: 0.65em;
  color: var(--color-grey);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.result-value {
  font-size: 0.9em;
  color: var(--color-text);
  font-weight: 600;
}
.result-value.pos { color: var(--color-green); }
.result-value.neg { color: #ef4444; }
.result-value.decision { text-transform: capitalize; }
.result-value.decision.keep { color: var(--color-green); }
.result-value.decision.discard { color: #ef4444; }
.result-value.decision.iterate { color: #f59e0b; }

/* Dimension breakdown */
.dimension-breakdown {
  margin-top: 8px;
}
.dim-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
  font-size: 0.8em;
}
.dim-name {
  width: 80px;
  color: var(--color-grey);
  font-size: 0.85em;
  text-transform: capitalize;
  flex-shrink: 0;
}
.dim-bar-container {
  flex: 1;
  height: 12px;
  background: rgba(0,0,0,0.2);
  border-radius: 2px;
  position: relative;
  overflow: hidden;
}
.dim-bar {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  border-radius: 2px;
}
.dim-bar.baseline {
  background: rgba(150,150,150,0.4);
  z-index: 1;
}
.dim-bar.treatment {
  background: rgba(var(--green-rgb), 0.6);
  z-index: 2;
}
.dim-delta {
  width: 50px;
  text-align: right;
  font-weight: 500;
  font-size: 0.85em;
  flex-shrink: 0;
}
.dim-delta.pos { color: var(--color-green); }
.dim-delta.neg { color: #ef4444; }
.dim-legend, .split-legend {
  display: flex;
  gap: 12px;
  margin-top: 6px;
}
.legend-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.7em;
  color: var(--color-grey);
}
.legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 2px;
}
.legend-dot.baseline { background: rgba(150,150,150,0.5); }
.legend-dot.treatment { background: rgba(var(--green-rgb), 0.6); }

/* Runs */
.runs-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
  max-height: 200px;
  overflow-y: auto;
}
.run-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  background: rgba(0,0,0,0.1);
  border-radius: 3px;
  font-size: 0.8em;
}
.run-num {
  color: var(--color-grey);
  font-size: 0.85em;
  min-width: 24px;
}
.run-variant {
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 0.75em;
  font-weight: 500;
}
.run-variant.baseline, .run-variant.control {
  background: rgba(150,150,150,0.15);
  color: #999;
}
.run-variant.mutated, .run-variant.treatment {
  background: rgba(var(--green-rgb), 0.15);
  color: var(--color-green);
}
.run-score {
  margin-left: auto;
  font-weight: 500;
  color: var(--color-text);
  font-family: monospace;
}

/* Constraints */
.constraints-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.constraint-chip {
  padding: 2px 8px;
  border-radius: 3px;
  font-size: 0.75em;
  background: rgba(var(--green-rgb), 0.08);
  color: var(--color-grey);
  border: 1px solid rgba(var(--green-rgb), 0.15);
  text-transform: capitalize;
}

/* Dataset split bar */
.split-bar {
  display: flex;
  height: 16px;
  border-radius: 3px;
  overflow: hidden;
  gap: 1px;
}
.split-segment {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.65em;
  font-weight: 600;
  color: rgba(0,0,0,0.7);
  min-width: 0;
}
.split-segment.train { background: var(--color-green); }
.split-segment.val { background: #3b82f6; }
.split-segment.holdout { background: #f59e0b; }
.legend-dot.train-dot { background: var(--color-green); }
.legend-dot.val-dot { background: #3b82f6; }
.legend-dot.holdout-dot { background: #f59e0b; }

/* Example items */
.examples-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.example-item {
  display: flex;
  gap: 8px;
  padding: 6px 8px;
  background: rgba(0,0,0,0.1);
  border-radius: 4px;
  border-left: 2px solid rgba(var(--green-rgb), 0.3);
}
.example-num {
  color: var(--color-grey);
  font-size: 0.75em;
  min-width: 20px;
  flex-shrink: 0;
  padding-top: 1px;
}
.example-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.example-field {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.field-label {
  font-size: 0.6em;
  color: var(--color-grey);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.field-value {
  font-size: 0.78em;
  color: var(--color-text);
  line-height: 1.3;
  word-break: break-word;
}
.example-split {
  margin-top: 2px;
}
.split-chip {
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 0.65em;
  text-transform: capitalize;
}
.split-chip.train { background: rgba(var(--green-rgb), 0.1); color: var(--color-green); }
.split-chip.validation { background: rgba(59,130,246,0.1); color: #3b82f6; }
.split-chip.holdout { background: rgba(245,158,11,0.1); color: #f59e0b; }
.more-items {
  font-size: 0.75em;
  color: var(--color-grey);
  text-align: center;
  padding: 6px;
  font-style: italic;
}

/* Actions */
.panel-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-top: 1px dashed rgba(var(--primary-rgb), 0.15);
  padding-top: 12px;
  margin-top: 12px;
}

/* Placeholder */
.placeholder-section {
  text-align: center;
  color: var(--color-text-muted);
  padding: 30px 15px;
  border: 1px dashed var(--terminal-border-color-light);
  background: var(--color-darker-0);
}
.placeholder-section i {
  font-size: 2em;
  opacity: 0.4;
  display: block;
  margin-bottom: 12px;
}
.placeholder-section p {
  font-style: italic;
  margin: 0;
  font-size: 0.9em;
}
</style>
