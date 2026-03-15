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
          title="EVOLUTION"
          :count="activeViewCount"
          :countLabel="activeView"
          :searchPlaceholder="`Search ${activeView}...`"
          :searchQuery="searchQuery"
          :currentLayout="currentLayout"
          :layoutOptions="['grid', 'table']"
          :showCollapseToggle="false"
          :showHideEmpty="false"
          :createLabel="createLabel"
          @update:searchQuery="(v) => (searchQuery = v)"
          @update:layout="(v) => (currentLayout = v)"
          @create="handleCreate"
        >
          <template #extra-buttons>
            <Tooltip text="Evolution Settings" width="auto">
              <button class="wm-btn" @click="openSettings">
                <i class="fas fa-cog"></i>
              </button>
            </Tooltip>
          </template>
        </ScreenToolbar>

        <!-- View switcher + filter tabs -->
        <div class="tab-bar">
          <div class="view-tabs">
            <button class="view-tab" :class="{ active: activeView === 'insights' }" @click="switchView('insights')">
              <i class="fas fa-lightbulb"></i> Insights
              <span class="tab-count" :class="{ 'has-pending': pendingInsightCount > 0 }">{{ insights.length }}</span>
            </button>
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

          <!-- Insight filter tabs -->
          <div v-if="activeView === 'insights'" class="status-tabs">
            <button
              v-for="tab in insightStatusTabs"
              :key="tab.value"
              class="status-tab"
              :class="{ active: activeInsightStatus === tab.value }"
              @click="activeInsightStatus = tab.value"
            >
              {{ tab.label }}
              <span class="tab-count">{{ getInsightStatusCount(tab.value) }}</span>
            </button>
            <div class="tab-sep"></div>
            <button
              v-for="tab in insightTargetTabs"
              :key="tab.value"
              class="status-tab"
              :class="{ active: activeInsightTarget === tab.value }"
              @click="activeInsightTarget = tab.value"
            >
              <i :class="tab.icon"></i> {{ tab.label }}
            </button>
          </div>

          <!-- Status filter tabs (experiments view) -->
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

          <!-- Source filter tabs (datasets view) -->
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

        <!-- ═══ INSIGHTS VIEW ═══ -->
        <template v-if="activeView === 'insights'">
          <!-- Stats bar -->
          <div v-if="insightStats" class="insights-stats-bar">
            <div class="stat-chip">
              <span class="stat-num pending-num">{{ insightStats.statusCounts?.pending || 0 }}</span>
              <span class="stat-txt">pending</span>
            </div>
            <div class="stat-chip">
              <span class="stat-num applied-num">{{ insightStats.statusCounts?.applied || 0 }}</span>
              <span class="stat-txt">applied</span>
            </div>
            <div class="stat-chip">
              <span class="stat-num rejected-num">{{ insightStats.statusCounts?.rejected || 0 }}</span>
              <span class="stat-txt">rejected</span>
            </div>
            <div class="stat-sep"></div>
            <div v-for="(count, type) in insightStats.targetCounts" :key="type" class="stat-chip target-chip">
              <span class="stat-num">{{ count }}</span>
              <span class="stat-txt">{{ type }}</span>
            </div>
            <div class="stat-actions">
              <Tooltip text="Analyze recent tool usage patterns">
                <button class="stat-btn" @click="triggerRollup" :disabled="rollingUp">
                  <i :class="rollingUp ? 'fas fa-spinner fa-spin' : 'fas fa-sync-alt'"></i> Rollup
                </button>
              </Tooltip>
            </div>
          </div>

          <!-- Grid Layout -->
          <div v-if="filteredInsights.length > 0 && currentLayout === 'grid'" class="experiments-grid">
            <InsightCard
              v-for="ins in filteredInsights"
              :key="ins.id"
              :insight="ins"
              :selected="selectedInsight?.id === ins.id"
              @click="selectInsight(ins)"
              @apply="applyInsight(ins)"
              @reject="rejectInsight(ins)"
              @delete="confirmDeleteInsight(ins)"
            />
          </div>

          <!-- Table Layout -->
          <div v-if="filteredInsights.length > 0 && currentLayout === 'table'" class="experiments-table-container">
            <table class="experiments-table">
              <thead>
                <tr><th>Title</th><th>Category</th><th>Target</th><th>Confidence</th><th>Status</th><th>Seen</th><th></th></tr>
              </thead>
              <tbody>
                <tr
                  v-for="ins in filteredInsights"
                  :key="ins.id"
                  :class="{ selected: selectedInsight?.id === ins.id }"
                  @click="selectInsight(ins)"
                >
                  <td class="name-cell">{{ ins.title }}</td>
                  <td><span class="type-badge" :class="ins.category">{{ formatCategory(ins.category) }}</span></td>
                  <td><span class="target-chip-sm"><i :class="targetIcon(ins.target_type)"></i> {{ ins.target_type }}</span></td>
                  <td>
                    <div class="conf-cell">
                      <div class="conf-bar"><div class="conf-fill" :style="{ width: (ins.confidence * 100) + '%' }"></div></div>
                      <span>{{ Math.round(ins.confidence * 100) }}%</span>
                    </div>
                  </td>
                  <td><span class="status-badge" :class="ins.status">{{ ins.status }}</span></td>
                  <td>{{ ins.occurrence_count }}x</td>
                  <td class="actions-cell" @click.stop>
                    <button v-if="ins.status === 'pending'" class="row-btn apply" @click="applyInsight(ins)" title="Apply"><i class="fas fa-check"></i></button>
                    <button v-if="ins.status === 'pending'" class="row-btn reject" @click="rejectInsight(ins)" title="Reject"><i class="fas fa-times"></i></button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Empty -->
          <div v-if="filteredInsights.length === 0" class="empty-state-container">
            <div class="empty-state">
              <i class="fas fa-lightbulb"></i>
              <p>No insights yet</p>
              <span class="empty-hint">Insights are automatically extracted when you chat with agents, complete goals, or run workflows.</span>
            </div>
          </div>
        </template>

        <!-- ═══ EXPERIMENTS VIEW ═══ -->
        <template v-if="activeView === 'experiments'">
          <!-- Insights detail (shown when experiment selected) -->
          <div v-if="selectedExperiment && selectedExperiment.status === 'completed'" class="insights-bar">
            <div class="insights-bar-stats">
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

      <!-- ═══ EVOLUTION SETTINGS MODAL ═══ -->
      <Teleport to="body">
        <div v-if="showSettingsModal" class="modal-overlay" @click.self="showSettingsModal = false">
          <div class="modal-content">
            <div class="modal-header">
              <h3><i class="fas fa-cog settings-icon"></i> Evolution Settings</h3>
              <button class="modal-close" @click="showSettingsModal = false"><i class="fas fa-times"></i></button>
            </div>
            <div class="modal-body">
              <!-- Master toggle -->
              <div class="settings-group">
                <div class="setting-row master-row">
                  <div class="setting-info">
                    <span class="setting-label">Automated Insights</span>
                    <span class="setting-desc">Extract insights from traces automatically</span>
                  </div>
                  <label class="toggle-switch">
                    <input type="checkbox" :checked="settingsForm.insightsEnabled" @change="settingsForm.insightsEnabled = $event.target.checked" />
                    <span class="toggle-slider"></span>
                  </label>
                </div>
              </div>

              <!-- Source toggles -->
              <div class="settings-group" :class="{ disabled: !settingsForm.insightsEnabled }">
                <div class="settings-group-title">Insight Sources</div>
                <div class="setting-row">
                  <div class="setting-info">
                    <span class="setting-label"><i class="fas fa-comments"></i> Agent Chats</span>
                    <span class="setting-desc">Analyze agent conversations for patterns, memory, and prompt refinements</span>
                  </div>
                  <label class="toggle-switch">
                    <input type="checkbox" :checked="settingsForm.insightSources.agent_chat" :disabled="!settingsForm.insightsEnabled" @change="settingsForm.insightSources.agent_chat = $event.target.checked" />
                    <span class="toggle-slider"></span>
                  </label>
                </div>
                <div class="setting-row">
                  <div class="setting-info">
                    <span class="setting-label"><i class="fas fa-bullseye"></i> Goals</span>
                    <span class="setting-desc">Extract patterns and antipatterns from completed goals</span>
                  </div>
                  <label class="toggle-switch">
                    <input type="checkbox" :checked="settingsForm.insightSources.goal" :disabled="!settingsForm.insightsEnabled" @change="settingsForm.insightSources.goal = $event.target.checked" />
                    <span class="toggle-slider"></span>
                  </label>
                </div>
                <div class="setting-row">
                  <div class="setting-info">
                    <span class="setting-label"><i class="fas fa-project-diagram"></i> Workflows</span>
                    <span class="setting-desc">Identify bottlenecks and optimization opportunities in workflow runs</span>
                  </div>
                  <label class="toggle-switch">
                    <input type="checkbox" :checked="settingsForm.insightSources.workflow" :disabled="!settingsForm.insightsEnabled" @change="settingsForm.insightSources.workflow = $event.target.checked" />
                    <span class="toggle-slider"></span>
                  </label>
                </div>
                <div class="setting-row">
                  <div class="setting-info">
                    <span class="setting-label"><i class="fas fa-wrench"></i> Tool Usage Rollups</span>
                    <span class="setting-desc">Aggregate tool failure rates and usage patterns periodically</span>
                  </div>
                  <label class="toggle-switch">
                    <input type="checkbox" :checked="settingsForm.insightSources.tool_rollup" :disabled="!settingsForm.insightsEnabled" @change="settingsForm.insightSources.tool_rollup = $event.target.checked" />
                    <span class="toggle-slider"></span>
                  </label>
                </div>
              </div>

              <!-- Auto-apply -->
              <div class="settings-group" :class="{ disabled: !settingsForm.insightsEnabled }">
                <div class="settings-group-title">Automation</div>
                <div class="setting-row">
                  <div class="setting-info">
                    <span class="setting-label"><i class="fas fa-brain"></i> Auto-apply Memory Insights</span>
                    <span class="setting-desc">Automatically store extracted memory facts to agent memory</span>
                  </div>
                  <label class="toggle-switch">
                    <input type="checkbox" :checked="settingsForm.autoApplyMemory" :disabled="!settingsForm.insightsEnabled" @change="settingsForm.autoApplyMemory = $event.target.checked" />
                    <span class="toggle-slider"></span>
                  </label>
                </div>
              </div>
            </div>
            <div class="modal-footer">
              <button class="modal-btn cancel" @click="showSettingsModal = false">Cancel</button>
              <button class="modal-btn save" :disabled="savingSettings" @click="saveSettings">
                <i :class="savingSettings ? 'fas fa-spinner fa-spin' : 'fas fa-check'"></i>
                {{ savingSettings ? 'Saving...' : 'Save' }}
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
import { ref, computed, onMounted, watch } from 'vue';
import { useStore } from 'vuex';
import { useRoute, useRouter } from 'vue-router';
import BaseScreen from '@/views/Terminal/CenterPanel/BaseScreen.vue';
import ScreenToolbar from '@/views/Terminal/_components/ScreenToolbar.vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import ExperimentCard from './_components/ExperimentCard.vue';
import InsightCard from './_components/InsightCard.vue';
import DatasetCard from '../EvalDatasets/_components/DatasetCard.vue';

