<template>
  <BaseScreen ref="baseScreenRef" screenId="EvalDatasetsScreen" activeRightPanel="EvalDatasetsPanel" activeLeftPanel="EvalDatasetsPanel" :panelProps="panelProps" :leftPanelProps="leftPanelProps" :showInput="false" @panel-action="handlePanelAction" @screen-change="(s) => emit('screen-change', s)" @base-mounted="initializeScreen">
    <template #default>
      <div class="datasets-screen">
        <ScreenToolbar title="EVAL DATASETS" :count="filteredDatasets.length" countLabel="datasets" searchPlaceholder="Search datasets..." :searchQuery="searchQuery" :currentLayout="currentLayout" :layoutOptions="['grid', 'table']" :showCollapseToggle="false" :showHideEmpty="false" createLabel="Generate Dataset" @update:searchQuery="(v) => (searchQuery = v)" @update:currentLayout="(v) => (currentLayout = v)" @create="showGenerateModal = true">
          <template #tabs>
            <div class="source-tabs">
              <button v-for="tab in sourceTabs" :key="tab.value" class="source-tab" :class="{ active: activeSource === tab.value }" @click="activeSource = tab.value">
                <i :class="tab.icon"></i> {{ tab.label }}
                <span class="tab-count">{{ getSourceCount(tab.value) }}</span>
              </button>
            </div>
          </template>
        </ScreenToolbar>

        <div v-if="filteredDatasets.length > 0 && currentLayout === 'grid'" class="datasets-grid">
          <DatasetCard v-for="ds in filteredDatasets" :key="ds.id" :dataset="ds" :selected="selectedDataset?.id === ds.id" @click="selectDataset(ds)" @delete="confirmDelete(ds)" />
        </div>

        <div v-if="filteredDatasets.length > 0 && currentLayout === 'table'" class="datasets-table-container">
          <table class="datasets-table">
            <thead><tr><th>Name</th><th>Source</th><th>Skill</th><th>Examples</th><th>Created</th></tr></thead>
            <tbody>
              <tr v-for="ds in filteredDatasets" :key="ds.id" :class="{ selected: selectedDataset?.id === ds.id }" @click="selectDataset(ds)">
                <td class="name-cell">{{ ds.name }}</td>
                <td><span class="source-badge">{{ ds.source || 'manual' }}</span></td>
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
      </div>

      <!-- Generate Modal -->
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
                  <option value="historical">From History / Golden Standards</option>
                  <option value="golden">From Golden Standards (by category)</option>
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
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import DatasetCard from './_components/DatasetCard.vue';

const store = useStore();
const emit = defineEmits(['screen-change']);
const searchQuery = ref('');
const activeSource = ref('all');
const currentLayout = ref('grid');
const selectedDataset = ref(null);
const simpleModal = ref(null);
const showGenerateModal = ref(false);
const generating = ref(false);

const generateForm = ref({ skillId: '', source: 'synthetic', category: '' });

const sourceTabs = [
  { value: 'all', label: 'All', icon: 'fas fa-database' },
  { value: 'synthetic', label: 'Synthetic', icon: 'fas fa-robot' },
  { value: 'historical', label: 'Historical', icon: 'fas fa-history' },
  { value: 'golden', label: 'Golden', icon: 'fas fa-star' },
  { value: 'manual', label: 'Manual', icon: 'fas fa-pencil-alt' },
];

const datasets = computed(() => store.getters['experiments/allEvalDatasets'] || []);
const availableSkills = computed(() => store.getters['skills/allSkills'] || []);

const filteredDatasets = computed(() => {
  let result = datasets.value;
  if (activeSource.value !== 'all') result = result.filter((d) => (d.source || 'manual') === activeSource.value);
  if (searchQuery.value) { const q = searchQuery.value.toLowerCase(); result = result.filter((d) => d.name?.toLowerCase().includes(q) || d.skill_name?.toLowerCase().includes(q)); }
  return result;
});

const panelProps = computed(() => ({ selectedDataset: selectedDataset.value }));
const leftPanelProps = computed(() => ({ datasets: datasets.value, activeSource: activeSource.value }));
const getSourceCount = (s) => s === 'all' ? datasets.value.length : datasets.value.filter((d) => (d.source || 'manual') === s).length;
const formatDate = (d) => { if (!d) return '-'; const diff = Date.now() - new Date(d); if (diff < 60000) return 'just now'; if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`; if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`; return new Date(d).toLocaleDateString(); };
const selectDataset = (ds) => { selectedDataset.value = ds; store.commit('experiments/SET_SELECTED_DATASET', ds.id); };

