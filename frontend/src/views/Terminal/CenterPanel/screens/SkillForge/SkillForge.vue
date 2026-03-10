<!-- SkillForge.vue — Autonomous Skill Evolution Dashboard -->
<template>
  <BaseScreen
    ref="baseScreenRef"
    screenId="SkillForgeScreen"
    activeRightPanel="SkillsPanel"
    :panelProps="panelProps"
    :showInput="false"
    :terminalLines="terminalLines"
    @panel-action="handlePanelAction"
    @screen-change="(s) => emit('screen-change', s)"
    @base-mounted="initializeScreen"
  >
    <template #default>
      <div class="skillforge-screen">
        <!-- Header -->
        <ScreenToolbar
          title="SKILLFORGE"
          :count="leaderboard.length"
          countLabel="evolved skills"
          searchPlaceholder="Search skills..."
          :searchQuery="searchQuery"
          :currentLayout="'grid'"
          :layoutOptions="[]"
          :showCollapseToggle="false"
          :showHideEmpty="false"
          :showCreateButton="false"
          @update:searchQuery="(v) => searchQuery = v"
        />

        <!-- Tabs -->
        <div class="sf-tabs">
          <button
            v-for="tab in tabs"
            :key="tab.id"
            class="sf-tab"
            :class="{ active: activeTab === tab.id }"
            @click="activeTab = tab.id"
          >
            <i :class="tab.icon"></i> {{ tab.label }}
          </button>
        </div>

        <!-- Dashboard Tab -->
        <div v-if="activeTab === 'dashboard'" class="sf-content">
          <!-- Stats Cards -->
          <div class="stats-row">
            <div class="stat-card">
              <div class="stat-value">{{ stats?.totalEvaluations || 0 }}</div>
              <div class="stat-label">A/B Tests</div>
            </div>
            <div class="stat-card">
              <div class="stat-value">{{ stats?.skillsKept || 0 }}</div>
              <div class="stat-label">Skills Kept</div>
            </div>
            <div class="stat-card">
              <div class="stat-value">{{ stats?.skillsDiscarded || 0 }}</div>
              <div class="stat-label">Discarded</div>
            </div>
            <div class="stat-card accent">
              <div class="stat-value">{{ stats?.skillsPromoted || 0 }}</div>
              <div class="stat-label">Gold Standards</div>
            </div>
            <div class="stat-card">
              <div class="stat-value">{{ formatDelta(stats?.averageDelta) }}</div>
              <div class="stat-label">Avg Delta</div>
            </div>
            <div class="stat-card">
              <div class="stat-value">{{ formatPercent(stats?.winRate) }}</div>
              <div class="stat-label">Win Rate</div>
            </div>
          </div>

          <!-- Leaderboard -->
          <div class="section-header">
            <h3><i class="fas fa-trophy"></i> Skill Leaderboard</h3>
          </div>
          <div v-if="filteredLeaderboard.length > 0" class="leaderboard-list">
            <div
              v-for="(skill, idx) in filteredLeaderboard"
              :key="skill.skill_id"
              class="leaderboard-item"
              :class="{ selected: selectedSkillId === skill.skill_id }"
              @click="selectLeaderboardSkill(skill)"
            >
              <span class="lb-rank">#{{ idx + 1 }}</span>
              <div class="lb-info">
                <span class="lb-name">{{ skill.skill_name }}</span>
                <span class="lb-category">{{ skill.category }}</span>
              </div>
              <div class="lb-stats">
                <span class="lb-metric" :class="deltaClass(skill.avg_delta)">
                  {{ formatDelta(skill.avg_delta) }} SES
                </span>
                <span class="lb-metric-sub">
                  {{ formatPercent(skill.win_rate) }} win &middot; {{ skill.total_evaluations }} tests
                </span>
              </div>
            </div>
          </div>
          <div v-else class="empty-state-container">
            <div class="empty-state">
              <i class="fas fa-flask"></i>
              <p>No evolved skills yet</p>
              <span class="empty-hint">Complete goals to generate skill candidates, then evolve them here.</span>
            </div>
          </div>

          <!-- Settings -->
          <div class="section-header" style="margin-top: 24px;">
            <h3><i class="fas fa-cog"></i> Settings</h3>
          </div>
          <div class="settings-grid">
            <div class="setting-item">
              <label>Auto-Analyze</label>
              <span class="setting-hint">Automatically analyze traces after goal completion</span>
              <button
                class="toggle-btn"
                :class="{ on: localSettings.autoAnalyze }"
                @click="toggleSetting('autoAnalyze')"
              >
                {{ localSettings.autoAnalyze ? 'ON' : 'OFF' }}
              </button>
            </div>
            <div class="setting-item">
              <label>Min Confidence</label>
              <span class="setting-hint">Minimum confidence to evolve a skill candidate</span>
              <input
                type="number"
                class="setting-input"
                v-model.number="localSettings.minConfidence"
                min="0" max="1" step="0.05"
                @change="saveSetting('minConfidence')"
              />
            </div>
            <div class="setting-item">
              <label>Min Delta</label>
              <span class="setting-hint">Minimum SES improvement to keep a skill</span>
              <input
                type="number"
                class="setting-input"
                v-model.number="localSettings.minDelta"
                min="0" max="50" step="0.5"
                @change="saveSetting('minDelta')"
              />
            </div>
            <div class="setting-item">
              <label>Gold Standard Threshold</label>
              <span class="setting-hint">SES score needed for Gold Standard promotion</span>
              <input
                type="number"
                class="setting-input"
                v-model.number="localSettings.goldStandardThreshold"
                min="50" max="100" step="5"
                @change="saveSetting('goldStandardThreshold')"
              />
            </div>
          </div>
        </div>

        <!-- Evaluations Tab -->
        <div v-if="activeTab === 'evaluations'" class="sf-content">
          <div v-if="evaluations.length > 0" class="evals-list">
            <div
              v-for="ev in evaluations"
              :key="ev.id"
              class="eval-card"
              :class="{ kept: ev.decision === 'kept' || ev.decision === 'promoted', discarded: ev.decision === 'discarded' }"
            >
              <div class="eval-header">
                <span class="eval-decision" :class="ev.decision">
                  <i :class="decisionIcon(ev.decision)"></i>
                  {{ ev.decision.toUpperCase() }}
                </span>
                <span class="eval-date">{{ formatDate(ev.created_at) }}</span>
              </div>
              <div class="eval-metrics">
                <div class="eval-metric">
                  <span class="metric-label">Baseline SES</span>
                  <span class="metric-value">{{ ev.baseline_ses != null ? ev.baseline_ses.toFixed(1) : 'N/A' }}</span>
                </div>
                <div class="eval-metric">
                  <span class="metric-label">Treatment SES</span>
                  <span class="metric-value">{{ ev.treatment_ses != null ? ev.treatment_ses.toFixed(1) : 'N/A' }}</span>
                </div>
                <div class="eval-metric">
                  <span class="metric-label">Delta</span>
                  <span class="metric-value" :class="deltaClass(ev.delta)">{{ formatDelta(ev.delta) }}</span>
                </div>
              </div>
              <div class="eval-details">
                <span class="eval-detail"><i class="fas fa-wrench"></i> {{ ev.baseline_tool_calls ?? '?' }} / {{ ev.treatment_tool_calls ?? '?' }} tool calls</span>
                <span class="eval-detail"><i class="fas fa-bug"></i> {{ ev.baseline_errors ?? '?' }} / {{ ev.treatment_errors ?? '?' }} errors</span>
              </div>
            </div>
          </div>
          <div v-else class="empty-state-container">
            <div class="empty-state">
              <i class="fas fa-vial"></i>
              <p>No A/B tests recorded yet</p>
            </div>
          </div>
        </div>

        <!-- Evolve Tab -->
        <div v-if="activeTab === 'evolve'" class="sf-content">
          <div class="evolve-section">
            <h3><i class="fas fa-dna"></i> Evolve from Goal</h3>
            <p class="evolve-desc">Enter a completed goal ID to analyze its execution trace and generate or refine a skill.</p>
            <div class="evolve-form">
              <input
                v-model="evolveGoalId"
                class="form-input"
                placeholder="Goal ID (e.g., abc123-def4-...)"
              />
              <button
                class="evolve-btn analyze"
                :disabled="!evolveGoalId || isAnalyzing"
                @click="runAnalysis"
              >
                <i :class="isAnalyzing ? 'fas fa-spinner fa-spin' : 'fas fa-search'"></i>
                {{ isAnalyzing ? 'Analyzing...' : 'Analyze Trace' }}
              </button>
              <button
                class="evolve-btn evolve"
                :disabled="!evolveGoalId || isEvolving"
                @click="runEvolution"
              >
                <i :class="isEvolving ? 'fas fa-spinner fa-spin' : 'fas fa-dna'"></i>
                {{ isEvolving ? 'Evolving...' : 'Analyze + Evolve' }}
              </button>
            </div>

            <!-- Analysis Results -->
            <div v-if="lastAnalysis" class="result-panel">
              <h4><i class="fas fa-clipboard-check"></i> Trace Analysis</h4>
              <div v-if="lastAnalysis.analysis" class="analysis-content">
                <div class="analysis-meta">
                  <span class="meta-badge" :class="lastAnalysis.analysis.traceQuality">
                    {{ lastAnalysis.analysis.traceQuality }} quality
                  </span>
                  <span class="meta-info">{{ lastAnalysis.analysis.patternCount || 0 }} patterns</span>
                  <span class="meta-info">{{ lastAnalysis.analysis.antipatternCount || 0 }} antipatterns</span>
                </div>
                <p class="analysis-summary">{{ lastAnalysis.analysis.overallAssessment }}</p>
                <!-- Skill candidate -->
                <div v-if="lastAnalysis.analysis.skillCandidate" class="candidate-preview">
                  <h5>Skill Candidate</h5>
                  <p><strong>{{ lastAnalysis.analysis.skillCandidate.name }}</strong> — {{ lastAnalysis.analysis.skillCandidate.description }}</p>
                  <span class="meta-badge">Confidence: {{ (lastAnalysis.analysis.skillCandidate.confidence * 100).toFixed(0) }}%</span>
                </div>
                <!-- Patterns list -->
                <div v-if="lastAnalysis.analysis.patterns?.length" class="patterns-list">
                  <h5>Patterns Found</h5>
                  <div v-for="p in lastAnalysis.analysis.patterns" :key="p.name" class="pattern-item">
                    <span class="pattern-name">{{ p.name }}</span>
                    <span class="pattern-type">{{ p.type }}</span>
                    <span class="pattern-eff">{{ (p.effectiveness * 100).toFixed(0) }}%</span>
                  </div>
                </div>
              </div>
              <p v-else class="result-message">{{ lastAnalysis.message || 'No analysis data returned.' }}</p>
            </div>

            <!-- Evolution Results -->
            <div v-if="lastEvolution" class="result-panel evolution-result">
              <h4><i class="fas fa-dna"></i> Evolution Result</h4>
              <div v-if="lastEvolution.evolution" class="evolution-content">
                <div class="evo-header">
                  <span class="evo-action" :class="lastEvolution.evolution.action">
                    <i :class="decisionIcon(lastEvolution.evolution.action)"></i>
                    {{ lastEvolution.evolution.action?.toUpperCase() }}
                  </span>
                  <span v-if="lastEvolution.evolution.skillName" class="evo-name">{{ lastEvolution.evolution.skillName }}</span>
                  <span v-if="lastEvolution.evolution.version" class="evo-version">v{{ lastEvolution.evolution.version }}</span>
                </div>
                <div v-if="lastEvolution.evolution.delta != null" class="eval-metrics">
                  <div class="eval-metric">
                    <span class="metric-label">Baseline SES</span>
                    <span class="metric-value">{{ lastEvolution.evolution.baselineSES?.toFixed(1) ?? 'N/A' }}</span>
                  </div>
                  <div class="eval-metric">
                    <span class="metric-label">Treatment SES</span>
                    <span class="metric-value">{{ lastEvolution.evolution.treatmentSES?.toFixed(1) ?? 'N/A' }}</span>
                  </div>
                  <div class="eval-metric">
                    <span class="metric-label">Delta</span>
                    <span class="metric-value" :class="deltaClass(lastEvolution.evolution.delta)">{{ formatDelta(lastEvolution.evolution.delta) }}</span>
                  </div>
                </div>
              </div>
              <p v-else-if="lastEvolution.reason" class="result-message">{{ lastEvolution.reason }}</p>
              <p v-else class="result-message">{{ lastEvolution.status }}: {{ lastEvolution.reason || 'No details' }}</p>
            </div>
          </div>
        </div>

        <!-- Skill Detail Tab (when a leaderboard skill is selected) -->
        <div v-if="activeTab === 'detail'" class="sf-content">
          <div v-if="selectedSkillId" class="detail-section">
            <button class="back-btn" @click="activeTab = 'dashboard'; selectedSkillId = null">
              <i class="fas fa-arrow-left"></i> Back
            </button>

            <h3>{{ selectedSkillName }} — Version History</h3>

            <div v-if="skillVersions.length > 0" class="versions-list">
              <div v-for="v in skillVersions" :key="v.id" class="version-card" :class="{ active: v.status === 'active' }">
                <div class="version-header">
                  <span class="version-num">v{{ v.version }}</span>
                  <span class="version-status" :class="v.status">{{ v.status }}</span>
                  <span class="version-date">{{ formatDate(v.created_at) }}</span>
                </div>
                <div v-if="v.effectiveness_score != null" class="version-ses">
                  SES: {{ v.effectiveness_score.toFixed(1) }}
                </div>
                <p v-if="v.instructions" class="version-instructions">{{ truncate(v.instructions, 200) }}</p>
              </div>
            </div>
            <p v-else class="empty-hint">No version history available.</p>

            <!-- Evaluations for this skill -->
            <h3 style="margin-top: 20px;">A/B Test History</h3>
            <div v-if="skillEvals.length > 0" class="evals-list">
              <div
                v-for="ev in skillEvals"
                :key="ev.id"
                class="eval-card"
                :class="{ kept: ev.decision === 'kept' || ev.decision === 'promoted', discarded: ev.decision === 'discarded' }"
              >
                <div class="eval-header">
                  <span class="eval-decision" :class="ev.decision">
                    <i :class="decisionIcon(ev.decision)"></i> {{ ev.decision.toUpperCase() }}
                  </span>
                  <span class="eval-date">{{ formatDate(ev.created_at) }}</span>
                </div>
                <div class="eval-metrics">
                  <div class="eval-metric">
                    <span class="metric-label">Baseline</span>
                    <span class="metric-value">{{ ev.baseline_ses?.toFixed(1) ?? 'N/A' }}</span>
                  </div>
                  <div class="eval-metric">
                    <span class="metric-label">Treatment</span>
                    <span class="metric-value">{{ ev.treatment_ses?.toFixed(1) ?? 'N/A' }}</span>
                  </div>
                  <div class="eval-metric">
                    <span class="metric-label">Delta</span>
                    <span class="metric-value" :class="deltaClass(ev.delta)">{{ formatDelta(ev.delta) }}</span>
                  </div>
                </div>
              </div>
            </div>
            <p v-else class="empty-hint">No evaluations for this skill.</p>
          </div>
        </div>
      </div>
    </template>
  </BaseScreen>