const store = useStore();
const route = useRoute();
const router = useRouter();
const emit = defineEmits(['screen-change']);
const simpleModal = ref(null);

// View state
const activeView = ref('insights');
const searchQuery = ref('');
const activeStatusTab = ref('all');
const activeSourceTab = ref('all');
const activeInsightStatus = ref('all');
const activeInsightTarget = ref('all');
const currentLayout = ref('grid');
const selectedExperiment = ref(null);
const selectedDataset = ref(null);
const selectedInsight = ref(null);

// Modals
const showForgeModal = ref(false);
const showGenerateModal = ref(false);
const showSettingsModal = ref(false);
const launching = ref(false);
const generating = ref(false);
const rollingUp = ref(false);
const savingSettings = ref(false);

// Settings form
const settingsForm = ref({
  insightsEnabled: false,
  insightSources: { agent_chat: true, goal: true, workflow: true, tool_rollup: true },
  autoApplyMemory: true,
});

// Forge form
const forgeForm = ref({
  name: '', hypothesis: '', type: 'ab_test', skillId: '', goalId: '', datasetId: '',
  maxIterations: 5, runsPerExample: 3, minDelta: 0.05,
});

// Generate form
const generateForm = ref({ skillId: '', source: 'synthetic', category: '' });

// Tabs
const insightStatusTabs = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'applied', label: 'Applied' },
  { value: 'rejected', label: 'Rejected' },
];

