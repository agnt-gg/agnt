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
          :count="filteredExperiments.length"
          countLabel="experiments"
          searchPlaceholder="Search experiments..."
          :searchQuery="searchQuery"
          :currentLayout="currentLayout"
          :layoutOptions="['grid', 'table']"
          :showCollapseToggle="false"
          :showHideEmpty="false"
          createLabel="New Experiment"
          @update:searchQuery="(v) => (searchQuery = v)"
          @update:currentLayout="(v) => (currentLayout = v)"
          @create="navigateToForge"
        >
          <template #tabs>
            <div class="status-tabs">
              <button
                v-for="tab in statusTabs"
                :key="tab.value"
                class="status-tab"
                :class="{ active: activeTab === tab.value }"
                @click="activeTab = tab.value"
              >
                <i :class="tab.icon"></i> {{ tab.label }}
                <span class="tab-count">{{ getTabCount(tab.value) }}</span>
              </button>
            </div>
          </template>
        </ScreenToolbar>

        <!-- Grid Layout -->
        <div v-if="filteredExperiments.length > 0 && currentLayout === 'grid'" class="experiments-grid">
          <ExperimentCard
            v-for="exp in filteredExperiments"
            :key="exp.id"
            :experiment="exp"
            :selected="selectedExperiment?.id === exp.id"
            @click="selectExperiment(exp)"
            @delete="confirmDelete(exp)"
            @run="runExperiment(exp)"
          />
        </div>

        <!-- Table Layout -->
        <div v-if="filteredExperiments.length > 0 && currentLayout === 'table'" class="experiments-table-container">
          <table class="experiments-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Status</th>
                <th>Delta</th>
                <th>Created</th>
              </tr>
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
                  <span
                    v-if="exp.result?.delta != null"
                    :class="exp.result.delta > 0 ? 'delta-positive' : 'delta-negative'"
                  >{{ exp.result.delta > 0 ? '+' : '' }}{{ exp.result.delta?.toFixed(3) }}</span>
                  <span v-else>-</span>
                </td>
                <td>{{ formatDate(exp.created_at) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Empty State -->
        <div v-if="filteredExperiments.length === 0" class="empty-state-container">
          <div class="empty-state">
            <i class="fas fa-flask"></i>
            <p>No experiments yet</p>
            <div class="empty-state-buttons">
              <button class="create-button" @click="navigateToForge">
                <i class="fas fa-plus"></i> Create Experiment
              </button>
            </div>
          </div>
        </div>
      </div>

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
import ExperimentCard from './_components/ExperimentCard.vue';

const store = useStore();
const emit = defineEmits(['screen-change']);
const searchQuery = ref('');
const activeTab = ref('all');
const currentLayout = ref('grid');
const selectedExperiment = ref(null);
const simpleModal = ref(null);

const statusTabs = [
  { value: 'all', label: 'All', icon: 'fas fa-list' },
  { value: 'planned', label: 'Planned', icon: 'fas fa-clipboard-list' },
  { value: 'running', label: 'Running', icon: 'fas fa-spinner' },
  { value: 'completed', label: 'Completed', icon: 'fas fa-check-circle' },
  { value: 'failed', label: 'Failed', icon: 'fas fa-exclamation-triangle' },
];

const experiments = computed(() => store.getters['experiments/allExperiments'] || []);
const filteredExperiments = computed(() => {
  let result = experiments.value;
  if (activeTab.value !== 'all') result = result.filter((e) => e.status === activeTab.value);
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase();
    result = result.filter((e) => e.name?.toLowerCase().includes(q) || e.hypothesis?.toLowerCase().includes(q));
  }
  return result;
});
const panelProps = computed(() => ({ selectedExperiment: selectedExperiment.value }));
const leftPanelProps = computed(() => ({ experiments: experiments.value, activeTab: activeTab.value }));
const getTabCount = (s) => s === 'all' ? experiments.value.length : experiments.value.filter((e) => e.status === s).length;
const formatDate = (d) => {
  if (!d) return '-';
  const diff = Date.now() - new Date(d);
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return new Date(d).toLocaleDateString();
};
const selectExperiment = (e) => {
  selectedExperiment.value = e;
  store.commit('experiments/SET_SELECTED_EXPERIMENT', e.id);
};
const navigateToForge = () => emit('screen-change', 'ExperimentForgeScreen');
const runExperiment = async (e) => {
  try {
    await store.dispatch('experiments/runExperiment', e.id);
  } catch (err) {
    console.error('Failed to run:', err);
  }
};
const confirmDelete = async (e) => {
  const confirmed = await simpleModal.value?.showModal({
    title: 'Delete Experiment?',
    message: `Are you sure you want to delete "${e.name}"? This cannot be undone.`,
    confirmText: 'Delete',
    cancelText: 'Cancel',
    showCancel: true,
    confirmClass: 'btn-danger',
  });
  if (confirmed) {
    try {
      await store.dispatch('experiments/deleteExperiment', e.id);
      if (selectedExperiment.value?.id === e.id) selectedExperiment.value = null;
    } catch (err) {
      console.error('Failed to delete experiment:', err);
    }
  }
};
const handlePanelAction = (action, data) => {
  if (action === 'navigate') emit('screen-change', data);
  else if (action === 'delete-experiment' && data) confirmDelete(data);
  else if (action === 'run-experiment' && data) runExperiment(data);
};
const initializeScreen = () => store.dispatch('experiments/fetchExperiments', { force: true });
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

/* Status Tabs */
.status-tabs {
  display: flex;
  gap: 4px;
  padding: 0 8px;
}
.status-tab {
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
.status-tab:hover {
  background: rgba(var(--green-rgb), 0.05);
  border-color: rgba(var(--green-rgb), 0.3);
}
.status-tab.active {
  background: rgba(var(--green-rgb), 0.1);
  border-color: rgba(var(--green-rgb), 0.5);
  color: var(--color-green);
}
.tab-count {
  background: rgba(var(--green-rgb), 0.1);
  padding: 1px 6px;
  border-radius: 10px;
  font-size: 0.85em;
}

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
.name-cell {
  font-weight: 500;
}
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
.status-badge.planned {
  background: rgba(150, 150, 150, 0.15);
  color: #999;
}
.status-badge.running {
  background: rgba(59, 130, 246, 0.15);
  color: #3b82f6;
}
.status-badge.completed {
  background: rgba(var(--green-rgb), 0.15);
  color: var(--color-green);
}
.status-badge.failed {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}
.delta-positive {
  color: var(--color-green);
  font-weight: 500;
}
.delta-negative {
  color: #ef4444;
  font-weight: 500;
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
  color: var(--color-grey);
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
</style>