</template>

<script setup>
import { ref, computed, onMounted, watch, reactive } from 'vue';
import { useStore } from 'vuex';
import BaseScreen from '@/views/Terminal/CenterPanel/BaseScreen.vue';
import ScreenToolbar from '@/views/Terminal/_components/ScreenToolbar.vue';

const store = useStore();
const emit = defineEmits(['screen-change']);
const baseScreenRef = ref(null);

const terminalLines = ref(['SkillForge initialized.']);
const searchQuery = ref('');
const activeTab = ref('dashboard');
const selectedSkillId = ref(null);
const selectedSkillName = ref('');
const evolveGoalId = ref('');

const localSettings = reactive({
  autoAnalyze: false,
  minConfidence: 0.7,
  minDelta: 2.0,
  goldStandardThreshold: 90,
});

const tabs = [
  { id: 'dashboard', label: 'Dashboard', icon: 'fas fa-chart-bar' },
  { id: 'evaluations', label: 'A/B Tests', icon: 'fas fa-vial' },
  { id: 'evolve', label: 'Evolve', icon: 'fas fa-dna' },
];

// Getters
const stats = computed(() => store.getters['skillforge/stats']);
const evaluations = computed(() => store.getters['skillforge/evaluations']);
const leaderboard = computed(() => store.getters['skillforge/leaderboard']);
const isAnalyzing = computed(() => store.getters['skillforge/isAnalyzing']);
const isEvolving = computed(() => store.getters['skillforge/isEvolving']);
const lastAnalysis = computed(() => store.getters['skillforge/lastAnalysis']);
const lastEvolution = computed(() => store.getters['skillforge/lastEvolution']);
const skillVersions = computed(() => store.getters['skillforge/selectedSkillVersions']);
const skillEvals = computed(() => store.getters['skillforge/selectedSkillEvals']);

