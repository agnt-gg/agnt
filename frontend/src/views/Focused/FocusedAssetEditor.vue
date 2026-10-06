<template>
  <section v-if="!loaded" class="focused-page">
    <button type="button" class="focused-page-back" @click="leave"><i class="fas fa-arrow-left" aria-hidden="true"></i>{{ tab.label }}</button>
    <p class="focused-empty">{{ loadError || 'Loading…' }}</p>
  </section>

  <FocusedEditor
    v-else
    :kind-label="tab.label"
    :back-label="tab.label"
    :icon="tab.icon"
    v-model:name="v.name"
    v-model:description="v.description"
    :read-only="readOnly"
    :note="note"
    :meta="edited"
    :name-placeholder="isNew ? `Name your ${tab.noun}` : 'Name'"
    :chat-ask="readOnly || isNew ? '' : editAsk(tab.noun, v.name)"
    :delete-label="deleteLabel"
    :dirty="dirty"
    :saving="saving"
    :error="error"
    @back="leave"
    @ask="nav.ask"
    @save="save"
    @discard="discard"
    @delete="remove"
  >
    <template #actions>
      <button v-if="fullEditor" type="button" class="focused-btn" @click="openFull">Open full editor</button>
    </template>

    <!-- Workflows: the steps, in the order they run. -->
    <section v-if="kind === 'workflows'" class="focused-edit-block">
      <div class="focused-edit-block-head">
        <h3>Steps</h3>
        <span class="focused-edit-hint">{{ v.nodes.length }} step{{ v.nodes.length === 1 ? '' : 's' }} · runs top to bottom</span>
        <span class="focused-flex"></span>
        <button v-if="!readOnly" type="button" class="focused-btn" :aria-expanded="picker.open ? 'true' : 'false'" @click="togglePicker">
          {{ picker.open ? 'Done' : 'Add step' }}
        </button>
      </div>

      <!-- The step library: triggers first, so a new workflow starts with what sets it off. -->
      <div v-if="picker.open" class="focused-step-picker">
        <input
          ref="pickerSearch"
          v-model="picker.query"
          class="focused-input"
          :placeholder="v.nodes.length ? 'Search steps to add…' : 'Start with a trigger, or search any step…'"
          aria-label="Search steps"
        />
        <p v-if="!stepLibrary" class="focused-empty">Loading steps…</p>
        <p v-else-if="!pickerGroups.length" class="focused-empty">No step matches “{{ picker.query }}”.</p>
        <div v-for="group in pickerGroups" :key="group.id" class="focused-step-picker-group">
          <h4>{{ group.label }}</h4>
          <button
            v-for="{ entry, locked } in group.items"
            :key="group.id + ':' + entry.type"
            type="button"
            class="focused-step-option"
            :disabled="locked"
            v-tooltip="locked ? 'Needs a Pro plan' : ''"
            @click="addStep(entry)"
          >
            <strong>{{ entry.title || humanKey(entry.type) }}</strong>
            <small v-if="entry.description">{{ entry.description }}</small>
            <span v-if="locked" class="focused-status-pill">Pro</span>
          </button>
          <p v-if="group.more" class="focused-foot-note">{{ group.more }} more. Search to find them.</p>
        </div>
      </div>

      <p v-if="!v.nodes.length && !picker.open" class="focused-empty">No steps yet. Add a trigger to start it, then the steps it runs.</p>
      <div class="focused-step-list">
        <details v-for="(id, i) in stepOrder" :key="id" class="focused-step-card" :open="i === 0">
          <summary class="focused-step-sum">
            <span class="focused-step-num">{{ i + 1 }}</span>
            <input
              class="focused-step-title"
              :value="node(id).text"
              :readonly="readOnly"
              aria-label="Step name"
              @click.prevent
              @keydown.space.stop
              @keydown.enter.stop.prevent
              @input="node(id).text = $event.target.value"
            />
            <span class="focused-step-type">{{ stepType(id) }}</span>
            <button v-if="!readOnly" type="button" class="focused-icon-btn" :aria-label="'Remove step ' + node(id).text" v-tooltip="'Remove step'" @click.prevent.stop="removeStep(id)">
              <i class="fas fa-times" aria-hidden="true"></i>
            </button>
          </summary>
          <div class="focused-step-params">
            <p v-if="!visibleStepParams(node(id).parameters).length" class="focused-edit-hint">No settings.</p>
            <FocusedParamField
              v-for="k in visibleStepParams(node(id).parameters)"
              :key="k"
              :name="k"
              :read-only="readOnly"
              :options="Array.isArray(node(id).parameters[k + '_options']) ? node(id).parameters[k + '_options'] : null"
              :model-value="node(id).parameters[k]"
              @update:model-value="node(id).parameters[k] = $event"
            />
          </div>
        </details>
      </div>
    </section>

    <!-- Tools -->
    <template v-else-if="kind === 'tools'">
      <section class="focused-edit-block">
        <div class="focused-edit-block-head">
          <h3>Type</h3>
          <span class="focused-edit-hint">{{ toolType.hint }}</span>
        </div>
        <div class="focused-segmented" role="radiogroup" aria-label="Tool type">
          <button
            v-for="t in TOOL_TYPES"
            :key="t.value"
            type="button"
            role="radio"
            class="focused-segment"
            :class="{ active: v.base === t.value }"
            :aria-checked="v.base === t.value ? 'true' : 'false'"
            :disabled="readOnly"
            @click="v.base = t.value"
          >
            <i :class="t.icon" aria-hidden="true"></i>{{ t.label }}
          </button>
        </div>
      </section>

      <section v-if="isPrompt" class="focused-edit-block">
        <div class="focused-edit-block-head">
          <h3>Prompt</h3>
          <span class="focused-edit-hint">What the AI does with the inputs. Use them as <code v-pre>{{Name}}</code>.</span>
        </div>
        <AutoTextarea v-model="v.instructions" class="focused-doc-edit" aria-label="Prompt" :readonly="readOnly" />
      </section>
      <section v-else class="focused-edit-block">
        <div class="focused-edit-block-head">
          <h3>Code</h3>
          <span class="focused-edit-hint">{{ codeLabel({ base: v.base }) }} · runs when an agent uses this tool. The inputs are in <code>params</code>.</span>
        </div>
        <AutoTextarea v-model="v.code" class="focused-code-edit" aria-label="Code" spellcheck="false" :readonly="readOnly" :placeholder="codePlaceholder" />
      </section>

      <section class="focused-edit-block">
        <div class="focused-edit-block-head">
          <h3>Inputs</h3>
          <span class="focused-edit-hint">{{ isPrompt ? 'What gets passed in.' : 'What the code receives.' }}</span>
          <span class="focused-flex"></span>
          <button v-if="!readOnly" type="button" class="focused-btn" @click="addInput">Add input</button>
        </div>
        <p v-if="!v.inputs.length" class="focused-empty">No inputs. Add one if the tool needs something passed in.</p>
        <div v-for="(input, idx) in v.inputs" :key="idx" class="focused-input-row">
          <input class="focused-input mono" :value="input.key" placeholder="Name" aria-label="Input name" :readonly="readOnly" @input="renameInput(input, $event)" />
          <input v-model="input.label" class="focused-input" placeholder="Label shown to people" aria-label="Label" :readonly="readOnly" />
          <CustomSelect v-model="input.type" :options="typeOptions(input.type)" :disabled="readOnly" />
          <label class="focused-req"><input v-model="input.required" type="checkbox" :disabled="readOnly" />Required</label>
          <button v-if="!readOnly" type="button" class="focused-icon-btn" :aria-label="'Remove input ' + input.key" @click="v.inputs.splice(idx, 1)">
            <i class="fas fa-times" aria-hidden="true"></i>
          </button>
        </div>
      </section>

      <section class="focused-edit-block">
        <div class="focused-edit-block-head"><h3>Settings</h3></div>
        <div class="focused-edit-card">
          <div v-if="isPrompt" class="focused-edit-row">
            <span class="focused-edit-label">Model</span>
            <div class="focused-edit-pair">
              <CustomSelect
                :model-value="v.provider"
                :options="[{ label: 'My default model', value: '' }, ...providerOptions.map((p) => ({ label: p, value: p }))]"
                :disabled="readOnly"
                @update:model-value="onProvider"
              />
              <CustomSelect v-if="v.provider" v-model="v.model" :options="modelOptions.map((m) => ({ label: m, value: m }))" :disabled="readOnly" placeholder="Choose a model" />
            </div>
          </div>
          <div class="focused-edit-row">
            <span class="focused-edit-label">Category</span>
            <input v-model="v.category" class="focused-input" placeholder="custom" aria-label="Category" :readonly="readOnly" />
          </div>
        </div>
      </section>
    </template>

    <!-- Skills -->
    <template v-else-if="kind === 'skills'">
      <section class="focused-edit-block">
        <div class="focused-edit-block-head">
          <h3>Instructions</h3>
          <span class="focused-edit-hint">What the skill teaches AGNT to do, step by step.</span>
        </div>
        <AutoTextarea
          v-model="v.instructions"
          class="focused-doc-edit"
          aria-label="Instructions"
          :readonly="readOnly"
          placeholder="For example: When asked to write a cold email, keep it under 120 words and end with one question."
        />
      </section>
      <section class="focused-edit-block">
        <div class="focused-edit-block-head"><h3>Settings</h3></div>
        <div class="focused-edit-card">
          <div class="focused-edit-row">
            <span class="focused-edit-label">Category</span>
            <input v-model="v.category" class="focused-input" placeholder="general" aria-label="Category" :readonly="readOnly" />
          </div>
        </div>
      </section>
    </template>

    <!-- Widgets: the widget as AGNT runs it, and its code. -->
    <template v-else-if="kind === 'widgets'">
      <section class="focused-edit-block">
        <div class="focused-edit-block-head">
          <h3>Preview</h3>
          <span class="focused-edit-hint">Live, with your data. Updates as you edit the code.</span>
        </div>
        <div class="focused-widget-preview">
          <CustomWidgetRenderer :key="previewKey" :definition="previewDefinition" />
        </div>
      </section>
      <section class="focused-edit-block">
        <div class="focused-edit-block-head">
          <h3>Code</h3>
          <span class="focused-edit-hint">{{ raw.widget_type || 'html' }} · what the widget runs</span>
        </div>
        <AutoTextarea v-model="v.source_code" class="focused-code-edit" aria-label="Code" spellcheck="false" :readonly="readOnly" />
      </section>
    </template>
  </FocusedEditor>
