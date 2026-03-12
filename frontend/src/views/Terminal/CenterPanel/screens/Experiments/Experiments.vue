<template>
  <BaseScreen
    ref="baseScreenRef"
    screenId="ExperimentsScreen"
    activeRightPanel="ExperimentsPanel"
    activeLeftPanel="ExperimentsPanel"
    :panelProps="panelProps"
    :leftPanelProps="leftPanelProps"
    :showInput="false"
    @panel-action="handlePanelAction"
    @screen-change="(s) => emit('screen-change', s)"
    @base-mounted="initializeScreen"
  >
    <template #default>
      <div class="experiments-screen">
        <ScreenToolbar
          title="EXPERIMENTS"
          :count="activeView === 'experiments' ? filteredExperiments.length : filteredDatasets.length"
          :countLabel="activeView === 'experiments' ? 'experiments' : 'datasets'"
          :searchPlaceholder="activeView === 'experiments' ? 'Search experiments...' : 'Search datasets...'"
          :searchQuery="searchQuery"
          :currentLayout="currentLayout"
          :layoutOptions="['grid', 'table']"
          :showCollapseToggle="false"
          :showHideEmpty="false"
          :createLabel="activeView === 'experiments' ? 'New Experiment' : 'Generate Dataset'"
          @update:searchQuery="(v) => (searchQuery = v)"
          @update:layout="(v) => (currentLayout = v)"
          @create="activeView === 'experiments' ? (showForgeModal = true) : (showGenerateModal = true)"
        />

        <!-- View switcher + filter tabs -->
        <div class="tab-bar">
          <div class="view-tabs">
            <button class="view-tab" :class="{ active: activeView === 'experiments' }" @click="switchView('experiments')">
              <i class="fas fa-flask"></i> Experiments
              <span class="tab-count">{{ experiments.length }}</span>
            </button>
            <button class="view-tab" :class="{ active: activeView === 'datasets' }" @click="switchView('datasets')">
              <i class="fas fa-database"></i> Datasets
              <span class="tab-count">{{ datasets.length }}</span>
            </button>
          </div>
          <div class="tab-sep"></div>
          <!-- Status filter tabs (experiments view only) -->
          <div v-if="activeView === 'experiments'" class="status-tabs">
            <button
              v-for="tab in statusTabs"
              :key="tab.value"
              class="status-tab"
              :class="{ active: activeStatusTab === tab.value }"
              @click="activeStatusTab = tab.value"
            >
              {{ tab.label }}
              <span class="tab-count">{{ getTabCount(tab.value) }}</span>
            </button>
          </div>
          <!-- Source filter tabs (datasets view only) -->
          <div v-if="activeView === 'datasets'" class="status-tabs">
            <button
              v-for="tab in sourceTabs"
              :key="tab.value"
              class="status-tab"
              :class="{ active: activeSourceTab === tab.value }"
              @click="activeSourceTab = tab.value"
            >
              {{ tab.label }}
              <span class="tab-count">{{ getSourceCount(tab.value) }}</span>
            </button>
          </div>
        </div>

        <!-- ═══ EXPERIMENTS VIEW ═══ -->
        <template v-if="activeView === 'experiments'">
          <!-- Insights detail (shown when experiment selected) -->
          <div v-if="selectedExperiment && selectedExperiment.status === 'completed'" class="insights-bar">
            <div class="insights-stats">
              <span class="ins-stat">
                <span class="ins-label">Delta</span>
                <span class="ins-value" :class="selectedExperiment.result?.delta > 0 ? 'delta-positive' : selectedExperiment.result?.delta < 0 ? 'delta-negative' : ''">
                  {{ selectedExperiment.result?.delta != null ? ((selectedExperiment.result.delta > 0 ? '+' : '') + selectedExperiment.result.delta.toFixed(3)) : '-' }}
                </span>
              </span>
              <span class="ins-stat">
                <span class="ins-label">Decision</span>
                <span class="ins-value decision" :class="selectedExperiment.result?.decision || ''">{{ selectedExperiment.result?.decision || 'pending' }}</span>
              </span>
              <span v-if="selectedExperiment.hypothesis" class="ins-stat ins-hypothesis">
                <span class="ins-label">Hypothesis</span>
                <span class="ins-value">"{{ truncate(selectedExperiment.hypothesis, 100) }}"</span>
              </span>
            </div>
            <Tooltip text="Dismiss">
              <button class="ins-close" @click="selectedExperiment = null; store.commit('experiments/SET_SELECTED_EXPERIMENT', null)">
                <i class="fas fa-times"></i>
              </button>
            </Tooltip>
          </div>

          <!-- Grid Layout -->
          <div v-if="filteredExperiments.length > 0 && currentLayout === 'grid'" class="experiments-grid">
            <ExperimentCard
              v-for="exp in filteredExperiments"
              :key="exp.id"
              :experiment="exp"
              :selected="selectedExperiment?.id === exp.id"
              @click="selectExperiment(exp)"
              @delete="confirmDeleteExperiment(exp)"
              @run="runExperiment(exp)"
            />
          </div>

          <!-- Table Layout -->
          <div v-if="filteredExperiments.length > 0 && currentLayout === 'table'" class="experiments-table-container">
            <table class="experiments-table">
              <thead>
                <tr><th>Name</th><th>Type</th><th>Status</th><th>Delta</th><th>Created</th></tr>
              </thead>
              <tbody>
                <tr
                  v-for="exp in filteredExperiments"
                  :key="exp.id"
                  :class="{ selected: selectedExperiment?.id === exp.id }"
                  @click="selectExperiment(exp)"
                >
                  <td class="name-cell">{{ exp.name }}</td>
                  <td><span class="type-badge">{{ exp.type }}</span></td>
                  <td><span class="status-badge" :class="exp.status">{{ exp.status }}</span></td>
                  <td>
                    <span v-if="exp.result?.delta != null" :class="exp.result.delta > 0 ? 'delta-positive' : 'delta-negative'">
                      {{ exp.result.delta > 0 ? '+' : '' }}{{ exp.result.delta?.toFixed(3) }}
                    </span>
                    <span v-else>-</span>
                  </td>
                  <td>{{ formatDate(exp.created_at) }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Empty -->
          <div v-if="filteredExperiments.length === 0" class="empty-state-container">
            <div class="empty-state">
              <i class="fas fa-flask"></i>
              <p>No experiments yet</p>
              <div class="empty-state-buttons">
                <button class="create-button" @click="showForgeModal = true"><i class="fas fa-plus"></i> Create Experiment</button>
              </div>
            </div>
          </div>
        </template>

        <!-- ═══ DATASETS VIEW ═══ -->
        <template v-if="activeView === 'datasets'">
          <div v-if="filteredDatasets.length > 0 && currentLayout === 'grid'" class="experiments-grid">
            <DatasetCard
              v-for="ds in filteredDatasets"
              :key="ds.id"
              :dataset="ds"
              :selected="selectedDataset?.id === ds.id"
              @click="selectDataset(ds)"
              @delete="confirmDeleteDataset(ds)"
            />
          </div>

          <div v-if="filteredDatasets.length > 0 && currentLayout === 'table'" class="experiments-table-container">
            <table class="experiments-table">
              <thead><tr><th>Name</th><th>Source</th><th>Skill</th><th>Examples</th><th>Created</th></tr></thead>
              <tbody>
                <tr v-for="ds in filteredDatasets" :key="ds.id" :class="{ selected: selectedDataset?.id === ds.id }" @click="selectDataset(ds)">
                  <td class="name-cell">{{ ds.name }}</td>
                  <td><span class="type-badge">{{ ds.source || 'manual' }}</span></td>
                  <td>{{ ds.skill_name || '-' }}</td>
                  <td>{{ ds.items?.length || ds.example_count || 0 }}</td>
                  <td>{{ formatDate(ds.created_at) }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div v-if="filteredDatasets.length === 0" class="empty-state-container">
            <div class="empty-state">
              <i class="fas fa-database"></i>
              <p>No evaluation datasets</p>
              <div class="empty-state-buttons">
                <button class="create-button" @click="showGenerateModal = true"><i class="fas fa-magic"></i> Generate Dataset</button>
              </div>
            </div>
          </div>
        </template>
      </div>

      <!-- ═══ NEW EXPERIMENT MODAL ═══ -->
      <Teleport to="body">
        <div v-if="showForgeModal" class="modal-overlay" @click.self="showForgeModal = false">
          <div class="modal-content modal-wide">
            <div class="modal-header">
              <h3>New Experiment</h3>
              <button class="modal-close" @click="showForgeModal = false"><i class="fas fa-times"></i></button>
            </div>
            <div class="modal-body">
              <!-- Experiment Details -->
              <div class="form-group">
                <label>Name <span class="required">*</span></label>
                <input v-model="forgeForm.name" class="form-input" placeholder="e.g., Improve code review accuracy" />
              </div>
              <div class="form-group">
                <label>Hypothesis</label>
                <textarea v-model="forgeForm.hypothesis" class="form-input" rows="2" placeholder="e.g., Adding chain-of-thought reasoning will improve detection rate by 10%"></textarea>
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label>Type</label>
                  <select v-model="forgeForm.type" class="form-input">
                    <option value="ab_test">A/B Test</option>
                    <option value="iterative">Iterative</option>
                    <option value="ablation">Ablation</option>
                  </select>
                </div>
                <div class="form-group">
                  <label>Skill <span class="required">*</span></label>
                  <select v-model="forgeForm.skillId" class="form-input">
                    <option value="">Select a skill...</option>
                    <option v-for="skill in availableSkills" :key="skill.id" :value="skill.id">{{ skill.name }}</option>
                  </select>
                </div>
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label>Goal (optional)</label>
                  <select v-model="forgeForm.goalId" class="form-input">
                    <option value="">No goal linked</option>
                    <option v-for="goal in availableGoals" :key="goal.id" :value="goal.id">{{ goal.title }}</option>
                  </select>
                </div>
                <div class="form-group">
                  <label>Dataset</label>
                  <select v-model="forgeForm.datasetId" class="form-input">
                    <option value="">Auto-generate</option>
                    <option v-for="ds in datasets" :key="ds.id" :value="ds.id">{{ ds.name }} ({{ ds.items?.length || 0 }})</option>
                  </select>
                </div>
              </div>
              <div class="form-row-3">
                <div class="form-group">
                  <label>Max Iterations</label>
                  <input v-model.number="forgeForm.maxIterations" type="number" class="form-input" min="1" max="20" />
                </div>
                <div class="form-group">
                  <label>Runs per Example</label>
                  <input v-model.number="forgeForm.runsPerExample" type="number" class="form-input" min="1" max="10" />
                </div>
                <div class="form-group">
                  <label>Min Delta</label>
                  <input v-model.number="forgeForm.minDelta" type="number" class="form-input" step="0.01" min="0" max="1" />
                </div>
              </div>
            </div>
            <div class="modal-footer">
              <button class="modal-btn cancel" @click="showForgeModal = false">Cancel</button>
              <button class="modal-btn save" :disabled="!canLaunch || launching" @click="launchExperiment">
                <i :class="launching ? 'fas fa-spinner fa-spin' : 'fas fa-rocket'"></i>
                {{ launching ? 'Launching...' : 'Launch' }}
              </button>
            </div>
          </div>
        </div>
      </Teleport>

      <!-- ═══ GENERATE DATASET MODAL ═══ -->
      <Teleport to="body">
        <div v-if="showGenerateModal" class="modal-overlay" @click.self="showGenerateModal = false">
          <div class="modal-content">
            <div class="modal-header">
              <h3>Generate Eval Dataset</h3>
              <button class="modal-close" @click="showGenerateModal = false"><i class="fas fa-times"></i></button>
            </div>
            <div class="modal-body">
              <div class="form-group">
                <label>Skill <span class="required">*</span></label>
                <select v-model="generateForm.skillId" class="form-input">
                  <option value="">Select a skill...</option>
                  <option v-for="skill in availableSkills" :key="skill.id" :value="skill.id">{{ skill.name }}</option>
                </select>
              </div>
              <div class="form-group">
                <label>Source</label>
                <select v-model="generateForm.source" class="form-input">
                  <option value="synthetic">Synthetic (LLM-generated)</option>
                  <option value="historical">From History</option>
                  <option value="golden">From Golden Standards</option>
                </select>
              </div>
              <div class="form-group">
                <label>Category (optional)</label>
                <input v-model="generateForm.category" class="form-input" placeholder="e.g., edge_cases, common" />
              </div>
            </div>
            <div class="modal-footer">
              <button class="modal-btn cancel" @click="showGenerateModal = false">Cancel</button>
              <button class="modal-btn save" :disabled="!generateForm.skillId || generating" @click="generateDataset">
                <i :class="generating ? 'fas fa-spinner fa-spin' : 'fas fa-magic'"></i>
                {{ generating ? 'Generating...' : 'Generate' }}
              </button>
            </div>
          </div>
        </div>
      </Teleport>

      <SimpleModal ref="simpleModal" />
    </template>
  </BaseScreen>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useStore } from 'vuex';
import BaseScreen from '@/views/Terminal/CenterPanel/BaseScreen.vue';
import ScreenToolbar from '@/views/Terminal/_components/ScreenToolbar.vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import ExperimentCard from './_components/ExperimentCard.vue';
import DatasetCard from '../EvalDatasets/_components/DatasetCard.vue';

const store = useStore();
const emit = defineEmits(['screen-change']);
const simpleModal = ref(null);

// View state
const activeView = ref('experiments');
const searchQuery = ref('');
const activeStatusTab = ref('all');
const activeSourceTab = ref('all');
const currentLayout = ref('grid');
const selectedExperiment = ref(null);
const selectedDataset = ref(null);

// Modals
const showForgeModal = ref(false);
const showGenerateModal = ref(false);
const launching = ref(false);
const generating = ref(false);

// Forge form
const forgeForm = ref({
  name: '', hypothesis: '', type: 'ab_test', skillId: '', goalId: '', datasetId: '',
  maxIterations: 5, runsPerExample: 3, minDelta: 0.05,
});

// Generate form
const generateForm = ref({ skillId: '', source: 'synthetic', category: '' });

// Tabs
const statusTabs = [
  { value: 'all', label: 'All' },
  { value: 'planned', label: 'Planned' },
  { value: 'running', label: 'Running' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
];

const sourceTabs = [
  { value: 'all', label: 'All' },
  { value: 'synthetic', label: 'Synthetic' },
  { value: 'historical', label: 'Historical' },
  { value: 'golden', label: 'Golden' },
  { value: 'manual', label: 'Manual' },
];

// Data
const experiments = computed(() => store.getters['experiments/allExperiments'] || []);
const datasets = computed(() => store.getters['experiments/allEvalDatasets'] || []);
const availableSkills = computed(() => store.getters['skills/allSkills'] || []);
const availableGoals = computed(() => store.getters['goals/allGoals'] || []);

const filteredExperiments = computed(() => {
  let result = experiments.value;
  if (activeStatusTab.value !== 'all') result = result.filter((e) => e.status === activeStatusTab.value);
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase();
    result = result.filter((e) => e.name?.toLowerCase().includes(q) || e.hypothesis?.toLowerCase().includes(q));
  }
  return result;
});

const filteredDatasets = computed(() => {
  let result = datasets.value;
  if (activeSourceTab.value !== 'all') result = result.filter((d) => (d.source || 'manual') === activeSourceTab.value);
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase();
    result = result.filter((d) => d.name?.toLowerCase().includes(q) || d.skill_name?.toLowerCase().includes(q));
  }
  return result;
});