const insightTargetTabs = [
  { value: 'all', label: 'All', icon: 'fas fa-globe' },
  { value: 'agent', label: 'Agent', icon: 'fas fa-robot' },
  { value: 'skill', label: 'Skill', icon: 'fas fa-puzzle-piece' },
  { value: 'workflow', label: 'Workflow', icon: 'fas fa-project-diagram' },
  { value: 'tool', label: 'Tool', icon: 'fas fa-wrench' },
];

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
const insights = computed(() => store.getters['insights/allInsights'] || []);
const insightStats = computed(() => store.getters['insights/stats']);
const pendingInsightCount = computed(() => store.getters['insights/pendingCount']);
const availableSkills = computed(() => store.getters['skills/allSkills'] || []);
const availableGoals = computed(() => store.getters['goals/allGoals'] || []);

// Dynamic toolbar
const activeViewCount = computed(() => {
  if (activeView.value === 'insights') return filteredInsights.value.length;
  if (activeView.value === 'experiments') return filteredExperiments.value.length;
  return filteredDatasets.value.length;
});

const createLabel = computed(() => {
  if (activeView.value === 'experiments') return 'New Experiment';
  if (activeView.value === 'datasets') return 'Generate Dataset';
  return null;
});

// Filtered data
const filteredInsights = computed(() => {
  let result = insights.value;
  if (activeInsightStatus.value !== 'all') result = result.filter((i) => i.status === activeInsightStatus.value);
  if (activeInsightTarget.value !== 'all') result = result.filter((i) => i.target_type === activeInsightTarget.value);
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase();
    result = result.filter((i) => i.title?.toLowerCase().includes(q) || i.description?.toLowerCase().includes(q) || i.category?.toLowerCase().includes(q));
  }
  return [...result].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
});

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
  selectedInsight: activeView.value === 'insights' ? selectedInsight.value : null,
}));
const leftPanelProps = computed(() => ({
  experiments: experiments.value,
  activeTab: activeStatusTab.value,
  insightStats: insightStats.value,
  pendingInsightCount: pendingInsightCount.value,
}));
const canLaunch = computed(() => forgeForm.value.name?.trim() && forgeForm.value.skillId);

