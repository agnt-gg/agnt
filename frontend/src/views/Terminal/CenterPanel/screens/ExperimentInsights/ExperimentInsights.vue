<template>
  <BaseScreen ref="baseScreenRef" screenId="ExperimentInsightsScreen" activeRightPanel="ExperimentInsightsPanel" activeLeftPanel="ExperimentInsightsPanel" :panelProps="panelProps" :leftPanelProps="leftPanelProps" :showInput="false" @panel-action="handlePanelAction" @screen-change="(s) => emit('screen-change', s)" @base-mounted="initializeScreen">
    <template #default>
      <div class="insights-screen">
        <ScreenToolbar title="EXPERIMENT INSIGHTS" :count="0" countLabel="" searchPlaceholder="" :searchQuery="''" :currentLayout="''" :layoutOptions="[]" :showCollapseToggle="false" :showHideEmpty="false" :createLabel="''" />

        <div v-if="selectedExperiment" class="insights-content">
          <!-- Overview Stats -->
          <div class="stats-row">
            <div class="stat-card">
              <span class="stat-label">Status</span>
              <span class="stat-value status" :class="selectedExperiment.status">{{ selectedExperiment.status }}</span>
            </div>
            <div class="stat-card">
              <span class="stat-label">Type</span>
              <span class="stat-value">{{ selectedExperiment.type || 'ab_test' }}</span>
            </div>
            <div class="stat-card">
              <span class="stat-label">Delta</span>
              <span class="stat-value" :class="deltaClass">{{ deltaDisplay }}</span>
            </div>
            <div class="stat-card">
              <span class="stat-label">Decision</span>
              <span class="stat-value decision" :class="selectedExperiment.result?.decision || ''">{{ selectedExperiment.result?.decision || 'pending' }}</span>
            </div>
          </div>

          <!-- Hypothesis -->
          <div v-if="selectedExperiment.hypothesis" class="section-card">
            <h3 class="section-title"><i class="fas fa-lightbulb"></i> Hypothesis</h3>
            <p class="hypothesis-text">"{{ selectedExperiment.hypothesis }}"</p>
          </div>

          <!-- Dimension Breakdown -->
          <div v-if="dimensions.length > 0" class="section-card">
            <h3 class="section-title"><i class="fas fa-chart-bar"></i> Dimension Breakdown</h3>
            <DimensionBreakdown :dimensions="dimensions" />
          </div>

          <!-- Skill Evolution -->
          <div v-if="evolutionData.length > 0" class="section-card">
            <h3 class="section-title"><i class="fas fa-chart-line"></i> Skill Evolution</h3>
            <SkillEvolutionChart :data="evolutionData" />
          </div>

          <!-- Runs Table -->
          <div v-if="experimentRuns.length > 0" class="section-card">
            <h3 class="section-title"><i class="fas fa-list"></i> Run Results ({{ experimentRuns.length }})</h3>
            <div class="runs-table-container">
              <table class="runs-table">
                <thead><tr><th>#</th><th>Variant</th><th>Composite</th><th>Correctness</th><th>Procedure</th><th>Conciseness</th></tr></thead>
                <tbody>
                  <tr v-for="(run, idx) in experimentRuns" :key="run.id || idx">
                    <td>{{ idx + 1 }}</td>
                    <td><span class="variant-badge" :class="run.variant">{{ run.variant }}</span></td>
                    <td class="score-cell">{{ run.metrics?.composite?.toFixed(3) || '-' }}</td>
                    <td class="score-cell">{{ run.metrics?.correctness?.toFixed(2) || '-' }}</td>
                    <td class="score-cell">{{ run.metrics?.procedureFollowing?.toFixed(2) || '-' }}</td>
                    <td class="score-cell">{{ run.metrics?.conciseness?.toFixed(2) || '-' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <!-- No Experiment Selected -->
        <div v-else class="empty-state-container">
          <div class="empty-state">
            <i class="fas fa-chart-line"></i>
            <h3>No experiment selected</h3>
            <p>Select an experiment from the Experiments screen to view insights.</p>
            <button class="nav-button" @click="emit('screen-change', 'ExperimentsScreen')"><i class="fas fa-flask"></i> Go to Experiments</button>
          </div>
        </div>
      </div>
    </template>
  </BaseScreen>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useStore } from 'vuex';
import BaseScreen from '@/views/Terminal/CenterPanel/BaseScreen.vue';
import ScreenToolbar from '@/views/Terminal/_components/ScreenToolbar.vue';
import DimensionBreakdown from './_components/DimensionBreakdown.vue';
import SkillEvolutionChart from './_components/SkillEvolutionChart.vue';

const store = useStore();
const emit = defineEmits(['screen-change']);

const selectedExperiment = computed(() => store.getters['experiments/selectedExperiment']);
const experimentRuns = computed(() => selectedExperiment.value?.runs || []);

const dimensions = computed(() => {
  const result = selectedExperiment.value?.result;
  const perDim = result?.per_dimension;
  if (!perDim) return [];
  return Object.entries(perDim).map(([name, data]) => ({
    name,
    baseline: data.control ?? 0,
    mutated: data.treatment ?? 0,
    delta: data.delta ?? (data.treatment ?? 0) - (data.control ?? 0),
  }));
});

const evolutionData = computed(() => {
  const runs = experimentRuns.value;
  if (runs.length === 0) return [];
  return runs.map((run, idx) => ({
    iteration: idx + 1,
    score: run.metrics?.composite ?? run.evaluation_score ?? 0,
    variant: run.variant,
  }));
});

const deltaDisplay = computed(() => {
  const d = selectedExperiment.value?.result?.delta;
  if (d == null) return '-';
  return `${d > 0 ? '+' : ''}${d.toFixed(3)}`;
});

const deltaClass = computed(() => {
  const d = selectedExperiment.value?.result?.delta;
  if (d == null) return '';
  return d > 0 ? 'delta-positive' : d < 0 ? 'delta-negative' : '';
});

const panelProps = computed(() => ({ selectedExperiment: selectedExperiment.value }));
const leftPanelProps = computed(() => ({ experiments: store.getters['experiments/allExperiments'] || [] }));

const handlePanelAction = (action, data) => { if (action === 'navigate') emit('screen-change', data); };
const initializeScreen = () => {
  store.dispatch('experiments/fetchExperiments', { force: false });
  if (selectedExperiment.value?.id) {
    store.dispatch('experiments/fetchExperiment', selectedExperiment.value.id);
  }
};
onMounted(() => initializeScreen());
</script>

<style scoped>
.insights-screen {
  display: flex;
  flex-direction: column;
  flex: 1;
  width: 100%;
  min-height: 0;
  position: relative;
}

.insights-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  scrollbar-width: thin;
  scrollbar-color: var(--color-duller-navy) transparent;
}