const panelProps = computed(() => ({
  selectedExperiment: activeView.value === 'experiments' ? selectedExperiment.value : null,
  selectedDataset: activeView.value === 'datasets' ? selectedDataset.value : null,
}));
const leftPanelProps = computed(() => ({ experiments: experiments.value, activeTab: activeStatusTab.value }));
const canLaunch = computed(() => forgeForm.value.name?.trim() && forgeForm.value.skillId);

const getTabCount = (s) => s === 'all' ? experiments.value.length : experiments.value.filter((e) => e.status === s).length;
const getSourceCount = (s) => s === 'all' ? datasets.value.length : datasets.value.filter((d) => (d.source || 'manual') === s).length;

const formatDate = (d) => {
  if (!d) return '-';
  const diff = Date.now() - new Date(d);
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return new Date(d).toLocaleDateString();
};

const truncate = (text, max) => (!text ? '' : text.length > max ? text.slice(0, max) + '...' : text);

const switchView = (view) => {
  activeView.value = view;
  searchQuery.value = '';
};

const selectExperiment = (e) => {
  selectedExperiment.value = selectedExperiment.value?.id === e.id ? null : e;
  store.commit('experiments/SET_SELECTED_EXPERIMENT', e.id);
};

const selectDataset = (ds) => {
  selectedDataset.value = selectedDataset.value?.id === ds.id ? null : ds;
  store.commit('experiments/SET_SELECTED_DATASET', ds.id);
};

