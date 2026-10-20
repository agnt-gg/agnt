<template>
  <!-- An open item, or a new one (blank, created on Save): Focused's own
       editor for its kind. -->
  <FocusedAgentEditor v-if="(location.item || location.isNew) && tab.id === 'agents'" :key="'a:' + (location.item || 'new')" :agent-id="location.item" />
  <FocusedAssetEditor
    v-else-if="(location.item || location.isNew) && tab.id !== 'files'"
    :key="tab.id + ':' + (location.item || 'new')"
    :kind="tab.id"
    :item-id="location.item"
  />
  <FocusedFiles v-else-if="tab.id === 'files'" :key="'files'" :dir="location.dir || ''" :file="location.item || ''">
    <template #tabs><LibraryTabs :tabs="tabs" :current="tab.id" :counts="counts" @select="selectTab" /></template>
  </FocusedFiles>

  <!-- The list. -->
  <FocusedPage
    v-else
    :title="page.title"
    :sub="page.sub"
    :action-label="'New ' + tab.noun"
    :action-quiet="isEmptyTab"
    :searchable="!isEmptyTab"
    v-model:query="query"
    :search-placeholder="`Search ${(counts[tab.id] ?? '').toLocaleString()} ${tab.label.toLowerCase()}`.replace('  ', ' ')"
    @action="nav.go({ page: 'library', tab: tab.id, isNew: true })"
  >
    <template #tabs><LibraryTabs :tabs="tabs" :current="tab.id" :counts="counts" @select="selectTab" /></template>

    <!-- No upgrade offer here: the Library is your own work, and scheduling
         (the paid part) is offered where it applies, on Routines. -->
    <p v-if="loading && !rows.length" class="focused-empty">Loading…</p>
    <p v-else-if="!rows.length && query" class="focused-empty">No {{ tab.label.toLowerCase() }} match “{{ query }}”.</p>
    <!-- An empty tab: what goes here, and the one way to start, which is asking. -->
    <div v-else-if="!rows.length" class="focused-empty one-empty-cta" data-testid="library-empty">
      <p>{{ EMPTY_LINE[tab.id] || `Your ${tab.label.toLowerCase()} show up here.` }}</p>
      <button type="button" class="focused-primary" data-action="ask-make" @click="nav.ask(`Make me ${article(tab.noun)} ${tab.noun} that `)">
        <i class="fas fa-comment-dots" aria-hidden="true"></i>Ask Annie to make one
      </button>
    </div>
    <ul v-else class="focused-list">
      <li v-for="r in shownRows" :key="r.id">
        <button type="button" class="focused-row" @click="openItem(r.itemId)">
          <span class="focused-row-icon" aria-hidden="true"><FocusedGlyph :icon="r.icon" :fallback="tab.icon" /></span>
          <span class="focused-row-text">
            <strong>{{ r.label }}</strong>
            <small v-if="r.description">{{ r.description }}</small>
          </span>
          <span v-if="r.status" class="focused-status-pill" :class="statusClass(r.status)">{{ r.status.replace(/_/g, ' ') }}</span>
          <i class="fas fa-chevron-right focused-row-go" aria-hidden="true"></i>
        </button>
      </li>
    </ul>
    <p v-if="rows.length > shownRows.length" class="focused-foot-note">
      Showing {{ shownRows.length }} of {{ rows.length.toLocaleString() }}. Search to find the rest.
    </p>

    <!-- Owned work first; discovery remains available after the list and its count. -->
    <!-- Picks of this tab's own kind only: agents offered on the Widgets tab
         read as a mistake. A kind with no picks shows none. -->
    <MarketplaceShelf :key="'market:' + tab.id" :asset-type="tab.noun" variant="strip" :dismissible="false" @browse="browseMarket" @installed="() => store.dispatch(tab.fetch)" />
  </FocusedPage>
</template>