const getTabCount = (s) => s === 'all' ? experiments.value.length : experiments.value.filter((e) => e.status === s).length;
const getSourceCount = (s) => s === 'all' ? datasets.value.length : datasets.value.filter((d) => (d.source || 'manual') === s).length;
const getInsightStatusCount = (s) => s === 'all' ? insights.value.length : insights.value.filter((i) => i.status === s).length;

const formatDate = (d) => {
  if (!d) return '-';
  const diff = Date.now() - new Date(d);
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return new Date(d).toLocaleDateString();
};

const truncate = (text, max) => (!text ? '' : text.length > max ? text.slice(0, max) + '...' : text);
const formatCategory = (c) => (c || '').replace(/_/g, ' ');
const targetIcon = (t) => ({ agent: 'fas fa-robot', skill: 'fas fa-puzzle-piece', workflow: 'fas fa-project-diagram', tool: 'fas fa-wrench' }[t] || 'fas fa-cube');

const switchView = (view) => {
  activeView.value = view;
  searchQuery.value = '';
};

const handleCreate = () => {
  if (activeView.value === 'experiments') showForgeModal.value = true;
  else if (activeView.value === 'datasets') showGenerateModal.value = true;
};

// ═══ INSIGHT ACTIONS ═══

const selectInsight = (ins) => {
  selectedInsight.value = selectedInsight.value?.id === ins.id ? null : ins;
};

const applyInsight = async (ins) => {
  try {
    await store.dispatch('insights/applyInsight', ins.id);
    if (selectedInsight.value?.id === ins.id) selectedInsight.value = { ...ins, status: 'applied' };
  } catch (err) {
    console.error('Failed to apply insight:', err);
  }
};

const rejectInsight = async (ins) => {
  try {
    await store.dispatch('insights/rejectInsight', ins.id);
    if (selectedInsight.value?.id === ins.id) selectedInsight.value = { ...ins, status: 'rejected' };
  } catch (err) {
    console.error('Failed to reject insight:', err);
  }
};

const confirmDeleteInsight = async (ins) => {
  const confirmed = await simpleModal.value?.showModal({
    title: 'Delete Insight?',
    message: `Are you sure you want to delete "${ins.title}"? This cannot be undone.`,
    confirmText: 'Delete', cancelText: 'Cancel', showCancel: true, confirmClass: 'btn-danger',
  });
  if (confirmed) {
    try {
      await store.dispatch('insights/deleteInsight', ins.id);
      if (selectedInsight.value?.id === ins.id) selectedInsight.value = null;
    } catch (err) { console.error('Failed to delete insight:', err); }
  }
};

const triggerRollup = async () => {
  if (rollingUp.value) return;
  rollingUp.value = true;
  try {
    await store.dispatch('insights/triggerRollup');
  } catch (err) {
    console.error('Rollup failed:', err);
  } finally {
    rollingUp.value = false;
  }
};

