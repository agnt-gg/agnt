<!-- Skills.vue — Consolidated Skills + SkillForge -->
<template>
  <BaseScreen
    ref="baseScreenRef"
    screenId="SkillsScreen"
    activeRightPanel="SkillsPanel"
    activeLeftPanel="SkillsPanel"
    :panelProps="panelProps"
    :leftPanelProps="leftPanelProps"
    :showInput="false"
    :terminalLines="terminalLines"
    @panel-action="handlePanelAction"
    @screen-change="(screenName) => emit('screen-change', screenName)"
    @base-mounted="initializeScreen"
  >
    <template #default>
      <div class="skills-screen">
        <ScreenToolbar
          :title="activeView === 'skills' ? 'SKILLS' : 'EVOLUTION'"
          :count="activeView === 'skills' ? filteredSkills.length : leaderboard.length"
          :countLabel="activeView === 'skills' ? 'skills' : 'evolved skills'"
          searchPlaceholder="Search skills..."
          :searchQuery="searchQuery"
          :currentLayout="'grid'"
          :layoutOptions="[]"
          :showCollapseToggle="false"
          :showHideEmpty="false"
          :createLabel="activeView === 'skills' ? 'New Skill' : ''"
          @update:searchQuery="(v) => (searchQuery = v)"
          @create="openCreateModal"
        >
          <template v-if="activeView === 'skills'" #extra-buttons>
            <Tooltip text="Import SKILL.md"><button class="import-btn" @click="triggerImport"><i class="fas fa-file-import"></i> Import</button></Tooltip>
          </template>
        </ScreenToolbar>
        <input ref="importFileInput" type="file" accept=".md" style="display: none" @change="handleImportFile" />

        <!-- View switcher -->
        <div class="tab-bar">
          <div class="view-tabs">
            <button class="view-tab" :class="{ active: activeView === 'skills' }" @click="activeView = 'skills'">
              <i class="fas fa-puzzle-piece"></i> Skills
              <span class="tab-count">{{ allSkills.length }}</span>
            </button>
            <button class="view-tab" :class="{ active: activeView === 'evolution' }" @click="switchToEvolution">
              <i class="fas fa-dna"></i> Evolution
              <span class="tab-count">{{ leaderboard.length }}</span>
            </button>
          </div>
        </div>

        <!-- ═══ SKILLS VIEW ═══ -->
        <template v-if="activeView === 'skills'">
          <div v-if="filteredSkills.length > 0" class="skills-grid">
            <div
              v-for="skill in filteredSkills"
              :key="skill.id"
              class="skill-card"
              :class="{ selected: selectedSkill?.id === skill.id }"
              @click="selectSkill(skill)"
            >
              <div class="card-header">
                <span class="card-icon"><i :class="skill.icon || 'fas fa-puzzle-piece'"></i></span>
                <div class="card-title-block">
                  <span class="card-name">{{ skill.name }}</span>
                  <span class="card-category">{{ skill.category || 'general' }}</span>
                </div>
                <div class="card-actions">
                  <Tooltip text="Edit"><button class="card-btn edit" @click.stop="openEditModal(skill)"><i class="fas fa-pen"></i></button></Tooltip>
                  <Tooltip text="Delete"><button class="card-btn delete" @click.stop="confirmDelete(skill)"><i class="fas fa-trash"></i></button></Tooltip>
                </div>
              </div>
              <p class="card-description">{{ skill.description }}</p>
              <div v-if="skill.instructions" class="card-instructions">
                <span class="instructions-label">Instructions</span>
                <p class="instructions-preview">{{ truncate(skill.instructions, 150) }}</p>
              </div>
            </div>
          </div>

          <div v-else class="empty-state-container">
            <div class="empty-state">
              <i class="fas fa-brain"></i>
              <p>No skills found</p>
              <div class="empty-state-buttons">
                <button class="create-button" @click="openCreateModal"><i class="fas fa-plus"></i> Create Skill</button>
              </div>
            </div>
          </div>
        </template>

        <!-- ═══ EVOLUTION VIEW (SkillForge) ═══ -->
        <template v-if="activeView === 'evolution'">
          <!-- Evolution sub-tabs -->
          <div class="sf-tabs">
            <button v-for="tab in forgeTabs" :key="tab.id" class="sf-tab" :class="{ active: forgeTab === tab.id }" @click="forgeTab = tab.id">
              <i :class="tab.icon"></i> {{ tab.label }}
            </button>
          </div>

          <!-- Dashboard -->
          <div v-if="forgeTab === 'dashboard'" class="sf-content">
            <div class="stats-row">
              <div class="stat-card">
                <div class="stat-value">{{ forgeStats?.totalEvaluations || 0 }}</div>
                <div class="stat-label">A/B Tests</div>
              </div>
              <div class="stat-card">
                <div class="stat-value">{{ forgeStats?.skillsKept || 0 }}</div>
                <div class="stat-label">Kept</div>
              </div>
              <div class="stat-card">
                <div class="stat-value">{{ forgeStats?.skillsDiscarded || 0 }}</div>
                <div class="stat-label">Discarded</div>
              </div>
              <div class="stat-card accent">
                <div class="stat-value">{{ forgeStats?.skillsPromoted || 0 }}</div>
                <div class="stat-label">Gold</div>
              </div>
              <div class="stat-card">
                <div class="stat-value">{{ formatDelta(forgeStats?.averageDelta) }}</div>
                <div class="stat-label">Avg Delta</div>
              </div>
              <div class="stat-card">
                <div class="stat-value">{{ formatPercent(forgeStats?.winRate) }}</div>
                <div class="stat-label">Win Rate</div>
              </div>
            </div>

            <div class="section-header"><h3><i class="fas fa-trophy"></i> Leaderboard</h3></div>
            <div v-if="filteredLeaderboard.length > 0" class="leaderboard-list">
              <div v-for="(skill, idx) in filteredLeaderboard" :key="skill.skill_id" class="leaderboard-item" @click="viewSkillDetail(skill)">
                <span class="lb-rank">#{{ idx + 1 }}</span>
                <div class="lb-info">
                  <span class="lb-name">{{ skill.skill_name }}</span>
                  <span class="lb-category">{{ skill.category }}</span>
                </div>
                <div class="lb-stats">
                  <span class="lb-metric" :class="deltaClass(skill.avg_delta)">{{ formatDelta(skill.avg_delta) }} SES</span>
                  <span class="lb-metric-sub">{{ formatPercent(skill.win_rate) }} win &middot; {{ skill.total_evaluations }} tests</span>
                </div>
              </div>
            </div>
            <div v-else class="empty-state-container">
              <div class="empty-state">
                <i class="fas fa-flask"></i>
                <p>No evolved skills yet</p>
                <span class="empty-hint">Complete goals to generate skill candidates.</span>
              </div>
            </div>
          </div>

          <!-- A/B Tests -->
          <div v-if="forgeTab === 'evaluations'" class="sf-content">
            <div v-if="evaluations.length > 0" class="evals-list">
              <div v-for="ev in evaluations" :key="ev.id" class="eval-card" :class="{ kept: ev.decision === 'kept' || ev.decision === 'promoted', discarded: ev.decision === 'discarded' }">
                <div class="eval-header">
                  <span class="eval-decision" :class="ev.decision"><i :class="decisionIcon(ev.decision)"></i> {{ ev.decision?.toUpperCase() }}</span>
                  <span class="eval-date">{{ formatFullDate(ev.created_at) }}</span>
                </div>
                <div class="eval-metrics">
                  <div class="eval-metric"><span class="metric-label">Baseline</span><span class="metric-value">{{ ev.baseline_ses != null ? ev.baseline_ses.toFixed(1) : 'N/A' }}</span></div>
                  <div class="eval-metric"><span class="metric-label">Treatment</span><span class="metric-value">{{ ev.treatment_ses != null ? ev.treatment_ses.toFixed(1) : 'N/A' }}</span></div>
                  <div class="eval-metric"><span class="metric-label">Delta</span><span class="metric-value" :class="deltaClass(ev.delta)">{{ formatDelta(ev.delta) }}</span></div>
                </div>
                <p v-if="ev.judge_reasoning" class="eval-reasoning">{{ ev.judge_reasoning }}</p>
              </div>
            </div>
            <div v-else class="empty-state-container">
              <div class="empty-state"><i class="fas fa-vial"></i><p>No A/B tests recorded yet</p></div>
            </div>
          </div>

          <!-- Forge -->
          <div v-if="forgeTab === 'forge'" class="sf-content">
            <div class="forge-section">
              <h3><i class="fas fa-dna"></i> Forge Skills from Goals</h3>
              <p class="forge-desc">Select a completed goal to analyze its trace and forge a skill.</p>
              <div class="forge-filters">
                <input v-model="goalSearch" class="form-input" placeholder="Search goals..." />
                <button class="filter-btn" :class="{ active: showEligibleOnly }" @click="showEligibleOnly = !showEligibleOnly">
                  <i class="fas fa-filter"></i> Eligible Only
                </button>
                <button class="filter-btn" @click="refreshGoals">
                  <i :class="isLoadingGoals ? 'fas fa-spinner fa-spin' : 'fas fa-sync-alt'"></i>
                </button>
              </div>
              <div v-if="isLoadingGoals" class="loading-state"><i class="fas fa-spinner fa-spin"></i> Loading goals...</div>
              <div v-else-if="filteredGoals.length > 0" class="goals-list">
                <div v-for="goal in filteredGoals" :key="goal.id" class="goal-card" :class="{ selected: selectedGoal?.id === goal.id, eligible: goal.eligible, ineligible: !goal.eligible }" @click="selectGoal(goal)">
                  <div class="goal-header">
                    <span class="goal-title">{{ goal.title }}</span>
                    <span v-if="goal.eligible" class="badge eligible"><i class="fas fa-check"></i></span>
                    <span v-else class="badge ineligible"><i class="fas fa-times"></i></span>
                  </div>
                  <div class="goal-metrics">
                    <span class="goal-metric"><i class="fas fa-star"></i> {{ goal.eval_score != null ? Math.round(goal.eval_score) + '%' : 'N/A' }}</span>
                    <span class="goal-metric"><i class="fas fa-tasks"></i> {{ goal.completed_tasks }}/{{ goal.task_count }}</span>
                    <span class="goal-metric"><i class="fas fa-redo"></i> {{ goal.iteration_count }} iters</span>
                  </div>
                </div>
              </div>
              <div v-else class="empty-state-container"><div class="empty-state"><i class="fas fa-flag-checkered"></i><p>No completed goals found</p></div></div>

              <div v-if="selectedGoal" class="selected-goal-actions">
                <div class="selected-goal-bar">
                  <span class="selected-name">{{ selectedGoal.title }}</span>
                  <div class="action-buttons">
                    <button class="forge-btn analyze" :disabled="isAnalyzing" @click="runAnalysis">
                      <i :class="isAnalyzing ? 'fas fa-spinner fa-spin' : 'fas fa-search'"></i> {{ isAnalyzing ? 'Analyzing...' : 'Analyze' }}
                    </button>
                    <button class="forge-btn primary" :disabled="!selectedGoal.eligible || isEvolving" @click="runEvolution">
                      <i :class="isEvolving ? 'fas fa-spinner fa-spin' : 'fas fa-hammer'"></i> {{ isEvolving ? 'Forging...' : 'Forge' }}
                    </button>
                  </div>
                </div>
              </div>

              <div v-if="lastAnalysis" class="result-panel">
                <h4><i class="fas fa-clipboard-check"></i> Trace Analysis</h4>
                <div v-if="lastAnalysis.analysis" class="analysis-content">
                  <div class="analysis-meta">
                    <span class="meta-badge" :class="lastAnalysis.analysis.traceQuality">{{ lastAnalysis.analysis.traceQuality }}</span>
                    <span class="meta-info">{{ lastAnalysis.analysis.patternCount || lastAnalysis.analysis.patterns?.length || 0 }} patterns</span>
                  </div>
                  <p class="analysis-summary">{{ lastAnalysis.analysis.overallAssessment }}</p>
                </div>
                <p v-else class="result-message">{{ lastAnalysis.message || 'No data.' }}</p>
              </div>
            </div>
          </div>
        </template>
      </div>

      <!-- Create/Edit Modal -->
      <Teleport to="body">
        <div v-if="showModal" class="modal-overlay" @click.self="closeModal">
          <div class="modal-content">
            <div class="modal-header">
              <h3>{{ isEditing ? 'Edit Skill' : 'Create Skill' }}</h3>
              <button class="modal-close" @click="closeModal"><i class="fas fa-times"></i></button>
            </div>
            <div class="modal-body">
              <div class="form-group">
                <label>Name <span class="required">*</span></label>
                <input v-model="form.name" class="form-input" placeholder="My Skill Name" />
              </div>
              <div class="form-group">
                <label>Description <span class="required">*</span></label>
                <textarea v-model="form.description" class="form-input" rows="2" placeholder="What does this skill do?"></textarea>
              </div>
              <div class="form-group">
                <label>Instructions</label>
                <textarea v-model="form.instructions" class="form-input mono" rows="8" placeholder="The prompt instructions injected into the agent's system prompt..."></textarea>
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label>Icon</label>
                  <div class="icon-grid">
                    <button v-for="ico in SKILL_ICONS" :key="ico" type="button" class="icon-btn" :class="{ active: form.icon === ico }" @click="form.icon = ico">
                      <i :class="ico"></i>
                    </button>
                  </div>
                </div>
                <div class="form-group">
                  <label>Category</label>
                  <BaseSelect v-model="form.category" :options="categoryOptions" placeholder="Select category" :zIndex="10001" />
                </div>
              </div>
            </div>
            <div v-if="modalError" class="modal-error"><i class="fas fa-exclamation-triangle"></i> {{ modalError }}</div>
            <div class="modal-footer">
              <button class="modal-btn cancel" @click="closeModal">Cancel</button>
              <button class="modal-btn save" @click="saveSkill" :disabled="!form.name || !form.description || saving">
                <i v-if="saving" class="fas fa-spinner fa-spin"></i>
                {{ isEditing ? 'Update' : 'Create' }}
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
import { ref, computed, onMounted, watch, reactive } from 'vue';
import { useStore } from 'vuex';
import BaseScreen from '@/views/Terminal/CenterPanel/BaseScreen.vue';
import ScreenToolbar from '@/views/Terminal/_components/ScreenToolbar.vue';
import BaseSelect from '@/views/Terminal/_components/BaseSelect.vue';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';