<script setup>
import { ref, computed, watch, inject, onMounted, defineComponent, h } from 'vue';
import { useStore } from 'vuex';
import FocusedPage from './FocusedPage.vue';
import FocusedAgentEditor from './FocusedAgentEditor.vue';
import FocusedAssetEditor from './FocusedAssetEditor.vue';
import FocusedFiles from './FocusedFiles.vue';
import FocusedGlyph from './FocusedGlyph.vue';
import MarketplaceShelf from '@/views/Terminal/_components/MarketplaceShelf.vue';
import { FOCUSED_PAGES, LIBRARY_TABS, libraryTab, libraryRows } from './focusedModel.js';
import { isRunningStatus } from './focusedEditors.js';

const props = defineProps({ location: { type: Object, required: true } });
const store = useStore();
const nav = inject('focusedNav');

const page = FOCUSED_PAGES.library;
const tabs = LIBRARY_TABS;
const tab = computed(() => libraryTab(props.location.tab));
const query = ref('');
const loading = ref(false);
// A long list renders its first rows; search narrows it (the demo's cap).
const CAP = 200;

const itemsFor = (t) => (t.getter ? store.getters[t.getter] || [] : []);
const counts = computed(() => Object.fromEntries(tabs.filter((t) => t.getter).map((t) => [t.id, itemsFor(t).length])));
const rows = computed(() => (tab.value.getter ? libraryRows(tab.value.id, itemsFor(tab.value), query.value) : []));
const shownRows = computed(() => rows.value.slice(0, CAP));
// Nothing of this kind yet (not merely filtered out): the body leads with asking.
const isEmptyTab = computed(() => !loading.value && !query.value && !(counts.value[tab.value.id] > 0));

const statusClass = (s) => (isRunningStatus(s) ? 'live' : /^(failed|error)$/i.test(s) ? 'bad' : '');

// What each kind is for, in one line, for a first-time visitor.
const EMPTY_LINE = Object.freeze({
  agents: 'An agent is a teammate with one job. Describe the job and Annie sets it up.',
  workflows: 'A workflow is a set of steps that runs the same way every time.',
  tools: 'A tool lets Annie and your agents do one specific thing, like call an API.',
  skills: 'A skill teaches Annie how you like a kind of task done.',
  widgets: 'A widget is a live card for your dashboard.',
});
const article = (noun) => (/^[aeiou]/i.test(noun) ? 'an' : 'a');

function browseMarket(listing) { nav.openScreen('MarketplaceScreen', { listing }); }

function selectTab(id) {
  query.value = '';
  nav.go({ page: 'library', tab: id, dir: '' });
}
function openItem(itemId) {
  nav.go({ page: 'library', tab: tab.value.id, item: itemId });
}

// Most lists are loaded at boot; fetch only what is still empty, so opening
// the Library never re-downloads what the app already holds.
async function ensureLoaded(t) {
  if (!t.getter || itemsFor(t).length) return;
  loading.value = true;
  try {
    await store.dispatch(t.fetch);
  } catch (e) {
    console.warn(`[Focused] could not load ${t.id}:`, e?.message || e);
  } finally {
    loading.value = false;
  }
}
onMounted(() => tabs.forEach((t) => ensureLoaded(t)));
watch(tab, (t) => {
  query.value = '';
  ensureLoaded(t);
});

// The tab strip, shared by the list and the Files browser.
const LibraryTabs = defineComponent({
  props: { tabs: Array, current: String, counts: Object },
  emits: ['select'],
  setup(p, { emit }) {
    return () =>
      h(
        'div',
        { class: 'focused-tabs', role: 'tablist' },
        p.tabs.map((t) =>
          h(
            'button',
            {
              key: t.id,
              type: 'button',
              role: 'tab',
              class: ['focused-tab', { active: t.id === p.current }],
              'aria-selected': t.id === p.current ? 'true' : 'false',
              onClick: () => emit('select', t.id),
            },
            [
              h('i', { class: t.icon, 'aria-hidden': 'true' }),
              t.label,
              p.counts[t.id] != null ? h('span', { class: 'focused-count' }, p.counts[t.id].toLocaleString()) : null,
            ],
          ),
        ),
      );
  },
});
</script>