</template>

<script setup>
import { ref, reactive, computed, inject, onMounted, watch, nextTick } from 'vue';
import { useStore } from 'vuex';
import FocusedEditor from './FocusedEditor.vue';
import FocusedParamField from './FocusedParamField.vue';
import AutoTextarea from './AutoTextarea.vue';
import CustomWidgetRenderer from '@/canvas/CustomWidgetRenderer.vue';
import CustomSelect from '@/views/_components/common/CustomSelect.vue';
import { libraryTab, editAsk } from './focusedModel.js';
import { waitUntil } from './focusedTime.js';
import {
  workflowValues,
  workflowStepOrder,
  workflowPayload,
  isRunningStatus,
  stepLibraryGroups,
  addWorkflowStep,
  removeWorkflowStep,
  visibleStepParams,
  toolValues,
  toolPayload,
  codeLabel,
  TOOL_TYPES,
  isPromptTool,
  INPUT_TYPES,
  cleanInputKey,
  renameInPrompt,
  isReadOnlySkill,
  skillValues,
  skillPayload,
  widgetValues,
  widgetUpdates,
  blankRecord,
  humanKey,
  ago,
} from './focusedEditors.js';

const props = defineProps({
  kind: { type: String, required: true }, // workflows | tools | skills | widgets
  // No itemId = a new one: a blank record of its kind, created on Save.
  itemId: { type: String, default: null },
});
const isNew = computed(() => !props.itemId);
const store = useStore();
const nav = inject('focusedNav');
const tab = computed(() => libraryTab(props.kind));