const SKILL_ICONS = [
  'fas fa-puzzle-piece', 'fas fa-chart-bar', 'fas fa-chart-line', 'fas fa-chart-pie',
  'fas fa-table', 'fas fa-hashtag', 'fas fa-clock', 'fas fa-rss',
  'fas fa-sticky-note', 'fas fa-code', 'fas fa-globe', 'fas fa-database',
  'fas fa-server', 'fas fa-bolt', 'fas fa-fire', 'fas fa-star',
  'fas fa-heart', 'fas fa-shield-alt', 'fas fa-rocket', 'fas fa-brain',
  'fas fa-cube', 'fas fa-cubes', 'fas fa-cog', 'fas fa-wrench',
  'fas fa-terminal', 'fas fa-palette', 'fas fa-image', 'fas fa-video',
  'fas fa-music', 'fas fa-bell', 'fas fa-envelope', 'fas fa-comments',
  'fas fa-users', 'fas fa-robot', 'fas fa-atom', 'fas fa-flask',
  'fas fa-gem', 'fas fa-crown', 'fas fa-leaf', 'fas fa-cloud',
];

const store = useStore();
const emit = defineEmits(['screen-change']);
const baseScreenRef = ref(null);
const simpleModal = ref(null);
const importFileInput = ref(null);