const filteredLeaderboard = computed(() => {
  const q = searchQuery.value.toLowerCase();
  if (!q) return leaderboard.value;
  return leaderboard.value.filter(s =>
    s.skill_name?.toLowerCase().includes(q) || s.category?.toLowerCase().includes(q)
  );
});

const panelProps = computed(() => ({ selectedSkill: null }));

// Load settings from store
watch(() => store.getters['skillforge/settings'], (s) => {
  if (s) Object.assign(localSettings, s);
}, { immediate: true });

const initializeScreen = () => {
  store.dispatch('skillforge/fetchStats');
  store.dispatch('skillforge/fetchLeaderboard');
  store.dispatch('skillforge/fetchEvaluations');
  store.dispatch('skillforge/fetchSettings');
};

const handlePanelAction = (action, payload) => {
  if (action === 'navigate') emit('screen-change', payload);
};

const selectLeaderboardSkill = (skill) => {
  selectedSkillId.value = skill.skill_id;
  selectedSkillName.value = skill.skill_name;
  activeTab.value = 'detail';
  store.dispatch('skillforge/fetchSkillVersions', skill.skill_id);
  store.dispatch('skillforge/fetchSkillEvaluations', skill.skill_id);
};

const runAnalysis = async () => {
  try {
    await store.dispatch('skillforge/analyzeGoal', evolveGoalId.value);
    terminalLines.value.push(`[SkillForge] Trace analysis complete for goal ${evolveGoalId.value}`);
  } catch (err) {
    terminalLines.value.push(`[SkillForge] Analysis error: ${err.message}`);
  }
};