const runExperiment = async (e) => {
  try { await store.dispatch('experiments/runExperiment', e.id); } catch (err) { console.error('Failed to run:', err); }
};

const confirmDeleteExperiment = async (e) => {
  const confirmed = await simpleModal.value?.showModal({
    title: 'Delete Experiment?',
    message: `Are you sure you want to delete "${e.name}"? This cannot be undone.`,
    confirmText: 'Delete', cancelText: 'Cancel', showCancel: true, confirmClass: 'btn-danger',
  });
  if (confirmed) {
    try {
      await store.dispatch('experiments/deleteExperiment', e.id);
      if (selectedExperiment.value?.id === e.id) selectedExperiment.value = null;
    } catch (err) { console.error('Failed to delete experiment:', err); }
  }
};

const confirmDeleteDataset = async (ds) => {
  const confirmed = await simpleModal.value?.showModal({
    title: 'Delete Dataset?',
    message: `Are you sure you want to delete "${ds.name}"? This cannot be undone.`,
    confirmText: 'Delete', cancelText: 'Cancel', showCancel: true, confirmClass: 'btn-danger',
  });
  if (confirmed) {
    try {
      await store.dispatch('experiments/deleteEvalDataset', ds.id);
      if (selectedDataset.value?.id === ds.id) selectedDataset.value = null;
    } catch (err) { console.error('Failed to delete dataset:', err); }
  }
};

