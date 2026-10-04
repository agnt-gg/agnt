<template>
  <FocusedConnection v-if="item" :key="item" :provider-id="item" />
  <section v-else class="focused-market focused-page" :aria-label="page.title">
    <header class="focused-market-head focused-connectors-head">
      <div class="focused-connectors-title">
        <h1>{{ page.title }}</h1>
        <nav class="focused-market-tabs" role="tablist" aria-label="Which connectors">
          <button
            v-for="t in TABS"
            :key="t.id"
            type="button"
            role="tab"
            class="focused-tab"
            :class="{ active: tab === t.id }"
            :aria-selected="tab === t.id ? 'true' : 'false'"
            @click="selectTab(t.id)"
          >{{ t.label }}</button>
        </nav>
      </div>
      <div class="focused-connectors-actions">
        <label class="focused-page-search focused-market-search">
          <i class="fas fa-search" aria-hidden="true"></i>
          <input v-model="query" type="search" placeholder="Search connectors" aria-label="Search connectors" />
        </label>
        <button type="button" class="focused-primary" @click="nav.ask('Connect AGNT to ')">
          <i class="fas fa-plus" aria-hidden="true"></i>Add
        </button>
      </div>
    </header>

    <div class="focused-market-section-head">
      <h2>{{ heading }} <span class="focused-count">{{ list.length.toLocaleString() }}</span></h2>
      <button v-if="list.length > shown.length" type="button" class="focused-link" @click="showAll = true">
        Show all <i class="fas fa-arrow-right" aria-hidden="true"></i>
      </button>
    </div>

    <p v-if="!list.length" class="focused-empty">
      <template v-if="query">No connectors match “{{ query }}”.</template>
      <template v-else-if="tab === 'yours'">
        Nothing connected yet.
        <button type="button" class="focused-link" @click="selectTab('discover')">Discover connectors</button>
      </template>
      <template v-else>Loading…</template>
    </p>
    <div v-else class="focused-market-grid focused-connectors-grid">
      <button
        v-for="c in shown"
        :key="c.id"
        type="button"
        class="focused-card focused-connector-card"
        :aria-label="`${c.name}, ${c.status}`"
        @click="nav.go({ page: 'connectors', item: c.id })"
      >
        <FocusedConnectorLogo :provider-id="c.providerId" :name="c.name" :icon="c.icon" />
        <span class="focused-market-card-copy">
          <strong>{{ c.name }}</strong>
          <span v-if="c.description">{{ c.description }}</span>
          <small>{{ byline(c) }}</small>
        </span>
        <span class="focused-icon-btn focused-connector-state" :class="{ ok: c.connected }" aria-hidden="true">
          <i :class="c.connected ? 'fas fa-check' : 'fas fa-plus'"></i>
        </span>
      </button>
    </div>
  </section>
</template>

<script setup>
import { ref, computed, inject, watch, onMounted } from 'vue';
import { useStore } from 'vuex';
import FocusedConnection from './FocusedConnection.vue';
import FocusedConnectorLogo from './FocusedConnectorLogo.vue';
import { FOCUSED_PAGES, connectorCards } from './focusedModel.js';

defineProps({ item: { type: String, default: null } });
const store = useStore();
const nav = inject('focusedNav');
const page = FOCUSED_PAGES.connectors;

const TABS = Object.freeze([
  { id: 'yours', label: 'Yours' },
  { id: 'discover', label: 'Discover' },
]);
// Discover opens on a screenful; "Show all" (or a search) lifts the cap.
const DISCOVER_CAP = 12;

const query = ref('');
const showAll = ref(false);
const chosenTab = ref(null);

const cards = computed(() => connectorCards(store.state.appAuth?.allProviders, store.getters['appAuth/connectedApps'], query.value));
// Until the user picks, land on what they have — or on Discover if that is nothing.
const tab = computed(() => chosenTab.value || (cards.value.connected.length ? 'yours' : 'discover'));
const list = computed(() => (tab.value === 'yours' ? cards.value.connected : [...cards.value.connected, ...cards.value.available]));
const shown = computed(() => (tab.value === 'discover' && !showAll.value && !query.value ? list.value.slice(0, DISCOVER_CAP) : list.value));
const heading = computed(() => (query.value ? 'Results' : tab.value === 'yours' ? 'Connected' : 'All connectors'));

const HOW = Object.freeze({ oauth: 'Sign in', apikey: 'API key', cli: 'On this computer', account: 'AGNT account' });
function byline(c) {
  return [c.category, c.connected ? c.status : HOW[c.connectionType]].filter(Boolean).join(' · ');
}

function selectTab(id) {
  chosenTab.value = id;
  showAll.value = false;
}
watch(query, () => (showAll.value = false));

onMounted(() => {
  if (!store.state.appAuth?.allProviders?.length) store.dispatch('appAuth/fetchAllProviders').catch(() => {});
  if (!store.getters['appAuth/connectedApps']?.length) store.dispatch('appAuth/fetchConnectedApps').catch(() => {});
});
</script>
