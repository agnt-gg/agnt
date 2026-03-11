<template>
  <BaseScreen ref="baseScreenRef" screenId="ExperimentForgeScreen" activeRightPanel="ExperimentForgePanel" activeLeftPanel="ExperimentForgePanel" :panelProps="panelProps" :leftPanelProps="leftPanelProps" :showInput="false" @panel-action="handlePanelAction" @screen-change="(s) => emit('screen-change', s)" @base-mounted="initializeScreen">
    <template #default>
      <div class="forge-screen">
        <ScreenToolbar title="EXPERIMENT FORGE" :count="0" countLabel="" searchPlaceholder="" :searchQuery="''" :currentLayout="''" :layoutOptions="[]" :showCollapseToggle="false" :showHideEmpty="false" :createLabel="''" />

        <div class="forge-content">
          <div class="forge-form">
            <!-- Experiment Details -->
            <section class="form-section">
              <h3 class="section-title"><i class="fas fa-flask"></i> Experiment Details</h3>
              <div class="form-group">
                <label>Name <span class="required">*</span></label>
                <input v-model="form.name" class="form-input" placeholder="e.g., Improve code review accuracy" />
              </div>
              <div class="form-group">
                <label>Hypothesis</label>
                <textarea v-model="form.hypothesis" class="form-input" rows="3" placeholder="e.g., Adding chain-of-thought reasoning will improve code review detection rate by 10%"></textarea>
              </div>
            </section>

            <!-- What to Test -->
            <section class="form-section">
              <h3 class="section-title"><i class="fas fa-vial"></i> What to Test</h3>
              <div class="form-group">
                <label>Experiment Type</label>
                <div class="radio-group">
                  <label class="radio-option" v-for="opt in typeOptions" :key="opt.value" :class="{ active: form.type === opt.value }">
                    <input type="radio" v-model="form.type" :value="opt.value" />
                    <i :class="opt.icon"></i>
                    <div class="radio-text">
                      <span class="radio-label">{{ opt.label }}</span>
                      <span class="radio-desc">{{ opt.description }}</span>
                    </div>
                  </label>
                </div>
              </div>
              <div class="form-group">
                <label>Skill to Test <span class="required">*</span></label>
                <select v-model="form.skillId" class="form-input">
                  <option value="">Select a skill...</option>
                  <option v-for="skill in availableSkills" :key="skill.id" :value="skill.id">{{ skill.name }}</option>
                </select>
              </div>
              <div class="form-group">
                <label>Source Goal (optional)</label>
                <select v-model="form.goalId" class="form-input">
                  <option value="">No goal linked</option>
                  <option v-for="goal in availableGoals" :key="goal.id" :value="goal.id">{{ goal.title }}</option>
                </select>
              </div>
            </section>

            <!-- Evaluation Dataset -->
            <section class="form-section">
              <h3 class="section-title"><i class="fas fa-database"></i> Evaluation Dataset</h3>
              <div class="form-group">
                <label>Dataset Strategy</label>
                <div class="radio-group">
                  <label class="radio-option" :class="{ active: form.datasetStrategy === 'generate' }">
                    <input type="radio" v-model="form.datasetStrategy" value="generate" />
                    <i class="fas fa-magic"></i>
                    <div class="radio-text">
                      <span class="radio-label">Auto-generate</span>
                      <span class="radio-desc">Generate eval examples from skill context</span>
                    </div>
                  </label>
                  <label class="radio-option" :class="{ active: form.datasetStrategy === 'existing' }">
                    <input type="radio" v-model="form.datasetStrategy" value="existing" />
                    <i class="fas fa-folder-open"></i>
                    <div class="radio-text">
                      <span class="radio-label">Use Existing</span>
                      <span class="radio-desc">Select from saved evaluation datasets</span>
                    </div>
                  </label>
                </div>
              </div>
              <div v-if="form.datasetStrategy === 'existing'" class="form-group">
                <label>Select Dataset</label>
                <select v-model="form.datasetId" class="form-input">
                  <option value="">Select a dataset...</option>
                  <option v-for="ds in availableDatasets" :key="ds.id" :value="ds.id">{{ ds.name }} ({{ ds.items?.length || 0 }} items)</option>
                </select>
              </div>
            </section>

            <!-- Configuration -->
            <section class="form-section">
              <h3 class="section-title"><i class="fas fa-sliders-h"></i> Configuration</h3>
              <div class="form-row-3">
                <div class="form-group">
                  <label>Max Iterations</label>
                  <input v-model.number="form.maxIterations" type="number" class="form-input" min="1" max="20" />
                  <span class="form-hint">How many mutation rounds</span>
                </div>
                <div class="form-group">
                  <label>Runs per Example</label>
                  <input v-model.number="form.runsPerExample" type="number" class="form-input" min="1" max="10" />
                  <span class="form-hint">Repeat each eval N times</span>
                </div>
                <div class="form-group">
                  <label>Min Delta</label>
                  <input v-model.number="form.minDelta" type="number" class="form-input" step="0.01" min="0" max="1" />
                  <span class="form-hint">Minimum improvement threshold</span>
                </div>
              </div>
            </section>

            <!-- Constraint Gates -->
            <section class="form-section">
              <h3 class="section-title"><i class="fas fa-shield-alt"></i> Constraint Gates</h3>
              <p class="section-desc">Safety checks applied after each iteration. If any gate fails, the mutation is discarded.</p>
              <div class="checkbox-group">
                <label class="checkbox-option" v-for="gate in constraintGates" :key="gate.value">
                  <input type="checkbox" v-model="form.constraints" :value="gate.value" />
                  <span class="checkbox-label">{{ gate.label }}</span>
                  <span class="checkbox-desc">{{ gate.description }}</span>
                </label>
              </div>
            </section>

            <!-- Launch -->
            <div class="forge-actions">
              <button class="cancel-btn" @click="emit('screen-change', 'ExperimentsScreen')"><i class="fas fa-arrow-left"></i> Back</button>
              <button class="launch-btn" :disabled="!canLaunch || launching" @click="launchExperiment">
                <i :class="launching ? 'fas fa-spinner fa-spin' : 'fas fa-rocket'"></i>
                {{ launching ? 'Launching...' : 'Launch Experiment' }}
              </button>
            </div>
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