const launchExperiment = async () => {
  if (!canLaunch.value || launching.value) return;
  launching.value = true;
  try {
    const experimentData = {
      name: forgeForm.value.name,
      hypothesis: forgeForm.value.hypothesis,
      type: forgeForm.value.type,
      skillId: forgeForm.value.skillId,
      sourceGoalId: forgeForm.value.goalId || null,
      evalDatasetId: forgeForm.value.datasetId || null,
      config: {
        maxIterations: forgeForm.value.maxIterations,
        runsPerExample: forgeForm.value.runsPerExample,
        minDelta: forgeForm.value.minDelta,
      },
    };
    const result = await store.dispatch('experiments/createExperiment', experimentData);
    if (result?.experiment?.id) {
      await store.dispatch('experiments/runExperiment', result.experiment.id);
    }
    showForgeModal.value = false;
    forgeForm.value = { name: '', hypothesis: '', type: 'ab_test', skillId: '', goalId: '', datasetId: '', maxIterations: 5, runsPerExample: 3, minDelta: 0.05 };
  } catch (err) {
    console.error('Failed to launch experiment:', err);
  } finally {
    launching.value = false;
  }
};

const generateDataset = async () => {
  if (!generateForm.value.skillId || generating.value) return;
  generating.value = true;
  try {
    await store.dispatch('experiments/generateEvalDataset', {
      skillId: generateForm.value.skillId,
      source: generateForm.value.source,
      category: generateForm.value.category || undefined,
    });
    showGenerateModal.value = false;
    generateForm.value = { skillId: '', source: 'synthetic', category: '' };
  } catch (err) {
    console.error('Failed to generate dataset:', err);
  } finally {
    generating.value = false;
  }
};