const runEvolution = async () => {
  try {
    const result = await store.dispatch('skillforge/evolveFromGoal', evolveGoalId.value);
    terminalLines.value.push(`[SkillForge] Evolution complete: ${result?.evolution?.action || result?.status || 'done'}`);
  } catch (err) {
    terminalLines.value.push(`[SkillForge] Evolution error: ${err.message}`);
  }
};

const toggleSetting = (key) => {
  localSettings[key] = !localSettings[key];
  saveSetting(key);
};

const saveSetting = (key) => {
  store.dispatch('skillforge/updateSettings', { [key]: localSettings[key] });
};

// Helpers
const formatDelta = (d) => {
  if (d == null) return '—';
  return (d >= 0 ? '+' : '') + d.toFixed(1);
};

const formatPercent = (v) => {
  if (v == null) return '—';
  return (v * 100).toFixed(0) + '%';
};

const deltaClass = (d) => {
  if (d == null) return '';
  return d > 2 ? 'positive' : d < 0 ? 'negative' : 'neutral';
};

const decisionIcon = (d) => {
  if (d === 'kept') return 'fas fa-check-circle';
  if (d === 'promoted') return 'fas fa-crown';
  if (d === 'discarded') return 'fas fa-times-circle';
  return 'fas fa-question-circle';
};