const terminalLines = ref(['Skills initialized.']);
const searchQuery = ref('');
const activeView = ref('skills');
const selectedSkill = ref(null);
const selectedCategory = ref(null);

// Create/Edit modal
const showModal = ref(false);
const isEditing = ref(false);
const editingId = ref(null);
const saving = ref(false);
const modalError = ref('');
const form = ref({ name: '', description: '', instructions: '', icon: 'fas fa-puzzle-piece', category: 'general' });

// SkillForge state
const forgeTab = ref('dashboard');
const selectedGoal = ref(null);
const goalSearch = ref('');
const showEligibleOnly = ref(false);

const forgeTabs = [
  { id: 'dashboard', label: 'Dashboard', icon: 'fas fa-chart-bar' },
  { id: 'evaluations', label: 'A/B Tests', icon: 'fas fa-vial' },
  { id: 'forge', label: 'Forge', icon: 'fas fa-hammer' },
];

// Skills data
const allSkills = computed(() => store.getters['skills/allSkills'] || []);
const panelProps = computed(() => ({ selectedSkill: selectedSkill.value }));
const leftPanelProps = computed(() => ({ allSkills: allSkills.value, selectedSkill: selectedSkill.value }));

const categoryOptions = computed(() => {
  const cats = store.getters['skills/skillCategories'] || [];
  return cats.map((cat) => ({ value: cat, label: cat.charAt(0).toUpperCase() + cat.slice(1) }));
});