const loaded = ref(false);
const loadError = ref('');
const raw = ref({});
const v = ref({});
const baseline = ref('');
const stepOrder = ref([]);
const saving = ref(false);
const error = ref('');

const readOnly = computed(() => props.kind === 'skills' && isReadOnlySkill(raw.value));
const dirty = computed(() => loaded.value && !readOnly.value && JSON.stringify(v.value) !== baseline.value);
const edited = computed(() => {
  const at = raw.value.updated_at || raw.value.updatedAt;
  return at ? 'Edited ' + ago(at) : '';
});
const note = computed(() => {
  if (readOnly.value) return 'This skill lives in a file on disk (or ships with AGNT), so it can be read here but not changed.';
  if (props.kind === 'workflows' && isRunningStatus(raw.value.status)) return 'This workflow is running. Saving restarts it with your changes.';
  return '';
});
const deleteLabel = computed(() => (isNew.value || readOnly.value || props.kind === 'tools' ? '' : `Delete ${tab.value.noun}`));
const fullEditor = computed(() => !isNew.value && ['workflows', 'tools'].includes(props.kind));

// ── Loading, through the shared stores ─────────────────────────────────────
async function fetchRaw() {
  if (isNew.value) return blankRecord(props.kind);
  if (props.kind === 'workflows') return store.dispatch('workflows/fetchWorkflowById', props.itemId);
  if (props.kind === 'tools') return store.dispatch('tools/fetchCustomTool', props.itemId);
  if (props.kind === 'widgets') {
    const w = await store.dispatch('widgetDefinitions/ensureDefinitionLoaded', props.itemId);
    if (!w) throw new Error('This widget no longer exists.');
    return w;
  }
  const find = () => (store.getters['skills/allSkills'] || []).find((s) => String(s.id) === String(props.itemId));
  if (!find()) {
    await store.dispatch('skills/fetchSkills');
    // A fetch already in flight returns at once; wait for it to land.
    if (!find()) await waitUntil(() => !!find() || !store.getters['skills/isLoading'], 15000);
  }
  const skill = find();
  if (!skill) throw new Error('This skill no longer exists.');
  return skill;
}
const VALUES = { workflows: workflowValues, tools: toolValues, skills: skillValues, widgets: widgetValues };
function apply(record) {
  raw.value = record;
  v.value = VALUES[props.kind](record);
  if (props.kind === 'workflows') stepOrder.value = workflowStepOrder(record);
  baseline.value = JSON.stringify(v.value);
}
async function load() {
  try {
    apply(await fetchRaw());
    loaded.value = true;
  } catch (e) {
    loadError.value = 'Couldn’t open this. ' + (e?.message || e);
  }
}
onMounted(load);