const formatDate = (dateStr) => {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const truncate = (text, max) => {
  if (!text) return '';
  return text.length > max ? text.slice(0, max) + '...' : text;
};

onMounted(() => {
  initializeScreen();
});
</script>

<style scoped>
.skillforge-screen {
  display: flex;
  flex-direction: column;
  flex: 1;
  width: 100%;
  min-height: 0;
}

/* Tabs */
.sf-tabs {
  display: flex;
  gap: 2px;
  padding: 0 16px;
  border-bottom: 1px solid var(--terminal-border-color);
  flex-shrink: 0;
}
.sf-tab {
  padding: 10px 16px;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--color-grey);
  font-size: 0.85em;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: all 0.15s;
}
.sf-tab:hover { color: var(--color-text); }
.sf-tab.active {
  color: var(--color-green);
  border-bottom-color: var(--color-green);
}

/* Content */
.sf-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

/* Stats Row */
.stats-row {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 10px;
  margin-bottom: 20px;
}
.stat-card {
  background: rgba(0, 0, 0, 0.15);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  padding: 14px;
  text-align: center;
}
.stat-card.accent { border-color: rgba(var(--green-rgb), 0.3); }
.stat-value {
  font-size: 1.5em;
  font-weight: 700;
  color: var(--color-text);
}
.stat-card.accent .stat-value { color: var(--color-green); }
.stat-label {
  font-size: 0.75em;
  color: var(--color-grey);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-top: 4px;
}