// ═══ SETTINGS ═══

const openSettings = async () => {
  const settings = await store.dispatch('insights/fetchEvolutionSettings');
  if (settings) {
    settingsForm.value = {
      insightsEnabled: settings.insightsEnabled ?? true,
      insightSources: { ...settings.insightSources },
      autoApplyMemory: settings.autoApplyMemory ?? true,
    };
  }
  showSettingsModal.value = true;
};

const saveSettings = async () => {
  if (savingSettings.value) return;
  savingSettings.value = true;
  try {
    await store.dispatch('insights/updateEvolutionSettings', settingsForm.value);
    showSettingsModal.value = false;
  } catch (err) {
    console.error('Failed to save settings:', err);
  } finally {
    savingSettings.value = false;
  }
};

// ═══ EXPERIMENT ACTIONS ═══

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
  else if (action === 'navigate-to-trace') emit('screen-change', 'TracesScreen', { selectedExecutionId: data?.sourceId });
  else if (action === 'delete-experiment' && data) confirmDeleteExperiment(data);
  else if (action === 'run-experiment' && data) runExperiment(data);
  else if (action === 'delete-dataset' && data) confirmDeleteDataset(data);
  else if (action === 'apply-insight' && data) applyInsight(data);
  else if (action === 'reject-insight' && data) rejectInsight(data);
  else if (action === 'delete-insight' && data) confirmDeleteInsight(data);
};

const initializeScreen = () => {
  store.dispatch('experiments/fetchExperiments', { force: true });
  store.dispatch('experiments/fetchEvalDatasets', { force: false });
  store.dispatch('insights/fetchInsights');
  store.dispatch('insights/fetchStats');
  store.dispatch('skills/fetchSkills');
  store.dispatch('goals/fetchGoals');
};

// Auto-select insight from query param (e.g. navigating from traces)
watch(
  () => route.query.insightId,
  async (insightId) => {
    if (!insightId || route.path !== '/experiments') return;
    activeView.value = 'insights';
    // Wait for insights to load
    await store.dispatch('insights/fetchInsights');
    const insights = store.getters['insights/allInsights'];
    const insight = insights.find(i => i.id === insightId);
    if (insight) {
      selectedInsight.value = insight;
    }
    router.replace({ path: '/experiments', query: {} });
  },
  { immediate: true }
);

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
  flex-wrap: wrap;
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
  align-items: center;
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
.tab-count.has-pending {
  background: rgba(245, 158, 11, 0.2);
  color: #f59e0b;
}