const node = (id) => v.value.nodes.find((n) => n.id === id);
const stepType = (id) => {
  const r = [...(raw.value.nodes || []), ...(v.value.added || [])].find((n) => n.id === id) || {};
  return humanKey(String(r.type || '').replace(/-/g, '_'));
};

// ── Adding and removing steps ───────────────────────────────────────────────
// The same step library Workflow Forge uses (tools/workflowTools).
const picker = reactive({ open: false, query: '' });
const pickerSearch = ref(null);
const stepLibrary = computed(() => store.getters['tools/workflowTools']);
const isPro = computed(() => (store.getters['userAuth/planType'] || 'free') !== 'free');
const pickerGroups = computed(() => stepLibraryGroups(stepLibrary.value, picker.query, { isPro: isPro.value }));
const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const refreshStepOrder = () => (stepOrder.value = workflowStepOrder(workflowPayload(raw.value, v.value)));

async function togglePicker() {
  picker.open = !picker.open;
  picker.query = '';
  if (!picker.open) return;
  store.dispatch('tools/fetchWorkflowTools').catch((e) => console.warn('[Focused] could not load workflow steps:', e?.message || e));
  await nextTick();
  pickerSearch.value?.focus();
}
async function addStep(entry) {
  const added = addWorkflowStep(v.value, raw.value, entry, { nodeId: crypto.randomUUID(), edgeId: crypto.randomUUID(), timeZone: timeZone() });
  refreshStepOrder();
  picker.open = false;
  picker.query = '';
  // Open the new step's card so its settings are right there.
  await nextTick();
  document.querySelectorAll('.focused-step-card')[stepOrder.value.indexOf(added.id)]?.setAttribute('open', '');
}
function removeStep(id) {
  removeWorkflowStep(v.value, raw.value, id, { edgeId: crypto.randomUUID() });
  refreshStepOrder();
}