/* Section Headers */
.section-header {
  margin-bottom: 12px;
}
.section-header h3 {
  font-size: 0.95em;
  color: var(--color-text);
  margin: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}
.section-header h3 i { color: var(--color-green); }

/* Leaderboard */
.leaderboard-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.leaderboard-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: rgba(0, 0, 0, 0.15);
  border: 1px solid var(--terminal-border-color);
  border-radius: 6px;
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s;
}
.leaderboard-item:hover {
  border-color: rgba(var(--green-rgb), 0.4);
  background: rgba(0, 0, 0, 0.25);
}
.leaderboard-item.selected {
  border-color: var(--color-green);
  background: rgba(var(--green-rgb), 0.05);
}
.lb-rank {
  font-weight: 700;
  color: var(--color-green);
  width: 30px;
  text-align: center;
  font-size: 0.9em;
}
.lb-info { flex: 1; display: flex; flex-direction: column; }
.lb-name { font-weight: 600; color: var(--color-text); font-size: 0.9em; }
.lb-category { font-size: 0.7em; color: var(--color-grey); text-transform: uppercase; }
.lb-stats { text-align: right; }
.lb-metric { font-weight: 600; font-size: 0.9em; }
.lb-metric-sub { font-size: 0.7em; color: var(--color-grey); display: block; }