const filteredSkills = computed(() => {
  let result = allSkills.value;
  if (selectedCategory.value) result = result.filter((s) => (s.category || 'general') === selectedCategory.value);
  const q = searchQuery.value.toLowerCase();
  if (q) result = result.filter((s) => s.name?.toLowerCase().includes(q) || s.description?.toLowerCase().includes(q) || s.category?.toLowerCase().includes(q));
  return result;
});

// SkillForge data
const forgeStats = computed(() => store.getters['skillforge/stats']);
const evaluations = computed(() => store.getters['skillforge/evaluations']);
const leaderboard = computed(() => store.getters['skillforge/leaderboard']);
const isAnalyzing = computed(() => store.getters['skillforge/isAnalyzing']);
const isEvolving = computed(() => store.getters['skillforge/isEvolving']);
const isLoadingGoals = computed(() => store.getters['skillforge/isLoadingGoals']);
const lastAnalysis = computed(() => store.getters['skillforge/lastAnalysis']);
const eligibleGoals = computed(() => store.getters['skillforge/eligibleGoals']);

const filteredLeaderboard = computed(() => {
  const q = searchQuery.value.toLowerCase();
  if (!q) return leaderboard.value;
  return leaderboard.value.filter((s) => s.skill_name?.toLowerCase().includes(q) || s.category?.toLowerCase().includes(q));
});

const filteredGoals = computed(() => {
  let goals = eligibleGoals.value || [];
  if (showEligibleOnly.value) goals = goals.filter((g) => g.eligible);
  const q = goalSearch.value.toLowerCase();
  if (q) goals = goals.filter((g) => g.title?.toLowerCase().includes(q) || g.description?.toLowerCase().includes(q));
  return goals;
});

// Load forge data when switching to evolution tab
watch(forgeTab, (tab) => {
  if (tab === 'forge' && eligibleGoals.value.length === 0) {
    store.dispatch('skillforge/fetchEligibleGoals');
  }
});