// ── Tool inputs and model ──────────────────────────────────────────────────
const isPrompt = computed(() => isPromptTool(v.value));
const toolType = computed(() => TOOL_TYPES.find((t) => t.value === v.value.base) || { hint: codeLabel({ base: v.value.base }) });
const codePlaceholder = computed(() =>
  v.value.base === 'CODE_PYTHON'
    ? '# The inputs are in params, e.g. params["topic"]\nresult = params["topic"].upper()\nprint(result)'
    : '// The inputs are in params, e.g. params.topic\nconst result = params.topic.toUpperCase();\nconsole.log(result);',
);
function addInput() {
  v.value.inputs.push({ key: '', label: '', type: 'text', required: false });
}
function renameInput(input, e) {
  const prev = input.key;
  input.key = cleanInputKey(e.target.value);
  if (e.target.value !== input.key) e.target.value = input.key;
  if (isPrompt.value) v.value.instructions = renameInPrompt(v.value.instructions, prev, input.key);
}
const providerOptions = computed(() => {
  const list = (store.getters['aiProvider/filteredProviders'] || store.state.aiProvider?.providers || []).map((p) => (typeof p === 'string' ? p : p.name || p.id));
  const cur = v.value.provider;
  return cur && !list.includes(cur) ? [cur, ...list] : list;
});
const modelOptions = computed(() => {
  const ids = (store.state.aiProvider?.allModels?.[v.value.provider] || []).map((m) => (typeof m === 'string' ? m : m.id || m.name)).filter(Boolean);
  const cur = v.value.model;
  return cur && !ids.includes(cur) ? [cur, ...ids] : ids;
});
/** The type choices, keeping a stored type this editor does not offer. */
const typeOptions = (current) => {
  const opts = INPUT_TYPES.map(([value, label]) => ({ value, label }));
  return current && !opts.some((o) => o.value === current) ? [{ value: current, label: current }, ...opts] : opts;
};
async function onProvider(provider) {
  v.value.provider = provider;
  v.value.model = '';
  if (!v.value.provider) return;
  await store.dispatch('aiProvider/fetchProviderModels', { provider: v.value.provider }).catch(() => {});
  v.value.model = modelOptions.value[0] || '';
}
watch(
  () => loaded.value && props.kind === 'tools' && isPrompt.value && v.value.provider,
  (p) => p && store.dispatch('aiProvider/fetchProviderModels', { provider: p }).catch(() => {}),
);

// ── Widget preview ─────────────────────────────────────────────────────────
const previewDefinition = computed(() => ({ ...raw.value, ...v.value }));
// Re-mount the renderer when the code changes, debounced so typing stays smooth.
const previewKey = ref(0);
let previewTimer = null;
watch(
  () => v.value.source_code,
  () => {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => previewKey.value++, 500);
  },
);

