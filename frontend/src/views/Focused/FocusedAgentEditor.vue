<template>
  <FocusedEditor
    v-if="(agent || isNew) && loaded"
    kind-label="Agents"
    back-label="Agents"
    v-model:name="v.name"
    v-model:description="v.description"
    name-placeholder="Agent name"
    description-placeholder="What this agent does"
    :chat-ask="isNew ? '' : editAsk('agent', v.name || agent.name)"
    :delete-label="isNew ? '' : 'Delete agent'"
    :meta="lastUsed"
    :dirty="dirty"
    :saving="saving"
    :error="error"
    @back="back"
    @ask="nav.ask"
    @save="save"
    @discard="discard"
    @delete="remove"
  >
    <template #icon>
      <!-- An agent's avatar is an image: the same picker and resize as Studio's create modal. -->
      <button type="button" class="focused-edit-icon editable" v-tooltip="v.icon ? 'Change avatar' : 'Add an avatar'" :aria-label="v.icon ? 'Change avatar' : 'Add an avatar'" @click="avatarInput?.click()">
        <FocusedGlyph :icon="v.icon" fallback="fas fa-camera" />
      </button>
      <input ref="avatarInput" type="file" accept="image/*" hidden @change="onAvatar" />
    </template>

    <section class="focused-edit-block">
      <div class="focused-edit-block-head">
        <h3>Instructions</h3>
        <span class="focused-edit-hint">What the agent is for and how it should work.</span>
      </div>
      <AutoTextarea
        v-model="v.systemPrompt"
        class="focused-doc-edit"
        aria-label="Instructions"
        placeholder="For example: You help me triage my inbox. Every morning, summarize what needs a reply and draft answers."
      />
    </section>

    <section class="focused-edit-block">
      <div class="focused-edit-block-head"><h3>Settings</h3></div>
      <div class="focused-edit-card">
        <div class="focused-edit-row">
          <span class="focused-edit-label">Model</span>
          <div class="focused-edit-pair">
            <CustomSelect
              :model-value="v.provider"
              :options="[{ label: 'My default model', value: '' }, ...providerOptions.map((p) => ({ label: p, value: p }))]"
              @update:model-value="onProvider"
            />
            <CustomSelect
              v-if="v.provider"
              v-model="v.model"
              :options="modelOptions.map((m) => ({ label: m, value: m }))"
              :disabled="modelsLoading"
              :placeholder="modelsLoading ? 'Loading…' : 'Choose a model'"
            />
          </div>
        </div>
        <div class="focused-edit-row">
          <span class="focused-edit-label">Active</span>
          <button type="button" class="focused-switch" role="switch" :aria-checked="v.active ? 'true' : 'false'" aria-label="Active" @click="v.active = !v.active"></button>
        </div>
      </div>
    </section>

    <section class="focused-edit-block">
      <div class="focused-edit-block-head">
        <h3>Tools</h3>
        <span class="focused-edit-hint">{{ tools.open ? 'This agent can use every tool.' : `${tools.chosen.length} chosen` }}</span>
      </div>
      <div class="focused-edit-card">
        <div class="focused-edit-row">
          <span class="focused-edit-label">Every tool</span>
          <button type="button" class="focused-switch" role="switch" :aria-checked="tools.open ? 'true' : 'false'" aria-label="Every tool" @click="tools.open = !tools.open"></button>
        </div>
        <div v-if="!tools.open" class="focused-edit-row column">
          <ListWithSearch v-model="tools.chosen" :items="allTools" label-key="title" id-key="id" item-noun="tools" placeholder="Search tools…" />
        </div>
      </div>
    </section>

    <section class="focused-edit-block">
      <div class="focused-edit-block-head">
        <h3>Skills</h3>
        <span class="focused-edit-hint">{{ skills.length ? `${skills.length} chosen` : 'What this agent knows how to do.' }}</span>
      </div>
      <div class="focused-edit-card">
        <div class="focused-edit-row column">
          <ListWithSearch v-model="skills" :items="allSkills" label-key="name" id-key="id" item-noun="skills" placeholder="Search skills…" />
        </div>
      </div>
    </section>
  </FocusedEditor>
  <section v-else class="focused-page">
    <button type="button" class="focused-page-back" @click="back"><i class="fas fa-arrow-left" aria-hidden="true"></i>Agents</button>
    <p class="focused-empty">{{ agent || loadingAgents ? 'Loading…' : 'This agent no longer exists.' }}</p>
  </section>
</template>

<script setup>
import { ref, reactive, computed, inject, onMounted, watch } from 'vue';
import { useStore } from 'vuex';
import FocusedEditor from './FocusedEditor.vue';
import AutoTextarea from './AutoTextarea.vue';
import CustomSelect from '@/views/_components/common/CustomSelect.vue';
import ListWithSearch from '@/views/Terminal/_components/ListWithSearch.vue';
import FocusedGlyph from './FocusedGlyph.vue';
import { agentValues, agentPayload, ago } from './focusedEditors.js';
import { readAvatarFile } from '@/utils/avatarImage.js';
import { editAsk } from './focusedModel.js';
import { waitUntil } from './focusedTime.js';

// No agentId = a new agent: a blank form, created on Save.
const props = defineProps({ agentId: { type: String, default: null } });
const store = useStore();
const nav = inject('focusedNav');

const isNew = computed(() => !props.agentId);
const loadingAgents = ref(false);
const agent = computed(() => (isNew.value ? null : (store.getters['agents/allAgents'] || []).find((a) => String(a.id) === String(props.agentId)) || null));