const switchToEvolution = () => {
  activeView.value = 'evolution';
  store.dispatch('skillforge/fetchStats');
  store.dispatch('skillforge/fetchLeaderboard');
  store.dispatch('skillforge/fetchEvaluations');
};

// Initialization
const initializeScreen = () => {
  store.dispatch('skills/fetchSkills');
};

const handlePanelAction = (action, payload) => {
  if (action === 'navigate') emit('screen-change', payload);
  else if (action === 'category-filter-changed') { selectedCategory.value = payload?.selectedCategory || null; selectedSkill.value = null; }
  else if (action === 'open-create-modal') openCreateModal();
  else if (action === 'open-edit-modal') openEditModal(payload);
  else if (action === 'export-skill') exportSkill(payload);
  else if (action === 'delete-skill') confirmDelete(payload);
};

const selectSkill = (skill) => { selectedSkill.value = selectedSkill.value?.id === skill.id ? null : skill; };

// CRUD
const openCreateModal = () => {
  isEditing.value = false; editingId.value = null; modalError.value = '';
  form.value = { name: '', description: '', instructions: '', icon: 'fas fa-puzzle-piece', category: 'general' };
  showModal.value = true;
};

const openEditModal = (skill) => {
  isEditing.value = true; editingId.value = skill.id; modalError.value = '';
  form.value = { name: skill.name || '', description: skill.description || '', instructions: skill.instructions || '', icon: skill.icon || 'fas fa-puzzle-piece', category: skill.category || 'general' };
  showModal.value = true;
};

const closeModal = () => { showModal.value = false; };

const saveSkill = async () => {
  modalError.value = '';
  if (!form.value.name?.trim() || !form.value.description?.trim()) { modalError.value = 'Name and description are required.'; return; }
  saving.value = true;
  try {
    if (isEditing.value) {
      await store.dispatch('skills/updateSkill', { id: editingId.value, skill: { ...form.value } });
      terminalLines.value.push(`[Skills] Updated "${form.value.name}".`);
    } else {
      const result = await store.dispatch('skills/createSkill', { ...form.value });
      terminalLines.value.push(`[Skills] Created "${form.value.name}".`);
      if (result?.skill) selectedSkill.value = result.skill;
    }
    closeModal();
    if (isEditing.value && selectedSkill.value?.id === editingId.value) {
      selectedSkill.value = allSkills.value.find((s) => s.id === editingId.value) || null;
    }
  } catch (err) {
    modalError.value = err.message || 'Failed to save skill.';
  } finally { saving.value = false; }
};

const confirmDelete = async (skill) => {
  const confirmed = await simpleModal.value?.showModal({
    title: 'Delete Skill?', message: `Delete "${skill.name}"? This cannot be undone.`,
    confirmText: 'Delete', cancelText: 'Cancel', showCancel: true, confirmClass: 'btn-danger',
  });
  if (confirmed) {
    try {
      await store.dispatch('skills/deleteSkill', skill.id);
      if (selectedSkill.value?.id === skill.id) selectedSkill.value = null;
    } catch (err) { console.error('Delete error:', err); }
  }
};