// ── Saving, through the shared stores ──────────────────────────────────────
/** Creates the new item and returns its id. */
async function create() {
  const blank = blankRecord(props.kind);
  if (props.kind === 'workflows') return (await store.dispatch('workflows/createWorkflow', workflowPayload(blank, v.value)))?.id;
  if (props.kind === 'tools') return (await store.dispatch('tools/createTool', toolPayload(blank, v.value)))?.id;
  if (props.kind === 'skills') return (await store.dispatch('skills/createSkill', skillPayload(v.value)))?.skill?.id;
  const widget = await store.dispatch('widgetDefinitions/createDefinition', { ...widgetUpdates(widgetValues({}), v.value), widget_type: blank.widget_type });
  return widget?.id;
}
async function persist() {
  if (props.kind === 'workflows') {
    const fresh = await store.dispatch('workflows/fetchWorkflowById', props.itemId);
    await store.dispatch('workflows/updateWorkflow', workflowPayload(fresh, v.value));
    return store.dispatch('workflows/fetchWorkflowById', props.itemId);
  }
  if (props.kind === 'tools') {
    const fresh = await store.dispatch('tools/fetchCustomTool', props.itemId);
    await store.dispatch('tools/saveCustomTool', toolPayload(fresh, v.value));
    return store.dispatch('tools/fetchCustomTool', props.itemId);
  }
  if (props.kind === 'skills') {
    const res = await store.dispatch('skills/updateSkill', { id: props.itemId, skill: skillPayload(v.value) });
    return res?.skill || { ...raw.value, ...skillPayload(v.value) };
  }
  const updates = widgetUpdates(widgetValues(raw.value), v.value);
  if (Object.keys(updates).length && !(await store.dispatch('widgetDefinitions/updateDefinition', { id: props.itemId, updates }))) {
    throw new Error('AGNT didn’t accept the change.');
  }
  return { ...raw.value, ...updates };
}
async function save() {
  if (!String(v.value.name || '').trim()) {
    error.value = 'Give it a name.';
    return;
  }
  saving.value = true;
  error.value = '';
  try {
    if (isNew.value) {
      const id = await create();
      if (!id) throw new Error('AGNT didn\u2019t return the new item.');
      baseline.value = JSON.stringify(v.value); // nothing left unsaved
      nav.toast(`${tab.value.noun.charAt(0).toUpperCase() + tab.value.noun.slice(1)} created.`);
      nav.go({ page: 'library', tab: props.kind, item: String(id) });
      return;
    }
    apply(await persist());
    nav.toast('Saved.');
  } catch (e) {
    error.value = 'Couldn’t save. ' + (e?.message || e);
  } finally {
    saving.value = false;
  }
}
function discard() {
  apply(raw.value);
  error.value = '';
}

async function leave() {
  if (dirty.value && !(await nav.confirm({ title: 'Discard changes?', message: 'Your edits haven’t been saved.', confirmText: 'Discard', danger: true }))) return;
  nav.go({ page: 'library', tab: props.kind });
}
function openFull() {
  if (props.kind === 'workflows') nav.studio('WorkflowForgeScreen', { workflowId: props.itemId });
  else nav.studio('ToolForgeScreen', { toolId: props.itemId });
}
const DELETE_ACTIONS = { workflows: 'workflows/deleteWorkflow', skills: 'skills/deleteSkill', widgets: 'widgetDefinitions/deleteDefinition' };
async function remove() {
  if (!(await nav.confirm({ title: `Delete ${tab.value.noun}?`, message: `“${v.value.name}” will be deleted. This can’t be undone.`, confirmText: 'Delete', danger: true }))) return;
  try {
    const ok = await store.dispatch(DELETE_ACTIONS[props.kind], props.itemId);
    if (ok === false) throw new Error('AGNT didn’t delete it.');
    nav.toast('Deleted.');
    nav.go({ page: 'library', tab: props.kind });
  } catch (e) {
    error.value = 'Couldn’t delete. ' + (e?.message || e);
  }
}
</script>