/* Delta colors */
.positive { color: var(--color-green); }
.negative { color: var(--color-red, #ff4d4f); }
.neutral { color: var(--color-grey); }

/* Evaluations */
.evals-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.eval-card {
  background: rgba(0, 0, 0, 0.15);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  padding: 14px;
}
.eval-card.kept { border-left: 3px solid var(--color-green); }
.eval-card.discarded { border-left: 3px solid var(--color-red, #ff4d4f); }
.eval-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}
.eval-decision {
  font-weight: 700;
  font-size: 0.8em;
  display: flex;
  align-items: center;
  gap: 6px;
}
.eval-decision.kept, .eval-decision.promoted { color: var(--color-green); }
.eval-decision.discarded { color: var(--color-red, #ff4d4f); }
.eval-date { font-size: 0.75em; color: var(--color-grey); }
.eval-metrics {
  display: flex;
  gap: 16px;
  margin-bottom: 8px;
}
.eval-metric { text-align: center; }
.metric-label { font-size: 0.7em; color: var(--color-grey); display: block; text-transform: uppercase; }
.metric-value { font-weight: 600; font-size: 0.95em; color: var(--color-text); }
.eval-details {
  display: flex;
  gap: 16px;
  font-size: 0.75em;
  color: var(--color-grey);
}
.eval-detail { display: flex; align-items: center; gap: 4px; }

/* Evolve */
.evolve-section h3 {
  font-size: 1em;
  color: var(--color-text);
  margin: 0 0 4px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.evolve-section h3 i { color: var(--color-green); }
.evolve-desc { font-size: 0.85em; color: var(--color-grey); margin: 0 0 14px; }
.evolve-form {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 20px;
}
.evolve-form .form-input {
  flex: 1;
  padding: 8px 12px;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 4px;
  color: var(--color-text);
  font-size: 0.9em;
  font-family: 'Courier New', monospace;
}
.evolve-form .form-input:focus { outline: none; border-color: var(--color-primary); }
.evolve-btn {
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 0.85em;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
  transition: opacity 0.15s;
}
.evolve-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.evolve-btn.analyze {
  background: rgba(var(--green-rgb), 0.1);
  border: 1px solid rgba(var(--green-rgb), 0.3);
  color: var(--color-green);
}
.evolve-btn.evolve {
  background: var(--color-green);
  border: none;
  color: var(--color-dark-navy);
}
.evolve-btn:not(:disabled):hover { opacity: 0.85; }

/* Result Panels */
.result-panel {
  background: rgba(0, 0, 0, 0.15);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 16px;
}
.result-panel h4 {
  font-size: 0.9em;
  color: var(--color-text);
  margin: 0 0 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.result-panel h4 i { color: var(--color-green); }
.result-panel h5 { font-size: 0.85em; color: var(--color-text); margin: 12px 0 6px; }
.result-message { font-size: 0.85em; color: var(--color-grey); margin: 0; }
.analysis-meta {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-bottom: 8px;
}
.meta-badge {
  font-size: 0.75em;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 10px;
  text-transform: uppercase;
}
.meta-badge.high { background: rgba(var(--green-rgb), 0.15); color: var(--color-green); }
.meta-badge.medium { background: rgba(255, 193, 7, 0.15); color: #ffc107; }
.meta-badge.low { background: rgba(255, 77, 79, 0.15); color: #ff4d4f; }
.meta-info { font-size: 0.8em; color: var(--color-grey); }
.analysis-summary { font-size: 0.85em; color: var(--color-text); margin: 8px 0; line-height: 1.4; }
.candidate-preview {
  background: rgba(var(--green-rgb), 0.05);
  border: 1px solid rgba(var(--green-rgb), 0.15);
  border-radius: 6px;
  padding: 10px;
  margin-top: 10px;
}
.candidate-preview p { font-size: 0.85em; color: var(--color-text); margin: 4px 0; }

/* Patterns List */
.patterns-list { margin-top: 10px; }
.pattern-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 0;
  border-bottom: 1px solid rgba(var(--green-rgb), 0.08);
  font-size: 0.8em;
}
.pattern-name { font-weight: 600; color: var(--color-text); flex: 1; }
.pattern-type { color: var(--color-grey); font-size: 0.85em; }
.pattern-eff { color: var(--color-green); font-weight: 600; }

/* Evolution Result */
.evo-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.evo-action {
  font-weight: 700;
  font-size: 0.85em;
  display: flex;
  align-items: center;
  gap: 6px;
}
.evo-action.kept, .evo-action.promoted { color: var(--color-green); }
.evo-action.discarded { color: var(--color-red, #ff4d4f); }
.evo-action.skipped, .evo-action.error { color: var(--color-grey); }
.evo-name { font-weight: 600; color: var(--color-text); }
.evo-version { font-size: 0.8em; color: var(--color-grey); }

/* Settings */
.settings-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 10px;
}
.setting-item {
  background: rgba(0, 0, 0, 0.15);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.setting-item label {
  font-size: 0.85em;
  font-weight: 600;
  color: var(--color-text);
}
.setting-hint {
  font-size: 0.75em;
  color: var(--color-grey);
  margin-bottom: 6px;
}
.setting-input {
  padding: 6px 10px;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 4px;
  color: var(--color-text);
  font-size: 0.85em;
  width: 80px;
}
.setting-input:focus { outline: none; border-color: var(--color-primary); }
.toggle-btn {
  padding: 6px 16px;
  border-radius: 4px;
  font-size: 0.8em;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid var(--terminal-border-color);
  background: rgba(0, 0, 0, 0.2);
  color: var(--color-grey);
  width: fit-content;
  transition: all 0.15s;
}
.toggle-btn.on {
  background: rgba(var(--green-rgb), 0.15);
  border-color: rgba(var(--green-rgb), 0.3);
  color: var(--color-green);
}

/* Detail View */
.back-btn {
  background: none;
  border: none;
  color: var(--color-grey);
  cursor: pointer;
  font-size: 0.85em;
  padding: 4px 0;
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.back-btn:hover { color: var(--color-text); }

.versions-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.version-card {
  background: rgba(0, 0, 0, 0.15);
  border: 1px solid var(--terminal-border-color);
  border-radius: 6px;
  padding: 12px;
}
.version-card.active { border-color: rgba(var(--green-rgb), 0.3); }
.version-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}
.version-num { font-weight: 700; color: var(--color-text); }
.version-status {
  font-size: 0.7em;
  padding: 2px 6px;
  border-radius: 8px;
  text-transform: uppercase;
  font-weight: 600;
}
.version-status.active { background: rgba(var(--green-rgb), 0.15); color: var(--color-green); }
.version-status.superseded { background: rgba(255, 193, 7, 0.15); color: #ffc107; }
.version-status.discarded { background: rgba(255, 77, 79, 0.15); color: #ff4d4f; }
.version-date { font-size: 0.75em; color: var(--color-grey); margin-left: auto; }
.version-ses { font-size: 0.85em; color: var(--color-green); font-weight: 600; margin-bottom: 4px; }
.version-instructions {
  font-size: 0.8em;
  color: var(--color-grey);
  font-family: 'Courier New', monospace;
  line-height: 1.35;
  white-space: pre-wrap;
  margin: 4px 0 0;
}

/* Empty States */
.empty-state-container {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 200px;
}
.empty-state {
  text-align: center;
  color: var(--color-text-muted);
}
.empty-state i {
  font-size: 3em;
  display: block;
  opacity: 0.5;
  margin-bottom: 12px;
}
.empty-state p { margin: 0 0 6px; font-size: 1.1em; }
.empty-hint { font-size: 0.8em; color: var(--color-grey); }

.detail-section h3 {
  font-size: 1em;
  color: var(--color-text);
  margin: 0 0 12px;
}
</style>