const exportSkill = async (skill) => {
  try {
    const content = await store.dispatch('skills/exportSkillMd', skill.id);
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${skill.name}.SKILL.md`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  } catch (err) { console.error('Export error:', err); }
};

const triggerImport = () => { importFileInput.value?.click(); };

const handleImportFile = async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const content = await file.text();
    await store.dispatch('skills/importSkillMd', content);
  } catch (err) { console.error('Import error:', err); }
  event.target.value = '';
};

// SkillForge actions
const viewSkillDetail = (skill) => {
  // Select in the skills view for the right panel
  const found = allSkills.value.find((s) => s.id === skill.skill_id);
  if (found) { selectedSkill.value = found; activeView.value = 'skills'; }
};

const selectGoal = (goal) => {
  selectedGoal.value = selectedGoal.value?.id === goal.id ? null : goal;
  store.commit('skillforge/SET_LAST_ANALYSIS', null);
  store.commit('skillforge/SET_LAST_EVOLUTION', null);
};

const refreshGoals = () => { store.dispatch('skillforge/fetchEligibleGoals'); };

const runAnalysis = async () => {
  if (!selectedGoal.value) return;
  try { await store.dispatch('skillforge/analyzeGoal', selectedGoal.value.id); }
  catch (err) { console.error('Analysis error:', err); }
};

const runEvolution = async () => {
  if (!selectedGoal.value) return;
  try { await store.dispatch('skillforge/evolveFromGoal', selectedGoal.value.id); }
  catch (err) { console.error('Forge error:', err); }
};

// Helpers
const truncate = (text, max) => (!text ? '' : text.length > max ? text.slice(0, max) + '...' : text);
const formatDelta = (d) => (d == null ? '\u2014' : (d >= 0 ? '+' : '') + d.toFixed(1));
const formatPercent = (v) => (v == null ? '\u2014' : (v * 100).toFixed(0) + '%');
const deltaClass = (d) => (d == null ? '' : d > 2 ? 'positive' : d < 0 ? 'negative' : 'neutral');
const decisionIcon = (d) => (d === 'kept' ? 'fas fa-check-circle' : d === 'promoted' ? 'fas fa-crown' : d === 'discarded' ? 'fas fa-times-circle' : 'fas fa-question-circle');
const formatFullDate = (dateStr) => (!dateStr ? '' : new Date(dateStr).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }));

onMounted(() => { store.dispatch('skills/fetchSkills'); });
</script>

<style scoped>
.skills-screen {
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

/* View Tabs */
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
.view-tab:hover { background: rgba(var(--green-rgb), 0.05); border-color: rgba(var(--green-rgb), 0.3); }
.view-tab.active { background: rgba(var(--green-rgb), 0.1); border-color: rgba(var(--green-rgb), 0.5); color: var(--color-green); }
.tab-count { background: var(--color-darker-0); padding: 1px 6px; border-radius: 10px; font-size: 0.85em; }

/* Import */
.import-btn {
  padding: 6px 14px;
  background: rgba(var(--primary-rgb), 0.1);
  border: 1px solid rgba(var(--primary-rgb), 0.3);
  border-radius: 4px;
  color: var(--color-primary);
  font-size: 0.85em;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: all 0.15s;
}
.import-btn:hover { background: rgba(var(--primary-rgb), 0.2); border-color: var(--color-primary); }

/* Skills Grid */
.skills-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 12px;
  padding: 16px;
  overflow-y: auto;
  flex: 1;
  align-content: start;
}

/* Card */
.skill-card {
  background: rgba(0,0,0,0.15);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  padding: 14px;
  cursor: pointer;
  overflow: hidden;
  transition: border-color 0.2s, background 0.2s;
}
.skill-card:hover { border-color: rgba(var(--green-rgb), 0.4); background: rgba(0,0,0,0.25); }
.skill-card.selected { border-color: var(--color-green); background: rgba(var(--green-rgb), 0.05); }
.card-header { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.card-icon { font-size: 1.5em; }
.card-title-block { flex: 1; display: flex; flex-direction: column; }
.card-name { font-weight: 600; color: var(--color-text); font-size: 0.95em; }
.card-category { font-size: 0.7em; color: var(--color-grey); text-transform: uppercase; letter-spacing: 0.5px; }
.card-actions { display: flex; gap: 4px; opacity: 0; transition: opacity 0.15s; }
.skill-card:hover .card-actions { opacity: 1; }
.card-btn {
  background: rgba(var(--green-rgb), 0.1);
  border: 1px solid rgba(var(--green-rgb), 0.2);
  color: var(--color-grey);
  width: 28px; height: 28px; border-radius: 4px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; font-size: 0.75em; transition: all 0.15s;
}
.card-btn:hover { color: var(--color-text); background: rgba(var(--green-rgb), 0.2); }
.card-btn.delete:hover { color: var(--color-red); border-color: rgba(255,77,79,0.3); background: rgba(255,77,79,0.1); }
.card-description { font-size: 0.85em; color: var(--color-grey); margin: 0 0 8px; line-height: 1.4; }
.card-instructions { border-top: 1px dashed rgba(var(--green-rgb), 0.15); padding-top: 8px; }
.instructions-label { font-size: 0.7em; color: var(--color-green); text-transform: uppercase; letter-spacing: 0.5px; }
.instructions-preview { font-size: 0.8em; color: var(--color-grey); margin: 4px 0 0; font-family: 'Courier New', monospace; line-height: 1.35; white-space: pre-wrap; word-break: break-word; }

/* SkillForge tabs */
.sf-tabs { display: flex; gap: 2px; padding: 0 16px; border-bottom: 1px solid var(--terminal-border-color); flex-shrink: 0; }
.sf-tab {
  padding: 10px 16px; background: none; border: none; border-bottom: 2px solid transparent;
  color: var(--color-grey); font-size: 0.85em; cursor: pointer;
  display: flex; align-items: center; gap: 6px; transition: all 0.15s;
}
.sf-tab:hover { color: var(--color-text); }
.sf-tab.active { color: var(--color-green); border-bottom-color: var(--color-green); }
.sf-content { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 16px; scrollbar-width: thin; }

/* Stats */
.stats-row { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; }
.stat-card { background: rgba(0,0,0,0.15); border: 1px solid var(--terminal-border-color); border-radius: 8px; padding: 12px; text-align: center; }
.stat-card.accent { border-color: rgba(var(--green-rgb), 0.3); }
.stat-value { font-size: 1.2em; font-weight: 700; color: var(--color-text); }
.stat-label { font-size: 0.7em; color: var(--color-grey); text-transform: uppercase; margin-top: 4px; }

/* Leaderboard */
.section-header h3 { font-size: 0.9em; color: var(--color-text); display: flex; align-items: center; gap: 8px; margin: 0; }
.section-header h3 i { color: var(--color-green); }
.leaderboard-list { display: flex; flex-direction: column; gap: 4px; }
.leaderboard-item {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 12px; border: 1px solid var(--terminal-border-color);
  border-radius: 6px; cursor: pointer; transition: all 0.15s;
}
.leaderboard-item:hover { border-color: rgba(var(--green-rgb), 0.3); background: rgba(var(--green-rgb), 0.03); }
.lb-rank { font-weight: 700; color: var(--color-grey); font-size: 0.85em; min-width: 30px; }
.lb-info { flex: 1; }
.lb-name { font-weight: 500; color: var(--color-text); font-size: 0.9em; }
.lb-category { font-size: 0.7em; color: var(--color-grey); text-transform: uppercase; margin-left: 8px; }
.lb-stats { text-align: right; }
.lb-metric { font-weight: 600; font-size: 0.9em; }
.lb-metric.positive { color: var(--color-green); }
.lb-metric.negative { color: #ef4444; }
.lb-metric.neutral { color: var(--color-grey); }
.lb-metric-sub { font-size: 0.7em; color: var(--color-grey); display: block; }

/* Evaluations */
.evals-list { display: flex; flex-direction: column; gap: 8px; }
.eval-card { border: 1px solid var(--terminal-border-color); border-radius: 8px; padding: 12px; }
.eval-card.kept { border-left: 3px solid var(--color-green); }
.eval-card.discarded { border-left: 3px solid #ef4444; }
.eval-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.eval-decision { font-weight: 600; font-size: 0.8em; display: flex; align-items: center; gap: 4px; }
.eval-decision.kept, .eval-decision.promoted { color: var(--color-green); }
.eval-decision.discarded { color: #ef4444; }
.eval-date { font-size: 0.75em; color: var(--color-grey); }
.eval-metrics { display: flex; gap: 16px; }
.eval-metric { display: flex; flex-direction: column; gap: 2px; }
.metric-label { font-size: 0.7em; color: var(--color-grey); text-transform: uppercase; }
.metric-value { font-weight: 600; font-size: 0.9em; color: var(--color-text); }
.metric-value.positive { color: var(--color-green); }
.metric-value.negative { color: #ef4444; }
.eval-reasoning { font-size: 0.8em; color: var(--color-grey); margin: 8px 0 0; font-style: italic; }

/* Forge */
.forge-section h3 { font-size: 0.95em; color: var(--color-text); display: flex; align-items: center; gap: 8px; margin: 0 0 4px; }
.forge-section h3 i { color: var(--color-green); }
.forge-desc { font-size: 0.8em; color: var(--color-grey); margin: 0 0 12px; }
.forge-filters { display: flex; gap: 8px; margin-bottom: 12px; }
.forge-filters .form-input { flex: 1; }
.filter-btn {
  padding: 6px 12px; background: none; border: 1px solid var(--terminal-border-color);
  border-radius: 4px; color: var(--color-grey); cursor: pointer;
  font-size: 0.85em; display: flex; align-items: center; gap: 6px; transition: all 0.15s;
}
.filter-btn.active { color: var(--color-green); border-color: rgba(var(--green-rgb), 0.4); }
.loading-state { color: var(--color-grey); font-size: 0.9em; padding: 20px; text-align: center; }
.goals-list { display: flex; flex-direction: column; gap: 6px; }
.goal-card {
  padding: 10px 12px; border: 1px solid var(--terminal-border-color);
  border-radius: 6px; cursor: pointer; transition: all 0.15s;
}
.goal-card:hover { border-color: rgba(var(--green-rgb), 0.3); }
.goal-card.selected { border-color: var(--color-green); background: rgba(var(--green-rgb), 0.05); }
.goal-card.ineligible { opacity: 0.6; }
.goal-header { display: flex; align-items: center; gap: 8px; }
.goal-title { flex: 1; font-weight: 500; font-size: 0.9em; color: var(--color-text); }
.badge { font-size: 0.75em; padding: 2px 6px; border-radius: 4px; }
.badge.eligible { color: var(--color-green); background: rgba(var(--green-rgb), 0.1); }
.badge.ineligible { color: var(--color-grey); background: rgba(150,150,150,0.1); }
.goal-metrics { display: flex; gap: 12px; margin-top: 6px; }
.goal-metric { font-size: 0.75em; color: var(--color-grey); display: flex; align-items: center; gap: 4px; }
.selected-goal-actions { margin-top: 12px; }
.selected-goal-bar { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; border: 1px solid rgba(var(--green-rgb), 0.3); border-radius: 6px; background: rgba(var(--green-rgb), 0.03); }
.selected-name { font-weight: 500; font-size: 0.9em; color: var(--color-text); }
.action-buttons { display: flex; gap: 8px; }
.forge-btn {
  padding: 8px 16px; border-radius: 4px; font-size: 0.85em; cursor: pointer;
  display: flex; align-items: center; gap: 6px; transition: all 0.15s;
}
.forge-btn.analyze { background: rgba(var(--green-rgb), 0.1); border: 1px solid rgba(var(--green-rgb), 0.2); color: var(--color-text); }
.forge-btn.primary { background: var(--color-green); color: var(--color-dark-navy); border: none; font-weight: 600; }
.forge-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.result-panel { border: 1px solid var(--terminal-border-color); border-radius: 8px; padding: 14px; margin-top: 12px; }
.result-panel h4 { margin: 0 0 10px; font-size: 0.9em; color: var(--color-text); display: flex; align-items: center; gap: 8px; }
.result-panel h4 i { color: var(--color-green); }
.analysis-meta { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
.meta-badge { padding: 2px 8px; border-radius: 4px; font-size: 0.75em; font-weight: 500; background: rgba(var(--green-rgb), 0.1); color: var(--color-green); }
.meta-info { font-size: 0.8em; color: var(--color-grey); }
.analysis-summary { font-size: 0.85em; color: var(--color-grey); margin: 0; line-height: 1.4; }
.result-message { font-size: 0.85em; color: var(--color-grey); margin: 0; }

/* Empty State */
.empty-state-container { flex: 1; display: flex; align-items: center; justify-content: center; width: 100%; }
.empty-state { text-align: center; color: var(--color-text-muted); }
.empty-state i { font-size: 3em; display: block; opacity: 0.5; }
.empty-state p { margin: 16px 0; font-size: 1.1em; }
.empty-state-buttons { display: flex; gap: 12px; justify-content: center; }
.empty-hint { font-size: 0.8em; color: var(--color-grey); }
.create-button {
  display: flex; align-items: center; gap: 8px;
  background: transparent; border: 1px dashed var(--color-duller-navy);
  padding: 10px 20px; border-radius: 6px; color: var(--color-text-muted);
  cursor: pointer; font-size: 0.95em; transition: all 0.2s ease;
}
.create-button:hover { border-color: var(--color-primary); color: var(--color-primary); background: rgba(var(--primary-rgb), 0.05); }

/* Modal */
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 9999; }
.modal-content {
  background: var(--terminal-bg); border: 1px solid var(--terminal-border-color);
  border-radius: 8px; width: 540px; max-height: 80vh;
  display: flex; flex-direction: column; box-shadow: 0 8px 32px rgba(0,0,0,0.5);
}
.modal-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid var(--terminal-border-color); }
.modal-header h3 { margin: 0; font-size: 1em; color: var(--color-text); }
.modal-close { background: none; border: none; color: var(--color-grey); cursor: pointer; font-size: 1em; }
.modal-close:hover { color: var(--color-text); }
.modal-body { padding: 20px; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; }
.form-group { display: flex; flex-direction: column; gap: 4px; }
.form-group label { font-size: 0.85em; color: var(--color-grey); }
.required { color: var(--color-red); }
.form-input {
  padding: 8px 10px; background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color) !important;
  border-radius: 4px !important; color: var(--color-text);
  font-size: 0.9em; font-family: inherit; height: auto !important;
}
.form-input.mono { font-family: 'Courier New', monospace; font-size: 0.85em; }
.form-input:focus { outline: none; border-color: var(--color-primary) !important; }
.form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.icon-grid { display: grid; grid-template-columns: repeat(8, 1fr); gap: 1px; }
.icon-btn {
  aspect-ratio: 1; background: none; border: 1px solid var(--terminal-border-color);
  border-radius: 3px; color: var(--color-text-muted); cursor: pointer;
  font-size: 11px; display: flex; align-items: center; justify-content: center;
  transition: all 0.12s; padding: 0;
}
.icon-btn:hover { color: var(--color-text); }
.icon-btn.active { color: var(--color-green); border-color: rgba(var(--green-rgb), 0.4); background: rgba(var(--green-rgb), 0.08); }
.modal-footer { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 20px; border-top: 1px solid var(--terminal-border-color); }
.modal-btn { padding: 8px 18px; border-radius: 4px; font-size: 0.85em; cursor: pointer; display: flex; align-items: center; gap: 6px; }
.modal-btn.cancel { background: rgba(var(--green-rgb), 0.1); border: 1px solid rgba(var(--green-rgb), 0.2); color: var(--color-text); }
.modal-btn.save { background: var(--color-green); color: var(--color-dark-navy); border: none; font-weight: 600; }
.modal-btn.save:disabled { opacity: 0.5; cursor: not-allowed; }
.modal-btn.save:not(:disabled):hover { opacity: 0.85; }
.modal-error {
  padding: 8px 12px; margin: 0 20px;
  background: rgba(255,77,79,0.1); border: 1px solid rgba(255,77,79,0.3);
  border-radius: 4px; color: var(--color-red); font-size: 0.85em;
  display: flex; align-items: center; gap: 8px;
}
</style>
