<template>
  <SimplePage
    :title="page.title"
    :sub="page.sub"
    :action-label="'New ' + current.noun"
    v-model:query="query"
    :search-placeholder="`Search ${current.label.toLowerCase()}`"
    @action="$emit('ask', current.ask)"
  >
    <template #tabs>
      <div class="simple-tabs" role="tablist">
        <button
          v-for="t in tabs"
          :key="t.id"
          type="button"
          role="tab"
          class="simple-tab"
          :class="{ active: t.id === current.id }"
          :aria-selected="t.id === current.id ? 'true' : 'false'"
          @click="selectTab(t.id)"
        >
          <i :class="t.icon" aria-hidden="true"></i>{{ t.label }}<span class="simple-count">{{ counts[t.id] ?? '' }}</span>
        </button>
        <button type="button" role="tab" class="simple-tab" aria-selected="false" @click="$emit('run', filesAction)">
          <i class="fas fa-folder" aria-hidden="true"></i>Files
        </button>
      </div>
    </template>

    <p v-if="loading && !rows.length" class="simple-empty">Loading…</p>
    <p v-else-if="!rows.length" class="simple-empty">
      {{ query ? `No ${current.label.toLowerCase()} match “${query}”.` : `Nothing here yet. Ask in chat to make your first ${current.noun}.` }}
    </p>
    <ul v-else class="simple-list">
      <li v-for="r in rows" :key="r.id">
        <button type="button" class="simple-row" @click="$emit('run', r.action)">
          <span class="simple-row-icon" aria-hidden="true">
            <i v-if="isIconClass(r.icon)" :class="r.icon"></i><template v-else>{{ r.icon }}</template>
          </span>
          <span class="simple-row-text">
            <strong>{{ r.label }}</strong>
            <small v-if="r.description">{{ r.description }}</small>
          </span>
          <i class="fas fa-chevron-right simple-row-go" aria-hidden="true"></i>
        </button>
      </li>
    </ul>
  </SimplePage>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { useStore } from 'vuex';
import SimplePage from './SimplePage.vue';
import { SIMPLE_PAGES, LIBRARY_TABS, LIBRARY_FILES_ACTION, libraryTab, libraryRows, isIconClass } from './simpleModel.js';

const props = defineProps({ tab: { type: String, default: 'agents' } });
const emit = defineEmits(['run', 'ask', 'update:tab']);

const store = useStore();
const page = SIMPLE_PAGES.library;
const tabs = LIBRARY_TABS;
const filesAction = LIBRARY_FILES_ACTION;
const query = ref('');
const loading = ref(false);

const current = computed(() => libraryTab(props.tab));
const itemsFor = (t) => store.getters[t.getter] || [];
const counts = computed(() => Object.fromEntries(tabs.map((t) => [t.id, itemsFor(t).length])));
const rows = computed(() => libraryRows(current.value.id, itemsFor(current.value), query.value));

function selectTab(id) {
  query.value = '';
  emit('update:tab', id);
}

// Most of these are loaded at boot; fetch only what is still empty, so
// opening the Library never re-downloads lists the app already holds.
async function ensureLoaded(t) {
  if (itemsFor(t).length) return;
  loading.value = true;
  try {
    await store.dispatch(t.fetch);
  } catch (e) {
    console.warn(`[Simple] could not load ${t.id}:`, e?.message || e);
  } finally {
    loading.value = false;
  }
}
onMounted(() => tabs.forEach((t) => ensureLoaded(t)));
watch(current, (t) => ensureLoaded(t));
</script>