/* Insights stats bar */
.insights-stats-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: rgba(var(--green-rgb), 0.03);
  border-bottom: 1px solid rgba(var(--green-rgb), 0.1);
  flex-shrink: 0;
  flex-wrap: wrap;
}
.stat-chip {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  background: rgba(0, 0, 0, 0.15);
  border-radius: 4px;
  font-size: 0.8em;
}
.stat-num {
  font-weight: 600;
  color: var(--color-text);
}
.stat-num.pending-num { color: #f59e0b; }
.stat-num.applied-num { color: var(--color-green); }
.stat-num.rejected-num { color: #ef4444; }
.stat-txt {
  color: var(--color-grey);
  font-size: 0.9em;
}
.stat-sep {
  width: 1px;
  height: 16px;
  background: var(--terminal-border-color);
}
.target-chip .stat-num {
  color: var(--color-primary);
}
.stat-actions {
  margin-left: auto;
}
.stat-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  background: rgba(var(--green-rgb), 0.08);
  border: 1px solid rgba(var(--green-rgb), 0.2);
  border-radius: 4px;
  color: var(--color-grey);
  cursor: pointer;
  font-size: 0.78em;
  transition: all 0.2s;
}
.stat-btn:hover:not(:disabled) {
  color: var(--color-green);
  border-color: rgba(var(--green-rgb), 0.4);
  background: rgba(var(--green-rgb), 0.15);
}
.stat-btn:disabled { opacity: 0.5; cursor: not-allowed; }

/* Insights bar (experiment selected) */
.insights-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  background: rgba(var(--green-rgb), 0.04);
  border-bottom: 1px solid rgba(var(--green-rgb), 0.15);
  flex-shrink: 0;
}
.insights-bar-stats {
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
  text-transform: capitalize;
}
.type-badge.pattern { background: rgba(var(--green-rgb), 0.1); color: var(--color-green); }
.type-badge.antipattern { background: rgba(239, 68, 68, 0.1); color: #ef4444; }
.type-badge.prompt_refinement { background: rgba(168, 85, 247, 0.1); color: #a855f7; }
.type-badge.skill_recommendation { background: rgba(59, 130, 246, 0.1); color: #3b82f6; }
.type-badge.memory { background: rgba(236, 72, 153, 0.1); color: #ec4899; }
.type-badge.bottleneck { background: rgba(245, 158, 11, 0.1); color: #f59e0b; }
.type-badge.parameter_tune { background: rgba(20, 184, 166, 0.1); color: #14b8a6; }
.type-badge.tool_preference { background: rgba(99, 102, 241, 0.1); color: #6366f1; }
.target-chip-sm {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.85em;
  color: var(--color-grey);
  text-transform: capitalize;
}
.target-chip-sm i { font-size: 0.9em; }
.conf-cell {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.85em;
}
.conf-bar {
  width: 50px;
  height: 4px;
  background: rgba(var(--green-rgb), 0.1);
  border-radius: 2px;
  overflow: hidden;
}
.conf-fill {
  height: 100%;
  background: var(--color-green);
  border-radius: 2px;
}
.actions-cell {
  display: flex;
  gap: 4px;
}
.row-btn {
  background: none;
  border: 1px solid transparent;
  color: var(--color-grey);
  width: 26px;
  height: 26px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 0.75em;
  transition: all 0.15s;
}
.row-btn.apply:hover { color: var(--color-green); background: rgba(var(--green-rgb), 0.1); border-color: rgba(var(--green-rgb), 0.3); }
.row-btn.reject:hover { color: #f59e0b; background: rgba(245, 158, 11, 0.1); border-color: rgba(245, 158, 11, 0.3); }

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
.status-badge.pending { background: rgba(245, 158, 11, 0.15); color: #f59e0b; }
.status-badge.applied { background: rgba(var(--green-rgb), 0.15); color: var(--color-green); }
.status-badge.rejected { background: rgba(239, 68, 68, 0.15); color: #ef4444; }
.status-badge.superseded { background: rgba(150, 150, 150, 0.15); color: #999; }
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
.empty-state p { margin: 16px 0 4px; font-size: 1.1em; }
.empty-hint { font-size: 0.85em; color: var(--color-grey); opacity: 0.7; }
.empty-state-buttons { display: flex; gap: 12px; justify-content: center; margin-top: 12px; }
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

/* ── Settings Modal ── */
.settings-icon {
  color: var(--color-grey);
  margin-right: 4px;
  font-size: 0.9em;
}
.settings-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
  transition: opacity 0.2s;
}
.settings-group.disabled {
  opacity: 0.45;
  pointer-events: none;
}
.settings-group-title {
  font-size: 0.7em;
  color: var(--color-grey);
  text-transform: uppercase;
  letter-spacing: 1px;
  padding: 4px 0 6px;
  border-bottom: 1px solid var(--terminal-border-color);
  margin-bottom: 4px;
}
.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 8px;
  border-radius: 6px;
  transition: background 0.15s;
}
.setting-row:hover {
  background: rgba(var(--green-rgb), 0.03);
}
.setting-row.master-row {
  padding: 12px 8px;
}
.setting-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}
.setting-label {
  font-size: 0.9em;
  color: var(--color-text);
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 6px;
}
.setting-label i {
  font-size: 0.85em;
  color: var(--color-grey);
  width: 16px;
  text-align: center;
}
.setting-desc {
  font-size: 0.75em;
  color: var(--color-grey);
  line-height: 1.3;
}

/* Toggle switch */
.toggle-switch {
  position: relative;
  display: inline-block;
  width: 36px;
  height: 20px;
  flex-shrink: 0;
  margin-left: 12px;
}
.toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}
.toggle-slider {
  position: absolute;
  cursor: pointer;
  inset: 0;
  background: rgba(150, 150, 150, 0.25);
  border-radius: 20px;
  transition: all 0.2s;
}
.toggle-slider::before {
  content: '';
  position: absolute;
  height: 14px;
  width: 14px;
  left: 3px;
  bottom: 3px;
  background: var(--color-grey);
  border-radius: 50%;
  transition: all 0.2s;
}
.toggle-switch input:checked + .toggle-slider {
  background: rgba(var(--green-rgb), 0.35);
}
.toggle-switch input:checked + .toggle-slider::before {
  transform: translateX(16px);
  background: var(--color-green);
}
.toggle-switch input:disabled + .toggle-slider {
  cursor: not-allowed;
  opacity: 0.5;
}
</style>
