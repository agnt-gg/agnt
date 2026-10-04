<template>
  <FocusedConnection v-if="item" :key="item" :card-id="item" />
  <section v-else class="focused-market focused-page" :aria-label="page.title">
    <header class="focused-market-head focused-connectors-head">
      <div class="focused-connectors-title">
        <h1>{{ page.title }}</h1>
        <nav class="focused-market-tabs" role="tablist" aria-label="Which apps">
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
          <input ref="searchEl" v-model="query" type="search" placeholder="Search apps" aria-label="Search apps" />
        </label>
        <button type="button" class="focused-primary" @click="addConnector">
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

    <p v-if="attention && tab === 'yours' && !query" class="focused-empty focused-apps-attention" role="status">{{ attention }}</p>

    <p v-if="!list.length" class="focused-empty">
      <template v-if="query">No apps match “{{ query }}”.</template>
      <template v-else-if="loading">Loading…</template>
      <template v-else-if="tab === 'yours'">
        Nothing connected yet.
        <button type="button" class="focused-link" @click="selectTab('discover')">Discover apps</button>
      </template>
      <template v-else>Everything available is already yours.</template>
    </p>
    <div v-else class="focused-market-grid focused-connectors-grid">
      <button
        v-for="c in shown"
        :key="c.id"
        type="button"
        class="focused-card focused-connector-card"
        :aria-label="`${c.name}, ${STATUS_WORD[c.status]}`"
        @click="nav.go({ page: 'connectors', item: c.id })"
      >
        <FocusedConnectorLogo :provider-id="c.providerId || c.id" :name="c.name" :icon="c.icon" />
        <span class="focused-market-card-copy">
          <strong>{{ c.name }}</strong>
          <span v-if="c.apps.length > 1">{{ c.apps.map((a) => a.displayName).join(', ') }}</span>
          <span v-else-if="c.description">{{ c.description }}</span>
          <small>{{ byline(c) }}</small>
        </span>
        <span class="focused-icon-btn focused-connector-state" :class="{ ok: c.status === 'ready', warn: c.status === 'reconnect' }" aria-hidden="true">
          <i :class="STATE_ICON[c.status]"></i>
        </span>
      </button>
    </div>
  </section>
</template>

<script setup>
// Focused's Apps page. One card per thing you connect, from the same model as
// Studio's Apps view (services/appCards via useAppCards): Google is one card
// holding Gmail, Sheets, Drive …; Figma Bridge is a card with no sign-in.
import { ref, computed, inject, watch, nextTick } from 'vue';
import FocusedConnection from './FocusedConnection.vue';
import FocusedConnectorLogo from './FocusedConnectorLogo.vue';
import { FOCUSED_PAGES } from './focusedModel.js';
import { useAppCards } from '@/composables/useAppCards.js';

defineProps({ item: { type: String, default: null } });
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

const { cards, loading } = useAppCards(query);
// Until the user picks, land on what they have — or on Discover if that is nothing.
const tab = computed(() => chosenTab.value || (cards.value.yours.length || loading.value ? 'yours' : 'discover'));
const list = computed(() => (tab.value === 'yours' ? cards.value.yours : cards.value.discover));
const shown = computed(() => (tab.value === 'discover' && !showAll.value && !query.value ? list.value.slice(0, DISCOVER_CAP) : list.value));
const heading = computed(() => (query.value ? 'Results' : tab.value === 'yours' ? 'Your apps' : 'Connect more'));

const STATUS_WORD = Object.freeze({ ready: 'Ready', connect: 'Needs sign-in', reconnect: 'Sign-in stopped working' });
const STATE_ICON = Object.freeze({ ready: 'fas fa-check', connect: 'fas fa-plus', reconnect: 'fas fa-exclamation' });
const HOW = Object.freeze({ oauth: 'Sign in', apikey: 'API key' });
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
function byline(c) {
  const parts = [];
  if (c.apps.length > 1) parts.push(plural(c.apps.length, 'app'));
  else if (c.counts.tools) parts.push(plural(c.counts.tools, 'tool'));
  if (c.counts.widgets) parts.push(plural(c.counts.widgets, 'widget'));
  parts.push(c.status === 'connect' && !c.apps.length ? HOW[c.connectionType] || 'Connect' : STATUS_WORD[c.status]);
  return parts.join(' · ');
}
const attention = computed(() => {
  const broken = cards.value.yours.filter((c) => c.status === 'reconnect').length;
  const waiting = cards.value.yours.filter((c) => c.status === 'connect').length;
  return [broken && `${plural(broken, 'sign-in')} stopped working`, waiting && `${plural(waiting, 'app')} need${waiting === 1 ? 's' : ''} a sign-in`]
    .filter(Boolean)
    .join(' · ');
});

function selectTab(id) {
  chosenTab.value = id;
  showAll.value = false;
}
// Add = pick one to connect: every service, search ready. Each card opens
// its own page here, so adding never leaves for the chat.
const searchEl = ref(null);
async function addConnector() {
  selectTab('discover');
  showAll.value = true;
  await nextTick();
  searchEl.value?.focus();
}
watch(query, () => (showAll.value = false));
</script>