const store = useStore();
const emit = defineEmits(['screen-change']);
const launching = ref(false);

const form = ref({
  name: '',
  hypothesis: '',
  type: 'ab_test',
  skillId: '',
  goalId: '',
  datasetStrategy: 'generate',
  datasetId: '',
  maxIterations: 5,
  runsPerExample: 3,
  minDelta: 0.05,
  constraints: ['no_regression', 'format_preserved'],
});

const typeOptions = [
  { value: 'ab_test', label: 'A/B Test', icon: 'fas fa-columns', description: 'Compare baseline vs. mutated skill side-by-side' },
  { value: 'iterative', label: 'Iterative', icon: 'fas fa-sync-alt', description: 'Evolve skill through multiple mutation rounds' },
  { value: 'ablation', label: 'Ablation', icon: 'fas fa-cut', description: 'Remove parts of the skill to find what matters' },
];

const constraintGates = [
  { value: 'no_regression', label: 'No Regression', description: 'Mutated version must not score worse on any dimension' },
  { value: 'format_preserved', label: 'Format Preserved', description: 'Output format must match baseline structure' },
  { value: 'latency_budget', label: 'Latency Budget', description: 'Response time must stay within 2x of baseline' },
  { value: 'token_budget', label: 'Token Budget', description: 'Token usage must not exceed 1.5x of baseline' },
  { value: 'safety_check', label: 'Safety Check', description: 'Run safety evaluator on mutated outputs' },
];

const availableSkills = computed(() => store.getters['skills/allSkills'] || []);
const availableGoals = computed(() => store.getters['goals/allGoals'] || []);
const availableDatasets = computed(() => store.getters['experiments/allEvalDatasets'] || []);
const panelProps = computed(() => ({ form: form.value }));
const leftPanelProps = computed(() => ({ skills: availableSkills.value }));

const canLaunch = computed(() => form.value.name?.trim() && form.value.skillId);

const handlePanelAction = (action, data) => {
  if (action === 'navigate') emit('screen-change', data);
};

const initializeScreen = () => {
  store.dispatch('skills/fetchSkills');
  store.dispatch('goals/fetchGoals');
  store.dispatch('experiments/fetchEvalDatasets', { force: false });
};

const launchExperiment = async () => {
  if (!canLaunch.value || launching.value) return;
  launching.value = true;
  try {
    const experimentData = {
      name: form.value.name,
      hypothesis: form.value.hypothesis,
      type: form.value.type,
      skillId: form.value.skillId,
      sourceGoalId: form.value.goalId || null,
      evalDatasetId: form.value.datasetStrategy === 'existing' ? form.value.datasetId : null,
      config: {
        maxIterations: form.value.maxIterations,
        runsPerExample: form.value.runsPerExample,
        minDelta: form.value.minDelta,
        constraintGates: {
          sizeLimit: form.value.constraints.includes('no_regression'),
          growthLimit: form.value.constraints.includes('format_preserved'),
          structuralIntegrity: form.value.constraints.includes('latency_budget'),
          holdoutValidation: form.value.constraints.includes('safety_check'),
        },
      },
    };
    const result = await store.dispatch('experiments/createExperiment', experimentData);
    if (result?.experiment?.id) {
      await store.dispatch('experiments/runExperiment', result.experiment.id);
    }
    emit('screen-change', 'ExperimentsScreen');
  } catch (err) {
    console.error('Failed to launch experiment:', err);
  } finally {
    launching.value = false;
  }
};

onMounted(() => initializeScreen());
</script>

<style scoped>
/* Screen root layout */
.forge-screen {
  display: flex;
  flex-direction: column;
  flex: 1;
  width: 100%;
  min-height: 0;
  position: relative;
}