const confirmDelete = async (ds) => {
  const confirmed = await simpleModal.value?.showModal({
    title: 'Delete Dataset?',
    message: `Are you sure you want to delete "${ds.name}"? This cannot be undone.`,
    confirmText: 'Delete',
    cancelText: 'Cancel',
    showCancel: true,
    confirmClass: 'btn-danger',
  });
  if (confirmed) {
    try {
      await store.dispatch('experiments/deleteEvalDataset', ds.id);
      if (selectedDataset.value?.id === ds.id) selectedDataset.value = null;
    } catch (err) {
      console.error('Failed to delete dataset:', err);
    }
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

const handlePanelAction = (action, data) => { if (action === 'navigate') emit('screen-change', data); };
const initializeScreen = () => {
  store.dispatch('experiments/fetchEvalDatasets', { force: true });
  store.dispatch('skills/fetchSkills');
};
onMounted(() => initializeScreen());
</script>

<style scoped>
.datasets-screen {
  display: flex;
  flex-direction: column;
  flex: 1;
  width: 100%;
  min-height: 0;
  position: relative;
}

/* Source Tabs */
.source-tabs {
  display: flex;
  gap: 4px;
  padding: 0 8px;
}
.source-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: transparent;
  border: 1px solid var(--terminal-border-color);
  border-radius: 4px;
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 0.8em;
  transition: all 0.2s;
  white-space: nowrap;
}
.source-tab:hover {
  background: rgba(var(--green-rgb), 0.05);
  border-color: rgba(var(--green-rgb), 0.3);
}
.source-tab.active {
  background: rgba(var(--green-rgb), 0.1);
  border-color: rgba(var(--green-rgb), 0.5);
  color: var(--color-green);
}
.tab-count {
  background: var(--color-darker-0);
  padding: 1px 6px;
  border-radius: 10px;
  font-size: 0.85em;
}

/* Grid */
.datasets-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 12px;
  padding: 16px;
  overflow-y: auto;
  flex: 1;
  align-content: start;
}

/* Table */
.datasets-table-container {
  flex: 1;
  overflow-y: auto;
  padding: 0 16px;
}
.datasets-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9em;
}
.datasets-table th {
  text-align: left;
  padding: 10px 12px;
  border-bottom: 1px solid var(--terminal-border-color);
  color: var(--color-grey);
  font-weight: 600;
  font-size: 0.85em;
  text-transform: uppercase;
}
.datasets-table td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--terminal-border-color);
  color: var(--color-text);
}
.datasets-table tr {
  cursor: pointer;
  transition: background 0.15s;
}
.datasets-table tr:hover {
  background: rgba(var(--green-rgb), 0.03);
}
.datasets-table tr.selected {
  background: rgba(var(--green-rgb), 0.08);
}
.name-cell {
  font-weight: 500;
}
.source-badge {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.8em;
  background: rgba(var(--primary-rgb), 0.1);
  color: var(--color-primary);
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
.empty-state p {
  margin: 16px 0;
  font-size: 1.1em;
}
.empty-state-buttons {
  display: flex;
  gap: 12px;
  justify-content: center;
  align-items: center;
}
.create-button {
  display: flex;
  align-items: center;
  justify-content: center;
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
.create-button i {
  font-size: 0.8em;
}

/* Modal */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
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
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
}
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--terminal-border-color);
}
.modal-header h3 {
  margin: 0;
  font-size: 1em;
  color: var(--color-text);
}
.modal-close {
  background: none;
  border: none;
  color: var(--color-grey);
  cursor: pointer;
  font-size: 1em;
}
.modal-close:hover {
  color: var(--color-text);
}
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
.required {
  color: var(--color-red);
}
.form-input {
  padding: 8px 10px;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color) !important;
  border-radius: 4px !important;
  color: var(--color-text);
  font-size: 0.9em;
  font-family: inherit;
  height: auto !important;
}
.form-input:focus {
  outline: none;
  border-color: var(--color-primary) !important;
}
select.form-input {
  cursor: pointer;
}
select.form-input option {
  background: var(--terminal-bg);
  color: var(--color-text);
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
.modal-btn.save:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.modal-btn.save:not(:disabled):hover {
  opacity: 0.85;
}
</style>