const handlePanelAction = (action, data) => {
  if (action === 'navigate') emit('screen-change', data);
  else if (action === 'delete-experiment' && data) confirmDeleteExperiment(data);
  else if (action === 'run-experiment' && data) runExperiment(data);
  else if (action === 'delete-dataset' && data) confirmDeleteDataset(data);
};

const initializeScreen = () => {
  store.dispatch('experiments/fetchExperiments', { force: true });
  store.dispatch('experiments/fetchEvalDatasets', { force: false });
  store.dispatch('skills/fetchSkills');
  store.dispatch('goals/fetchGoals');
};

onMounted(() => initializeScreen());
</script>

<style scoped>
.experiments-screen {
  display: flex;
  flex-direction: column;
  flex: 1;
  width: 100%;
  min-height: 0;
  position: relative;
}

/* Tab bar below toolbar */
.tab-bar {
  display: flex;
  align-items: center;
  padding: 8px 16px;
  border-bottom: 1px solid var(--terminal-border-color);
  flex-shrink: 0;
  gap: 4px;
}
.tab-sep {
  width: 1px;
  height: 20px;
  background: var(--terminal-border-color);
  margin: 0 8px;
}

/* View/Status Tabs */
.view-tabs {
  display: flex;
  gap: 2px;
}
.view-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: transparent;
  border: 1px solid var(--terminal-border-color);
  border-radius: 4px;
  color: var(--color-grey);
  cursor: pointer;
  font-size: 0.8em;
  transition: all 0.2s;
  white-space: nowrap;
}
.view-tab:hover {
  background: rgba(var(--green-rgb), 0.05);
  border-color: rgba(var(--green-rgb), 0.3);
}
.view-tab.active {
  background: rgba(var(--green-rgb), 0.1);
  border-color: rgba(var(--green-rgb), 0.5);
  color: var(--color-green);
}
.status-tabs {
  display: flex;
  gap: 4px;
  padding: 0 4px;
}
.status-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  color: var(--color-grey);
  cursor: pointer;
  font-size: 0.8em;
  transition: all 0.2s;
  white-space: nowrap;
}
.status-tab:hover {
  color: var(--color-text);
}
.status-tab.active {
  color: var(--color-green);
  border-color: rgba(var(--green-rgb), 0.3);
}
.tab-count {
  background: var(--color-darker-0);
  padding: 1px 6px;
  border-radius: 10px;
  font-size: 0.85em;
}

