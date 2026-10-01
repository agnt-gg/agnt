<template>
  <!-- One memory: add, change or forget it. -->
  <section v-if="editing" class="focused-page focused-editor" :aria-label="editTitle">
    <button type="button" class="focused-page-back" @click="back"><i class="fas fa-arrow-left" aria-hidden="true"></i>Memory</button>
    <header class="focused-page-head">
      <div>
        <h1>{{ editTitle }}</h1>
        <p>{{ memory ? 'Learned ' + ago(memory.at) : 'Tell AGNT something to remember from now on.' }}</p>
      </div>
    </header>
    <p v-if="item && !memory" class="focused-empty">{{ loading ? 'Loading…' : 'This memory no longer exists.' }}</p>
    <form v-else class="focused-form" novalidate @submit.prevent="save">
      <label class="focused-field">
        <span class="focused-field-label">Memory</span>
        <AutoTextarea v-model="text" class="focused-input" maxlength="2000" placeholder="For example: I prefer short answers with the key point first." autofocus />
        <small class="focused-edit-hint">Written the way you’d tell a colleague.</small>
      </label>
      <div class="focused-field">
        <span class="focused-field-label">Type</span>
        <div class="focused-segmented" role="radiogroup" aria-label="Type">
          <button
            v-for="[val, label] in MEMORY_TYPES"
            :key="val"
            type="button"
            role="radio"
            :aria-checked="type === val ? 'true' : 'false'"
            :class="{ active: type === val }"
            @click="type = val"
          >{{ label }}</button>
        </div>
      </div>
      <p v-if="error" class="focused-save-text error">{{ error }}</p>
      <div class="focused-form-foot">
        <button v-if="memory" type="button" class="focused-btn danger" :disabled="busy" @click="forget">Forget</button>
        <span class="focused-flex"></span>
        <button type="button" class="focused-btn" :disabled="busy" @click="back">Cancel</button>
        <button type="submit" class="focused-primary" :disabled="busy">{{ busy ? 'Saving…' : memory ? 'Save' : 'Add memory' }}</button>
      </div>
    </form>
  </section>

  <!-- All memories. -->
  <FocusedPage v-else :title="page.title" :sub="page.sub" action-label="Add memory" v-model:query="query" search-placeholder="Search memories" @action="nav.go({ page: 'memory', isNew: true })">
    <p v-if="loading && !rows.length" class="focused-empty">Loading…</p>
    <p v-else-if="!rows.length" class="focused-empty">{{ query ? `No memories match “${query}”.` : 'Nothing remembered yet. AGNT learns as you work, or add something yourself.' }}</p>
    <ul v-else class="focused-list">
      <li v-for="m in rows.slice(0, CAP)" :key="m.id">
        <button type="button" class="focused-row" @click="nav.go({ page: 'memory', item: m.id })">
          <span class="focused-row-icon" aria-hidden="true"><i class="fas fa-brain"></i></span>
          <span class="focused-row-text">
            <strong class="wrap">{{ m.text }}</strong>
            <small>{{ typeLabel(m.type) }} · {{ ago(m.at) }}</small>
          </span>
          <i class="fas fa-chevron-right focused-row-go" aria-hidden="true"></i>
        </button>
      </li>
    </ul>
    <p v-if="rows.length > CAP" class="focused-foot-note">Showing {{ CAP }} of {{ rows.length.toLocaleString() }}. Search to find the rest.</p>
  </FocusedPage>
</template>

<script setup>
import { ref, computed, inject, onMounted, watch } from 'vue';
import { useStore } from 'vuex';
import FocusedPage from './FocusedPage.vue';
import AutoTextarea from './AutoTextarea.vue';
import { FOCUSED_PAGES, MEMORY_TYPES, memoryRows } from './focusedModel.js';
import { ago } from './focusedEditors.js';

const props = defineProps({ item: { type: String, default: null }, isNew: { type: Boolean, default: false } });
const store = useStore();
const nav = inject('focusedNav');
const page = FOCUSED_PAGES.memory;
const CAP = 300;

const query = ref('');
const loading = ref(false);
const busy = ref(false);
const error = ref('');

const all = computed(() => memoryRows(store.getters['insights/agentMemories']));
const rows = computed(() => memoryRows(store.getters['insights/agentMemories'], query.value));
const editing = computed(() => !!props.item || props.isNew);
const memory = computed(() => (props.item ? all.value.find((m) => m.id === String(props.item)) || null : null));
const editTitle = computed(() => (props.item ? 'Edit memory' : 'Add memory'));
const typeLabel = (t) => (MEMORY_TYPES.find(([v]) => v === t) || [t, t.charAt(0).toUpperCase() + t.slice(1)])[1];

const text = ref('');
const type = ref('fact');
function fill() {
  text.value = memory.value?.text || '';
  type.value = MEMORY_TYPES.some(([v]) => v === memory.value?.type) ? memory.value.type : 'fact';
  error.value = '';
}

async function save() {
  const content = text.value.trim();
  if (!content) {
    error.value = 'Write the memory first.';
    return;
  }
  busy.value = true;
  error.value = '';
  try {
    if (memory.value) {
      await store.dispatch('insights/updateAgentMemory', { id: memory.value.id, content, memoryType: type.value });
    } else {
      await store.dispatch('insights/addAgentMemory', { agentId: 'orchestrator', memoryType: type.value, content });
    }
    await store.dispatch('insights/fetchAllMemories');
    nav.toast(memory.value ? 'Memory updated.' : 'Memory added.');
    nav.go({ page: 'memory' });
  } catch (e) {
    error.value = 'Couldn’t save. ' + (e?.message || e);
  } finally {
    busy.value = false;
  }
}

async function forget() {
  if (!(await nav.confirm({ title: 'Forget this?', message: 'AGNT won’t remember it any more.', confirmText: 'Forget', danger: true }))) return;
  busy.value = true;
  try {
    await store.dispatch('insights/deleteAgentMemory', { id: memory.value.id });
    await store.dispatch('insights/fetchAllMemories');
    nav.toast('Forgotten.');
    nav.go({ page: 'memory' });
  } catch (e) {
    error.value = 'Couldn’t forget it. ' + (e?.message || e);
  } finally {
    busy.value = false;
  }
}

const back = () => nav.go({ page: 'memory' });

onMounted(async () => {
  if (!all.value.length) {
    loading.value = true;
    await store.dispatch('insights/fetchAllMemories').catch(() => {});
    loading.value = false;
  }
  fill();
});
watch(() => [props.item, props.isNew, memory.value?.id], fill);
</script>