const v = reactive(agentValues({}));
const tools = reactive({ open: false, chosen: [] });
const skills = ref([]);
// Dirty = differs from what was loaded or last saved (both reactive, so the
// save bar appears on the first keystroke and goes away after a save).
// Nothing is dirty before the first load: on a cold deep link the agents
// arrive after mount, and an empty form compared to them used to read as
// "changed" — which then stopped them loading at all.
const loaded = ref(false);
const baseline = ref('');
const snapshot = () => JSON.stringify({ v, tools, skills: skills.value });
function load(a) {
  Object.assign(v, agentValues(a));
  tools.open = a.toolAccessMode === 'open';
  tools.chosen = [...(a.assignedTools || [])];
  skills.value = [...(a.assignedSkills || [])];
  baseline.value = snapshot();
  loaded.value = true;
}
const dirty = computed(() => loaded.value && snapshot() !== baseline.value);

const saving = ref(false);
const error = ref('');
const lastUsed = computed(() => (agent.value?.lastActive ? 'Last used ' + ago(agent.value.lastActive) : ''));

// Provider / model, from the shared AI-provider store.
const providerOptions = computed(() => {
  const list = (store.getters['aiProvider/filteredProviders'] || store.state.aiProvider?.providers || []).map((p) => (typeof p === 'string' ? p : p.name || p.id));
  return v.provider && !list.includes(v.provider) ? [v.provider, ...list] : list;
});
const modelsLoading = ref(false);
const modelOptions = computed(() => {
  const raw = store.state.aiProvider?.allModels?.[v.provider] || [];
  const ids = raw.map((m) => (typeof m === 'string' ? m : m.id || m.name)).filter(Boolean);
  return v.model && !ids.includes(v.model) ? [v.model, ...ids] : ids;
});
async function loadModels() {
  if (!v.provider) return;
  modelsLoading.value = true;
  try {
    await store.dispatch('aiProvider/fetchProviderModels', { provider: v.provider });
  } catch (e) {
    console.warn('[Focused] could not load models:', e?.message || e);
  } finally {
    modelsLoading.value = false;
  }
}
async function onProvider(provider) {
  v.provider = provider;
  v.model = '';
  await loadModels();
  if (!v.model) v.model = modelOptions.value[0] || '';
}

// Tools and skills, from the shared stores.
const allTools = computed(() => store.getters['tools/allTools'] || []);
const allSkills = computed(() => store.getters['skills/allSkills'] || []);

const avatarInput = ref(null);
async function onAvatar(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  try {
    v.icon = await readAvatarFile(file);
    error.value = '';
  } catch (e) {
    error.value = 'Couldn’t use that image. ' + (e?.message || e);
  }
}

async function save() {
  if (!v.name.trim()) {
    error.value = 'Give the agent a name.';
    return;
  }
  saving.value = true;
  error.value = '';
  try {
    const payload = { ...agentPayload(agent.value || {}, v), toolAccessMode: tools.open ? 'open' : 'restricted', assignedTools: [...tools.chosen], assignedSkills: [...skills.value] };
    if (isNew.value) {
      const res = await store.dispatch('agents/createAgent', payload);
      const id = res?.agentId || res?.agent?.id;
      if (!id) throw new Error('AGNT didn\u2019t return the new agent.');
      baseline.value = snapshot(); // nothing left unsaved: leave without asking
      nav.toast('Agent created.');
      nav.go({ page: 'library', tab: 'agents', item: String(id) });
      return;
    }
    await store.dispatch('agents/updateAgent', payload);
    load({ ...agent.value, ...payload });
    nav.toast('Agent saved.');
  } catch (e) {
    error.value = 'Couldn’t save. ' + (e?.message || e);
  } finally {
    saving.value = false;
  }
}
function discard() {
  load(agent.value || {});
  error.value = '';
}
async function back() {
  if (dirty.value && !(await nav.confirm({ title: 'Discard changes?', message: 'Your edits to this agent haven’t been saved.', confirmText: 'Discard', danger: true }))) return;
  nav.go({ page: 'library', tab: 'agents' });
}
async function remove() {
  if (!(await nav.confirm({ title: 'Delete agent?', message: `“${agent.value.name}” will be deleted. This can’t be undone.`, confirmText: 'Delete', danger: true }))) return;
  try {
    await store.dispatch('agents/deleteAgent', agent.value.id);
    nav.toast('Agent deleted.');
    nav.go({ page: 'library', tab: 'agents' });
  } catch (e) {
    error.value = 'Couldn’t delete. ' + (e?.message || e);
  }
}

onMounted(async () => {
  if (isNew.value) {
    load({});
  } else if (!agent.value) {
    loadingAgents.value = true;
    // fetchAgents returns at once when a boot fetch is already running; the
    // watch below loads the agent when that one lands.
    await store.dispatch('agents/fetchAgents').catch(() => {});
    if (!agent.value) await waitUntil(() => !store.getters['agents/isLoading'], 15000);
    loadingAgents.value = false;
  }
  if (agent.value) load(agent.value);
  if (!allTools.value.length) store.dispatch('tools/fetchTools').catch(() => {});
  if (!allSkills.value.length) store.dispatch('skills/fetchSkills').catch(() => {});
  loadModels();
});
// Arrived late, or saved elsewhere (Annie, Studio) while open and untouched
// here: follow it.
watch(agent, (a) => {
  if (a && !isNew.value && (!loaded.value || !dirty.value)) load(a);
});
</script>