/* Stats Row */
.stats-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}

.stat-card {
  background: rgba(0, 0, 0, 0.15);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.stat-label {
  font-size: 0.7em;
  color: var(--color-grey);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.stat-value {
  font-size: 1.1em;
  color: var(--color-text);
  font-weight: 600;
}

.stat-value.status.planned {
  color: #999;
}

.stat-value.status.running {
  color: #3b82f6;
}

.stat-value.status.completed {
  color: var(--color-green);
}

.stat-value.status.failed {
  color: var(--color-red);
}

.stat-value.delta-positive {
  color: var(--color-green);
}

.stat-value.delta-negative {
  color: var(--color-red);
}

.stat-value.decision.keep {
  color: var(--color-green);
}

.stat-value.decision.discard {
  color: var(--color-red);
}

.stat-value.decision.iterate {
  color: #f59e0b;
}

/* Section Cards */
.section-card {
  background: rgba(0, 0, 0, 0.15);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  padding: 14px;
}

.section-title {
  margin: 0 0 14px 0;
  font-size: 0.95em;
  font-weight: 600;
  color: var(--color-text);
  display: flex;
  align-items: center;
  gap: 8px;
}

.section-title i {
  color: var(--color-green);
  font-size: 0.9em;
}

/* Hypothesis */
.hypothesis-text {
  font-size: 0.85em;
  color: var(--color-grey);
  font-style: italic;
  margin: 0;
  line-height: 1.4;
}

/* Runs Table */
.runs-table-container {
  overflow-x: auto;
}

.runs-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85em;
}

.runs-table th {
  text-align: left;
  padding: 8px 12px;
  border-bottom: 1px solid var(--terminal-border-color);
  color: var(--color-grey);
  font-weight: 600;
  font-size: 0.8em;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.runs-table td {
  padding: 8px 12px;
  border-bottom: 1px solid var(--terminal-border-color-light);
  color: var(--color-text);
}

.variant-badge {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.75em;
  font-weight: 500;
}

.variant-badge.baseline {
  background: rgba(150, 150, 150, 0.15);
  color: #999;
}

.variant-badge.mutated {
  background: rgba(var(--green-rgb), 0.15);
  color: var(--color-green);
}

.variant-badge.control {
  background: rgba(59, 130, 246, 0.15);
  color: #3b82f6;
}

.variant-badge.treatment {
  background: rgba(var(--green-rgb), 0.15);
  color: var(--color-green);
}

.score-cell {
  font-weight: 500;
  font-family: monospace;
}

.dims-cell {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.dim-chip {
  padding: 1px 6px;
  background: rgba(var(--primary-rgb), 0.08);
  border-radius: 3px;
  font-size: 0.8em;
  color: var(--color-text-muted);
  white-space: nowrap;
}

/* Empty State */
.empty-state-container {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
}

.empty-state {
  text-align: center;
  color: var(--color-text-muted);
}

.empty-state i {
  font-size: 3em;
  display: block;
  opacity: 0.5;
}

.empty-state h3 {
  color: var(--color-text);
  margin: 16px 0 8px 0;
  font-weight: 500;
}

.empty-state p {
  margin: 16px 0;
  font-size: 1.1em;
}

.nav-button {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: transparent;
  border: 1px dashed var(--color-duller-navy);
  padding: 10px 20px;
  border-radius: 6px;
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 0.95em;
  transition: all 0.2s ease;
}

.nav-button:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: rgba(var(--primary-rgb), 0.05);
}

.nav-button i {
  font-size: 0.8em;
}
</style>