/* Scrollable content area */
.forge-content {
  flex: 1;
  overflow-y: auto;
  padding: 0 4px;
  scrollbar-width: thin;
  scrollbar-color: var(--color-duller-navy) transparent;
}

/* Centered form with max-width */
.forge-form {
  max-width: 720px;
  margin: 0 auto;
  padding: 8px 0 40px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* Form sections — matching right panel section pattern */
.form-section {
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color-light);
  border-radius: 0px;
  padding: 15px;
  box-sizing: border-box;
  overflow: hidden;
  min-width: 0;
}

/* Section title — matching instructions-label pattern */
.section-title {
  margin: 0 0 12px 0;
  color: var(--color-grey);
  font-size: 0.8em;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.section-title i {
  color: var(--color-green);
  font-size: 0.9em;
}

/* Section description */
.section-desc {
  font-size: 0.75em;
  color: var(--color-grey);
  opacity: 0.7;
  margin: -4px 0 10px 0;
}

/* Form groups */
.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}

.form-group:last-child {
  margin-bottom: 0;
}

/* Form labels */
.form-group label {
  font-size: 0.85em;
  color: var(--color-grey);
}

/* Required asterisk */
.required {
  color: var(--color-red);
}

/* Form inputs — matching AGNT form-input pattern */
.form-input {
  padding: 8px 10px;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color) !important;
  border-radius: 4px !important;
  color: var(--color-text);
  font-size: 0.9em;
  font-family: inherit;
  height: auto !important;
  transition: border-color 0.2s;
  width: 100%;
  box-sizing: border-box;
}

.form-input:focus {
  outline: none;
  border-color: var(--color-primary) !important;
}

.form-input::placeholder {
  color: var(--color-grey);
  opacity: 0.6;
}

textarea.form-input {
  resize: vertical;
  min-height: 60px;
}

/* Select dropdowns */
select.form-input {
  cursor: pointer;
}

select.form-input option {
  background: var(--terminal-bg);
  color: var(--color-text);
}

/* Form hint text */
.form-hint {
  font-size: 0.75em;
  color: var(--color-grey);
  opacity: 0.7;
}

/* 3-column grid row */
.form-row-3 {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

/* Radio group */
.radio-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* Radio options — matching icon-btn.active pattern */
.radio-option {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 0px;
  cursor: pointer;
  transition: all 0.15s;
  box-sizing: border-box;
  min-width: 0;
}

.radio-option:hover {
  border-color: rgba(var(--green-rgb), 0.3);
  background: rgba(var(--green-rgb), 0.03);
}

.radio-option.active {
  border-color: rgba(var(--green-rgb), 0.4);
  background: rgba(var(--green-rgb), 0.08);
}

.radio-option input[type="radio"] {
  margin-top: 2px;
  accent-color: var(--color-green);
}

.radio-option i {
  color: var(--color-green);
  margin-top: 2px;
  font-size: 0.9em;
  width: 16px;
  text-align: center;
}

.radio-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.radio-label {
  font-size: 0.85em;
  color: var(--color-text);
  font-weight: 500;
}

.radio-desc {
  font-size: 0.75em;
  color: var(--color-grey);
  opacity: 0.7;
  word-break: break-word;
}

/* Checkbox group — same border pattern as radio */
.checkbox-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.checkbox-option {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 0px;
  cursor: pointer;
  transition: all 0.15s;
  box-sizing: border-box;
  min-width: 0;
}

.checkbox-option:hover {
  border-color: rgba(var(--green-rgb), 0.3);
  background: rgba(var(--green-rgb), 0.03);
}

.checkbox-option input[type="checkbox"] {
  margin-top: 2px;
  accent-color: var(--color-green);
}

.checkbox-label {
  font-size: 0.85em;
  color: var(--color-text);
  font-weight: 500;
  white-space: nowrap;
}

.checkbox-desc {
  font-size: 0.75em;
  color: var(--color-grey);
  opacity: 0.7;
  margin-left: auto;
  text-align: right;
  word-break: break-word;
}

/* Action buttons row */
.forge-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 0;
}

/* Cancel/back button — matching modal-btn.cancel */
.cancel-btn {
  padding: 10px 20px;
  background: rgba(var(--green-rgb), 0.1);
  border: 1px solid rgba(var(--green-rgb), 0.2);
  color: var(--color-text);
  border-radius: 0px;
  cursor: pointer;
  font-size: 0.9em;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  transition: all 0.15s;
}

.cancel-btn:hover {
  background: rgba(var(--green-rgb), 0.15);
  border-color: rgba(var(--green-rgb), 0.3);
}

/* Launch button — matching modal-btn.save */
.launch-btn {
  padding: 10px 24px;
  background: var(--color-green);
  color: var(--color-dark-navy);
  border: none;
  border-radius: 0px;
  cursor: pointer;
  font-size: 0.9em;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  transition: all 0.15s;
}

.launch-btn:hover:not(:disabled) {
  opacity: 0.85;
}

.launch-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