/* Insights bar */
.insights-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  background: rgba(var(--green-rgb), 0.04);
  border-bottom: 1px solid rgba(var(--green-rgb), 0.15);
  flex-shrink: 0;
}
.insights-stats {
  display: flex;
  gap: 16px;
  flex: 1;
  align-items: center;
}
.ins-stat {
  display: flex;
  align-items: center;
  gap: 6px;
}
.ins-label {
  font-size: 0.7em;
  color: var(--color-grey);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.ins-value {
  font-size: 0.85em;
  color: var(--color-text);
  font-weight: 500;
}
.ins-value.delta-positive { color: var(--color-green); }
.ins-value.delta-negative { color: #ef4444; }
.ins-value.decision.keep { color: var(--color-green); }
.ins-value.decision.discard { color: #ef4444; }
.ins-value.decision.iterate { color: #f59e0b; }
.ins-hypothesis {
  flex: 1;
  min-width: 0;
}
.ins-hypothesis .ins-value {
  font-style: italic;
  font-weight: 400;
  color: var(--color-grey);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ins-close {
  background: none;
  border: none;
  color: var(--color-grey);
  cursor: pointer;
  padding: 4px;
  font-size: 0.8em;
}
.ins-close:hover { color: var(--color-text); }

/* Grid */
.experiments-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 12px;
  padding: 16px;
  overflow-y: auto;
  flex: 1;
  align-content: start;
}

/* Table */
.experiments-table-container {
  flex: 1;
  overflow-y: auto;
  padding: 0 16px;
}
.experiments-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9em;
}
.experiments-table th {
  text-align: left;
  padding: 10px 12px;
  border-bottom: 1px solid var(--terminal-border-color);
  color: var(--color-grey);
  font-weight: 600;
  font-size: 0.85em;
  text-transform: uppercase;
}
.experiments-table td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--terminal-border-color);
  color: var(--color-text);
}
.experiments-table tr {
  cursor: pointer;
  transition: background 0.15s;
}
.experiments-table tr:hover {
  background: rgba(var(--green-rgb), 0.03);
}
.experiments-table tr.selected {
  background: rgba(var(--green-rgb), 0.08);
}
.name-cell { font-weight: 500; }
.type-badge {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.8em;
  background: rgba(var(--primary-rgb), 0.1);
  color: var(--color-primary);
}
.status-badge {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.8em;
  font-weight: 500;
}
.status-badge.planned { background: rgba(150,150,150,0.15); color: #999; }
.status-badge.running { background: rgba(59,130,246,0.15); color: #3b82f6; }
.status-badge.completed { background: rgba(var(--green-rgb),0.15); color: var(--color-green); }
.status-badge.failed { background: rgba(239,68,68,0.15); color: #ef4444; }
.delta-positive { color: var(--color-green); font-weight: 500; }
.delta-negative { color: #ef4444; font-weight: 500; }

/* Empty State */
.empty-state-container {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
}
.empty-state { text-align: center; color: var(--color-grey); }
.empty-state i { font-size: 3em; display: block; opacity: 0.5; }
.empty-state p { margin: 16px 0; font-size: 1.1em; }
.empty-state-buttons { display: flex; gap: 12px; justify-content: center; }
.create-button {
  display: flex;
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
.create-button:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: rgba(var(--primary-rgb), 0.05);
}

/* Modal */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}
.modal-content {
  background: var(--terminal-bg);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  width: 540px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0,0,0,0.5);
}
.modal-content.modal-wide { width: 640px; }
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--terminal-border-color);
}
.modal-header h3 { margin: 0; font-size: 1em; color: var(--color-text); }
.modal-close {
  background: none;
  border: none;
  color: var(--color-grey);
  cursor: pointer;
  font-size: 1em;
}
.modal-close:hover { color: var(--color-text); }
.modal-body {
  padding: 20px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.form-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.form-group label {
  font-size: 0.85em;
  color: var(--color-grey);
}
.required { color: var(--color-red); }
.form-input {
  padding: 8px 10px;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color) !important;
  border-radius: 4px !important;
  color: var(--color-text);
  font-size: 0.9em;
  font-family: inherit;
  height: auto !important;
  width: 100%;
  box-sizing: border-box;
}
.form-input:focus {
  outline: none;
  border-color: var(--color-primary) !important;
}
textarea.form-input { resize: vertical; min-height: 50px; }
select.form-input { cursor: pointer; }
select.form-input option { background: var(--terminal-bg); color: var(--color-text); }
.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.form-row-3 {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}
.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 20px;
  border-top: 1px solid var(--terminal-border-color);
}
.modal-btn {
  padding: 8px 18px;
  border-radius: 4px;
  font-size: 0.85em;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
}
.modal-btn.cancel {
  background: rgba(var(--green-rgb), 0.1);
  border: 1px solid rgba(var(--green-rgb), 0.2);
  color: var(--color-text);
}
.modal-btn.save {
  background: var(--color-green);
  color: var(--color-dark-navy);
  border: none;
  font-weight: 600;
}
.modal-btn.save:disabled { opacity: 0.5; cursor: not-allowed; }
.modal-btn.save:not(:disabled):hover { opacity: 0.85; }
</style>
