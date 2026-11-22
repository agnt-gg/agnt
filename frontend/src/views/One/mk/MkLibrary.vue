<template>
  <!-- The Library in the mockup's style: every asset you own, by kind, your
       files, plus the Market. Connections and plugins are on Apps. Backed by the
       real stores, the workspace and the catalog. -->
  <div class="content">
    <div class="page">
      <div class="page-head">
        <div><h1>Library</h1><p>Everything you’ve built or added.</p></div>
        <button v-if="asset" type="button" class="primary" @click="ctx.openLibrary(asset.id, null, true)"><MkIcon name="plus" size="sm" />New {{ asset.word }}</button>
      </div>
      <nav class="tabs" aria-label="Library">
        <button v-for="t in OWN_TABS" :key="t.id" type="button" class="tab" :class="{ 'is-active': tab === t.id }" @click="ctx.go({ view: 'library', tab: t.id })">
          <MkIcon :name="t.icon" size="sm" />{{ t.label }}<span v-if="counts[t.id] !== undefined" class="count">{{ counts[t.id] }}</span>
        </button>
        <!-- The Market is somewhere to get more, not a kind of your own things. -->
        <button type="button" class="tab v2-tab-link" :class="{ 'is-active': tab === 'market' }" data-tab="market" @click="ctx.go({ view: 'library', tab: 'market' })"><MkIcon name="share" size="sm" />Get more from the Market</button>
      </nav>

      <!-- Your assets of one kind. -->
      <template v-if="asset">
        <ul v-if="!rows.length" class="list"><li class="empty">{{ loading[asset.id] ? 'Loading…' : `No ${asset.label.toLowerCase()} yet. Make one, or add one ${marketShown ? 'from the picks below' : 'from the Market'}.` }}</li></ul>
        <div v-else class="cards">
          <div v-for="r in rows" :key="r.id" class="card clickable" role="button" tabindex="0" @click="ctx.openLibrary(asset.id, r.itemId)" @keydown.enter="ctx.openLibrary(asset.id, r.itemId)">
            <div class="card-top">
              <!-- Each one its own colour and initial, so a grid of them can be told apart at a glance. -->
              <span class="v2-mono" :class="'v2-hue-' + hueOf(r.label)" aria-hidden="true">{{ initialOf(r.label) }}</span>
              <h4 class="mk-ellipsis" style="min-width: 0">{{ r.label }}</h4>
            </div>
            <p>{{ r.description || 'No description yet. Open it to add one.' }}</p>
            <div v-if="r.status" class="card-foot">
              <span class="tag" :class="['listening', 'running'].includes(r.status) ? 'green' : ''">{{ statusLabel(r.status) }}</span>
            </div>
          </div>
          <!-- The way to make another, where the next one would go. -->
          <button type="button" class="card v2-new" data-action="new-asset" @click="ctx.openLibrary(asset.id, null, true)">
            <div class="card-top"><span class="r-icon"><MkIcon name="plus" size="sm" /></span><h4>New {{ asset.word }}</h4></div>
            <p>Describe what you need and Annie sets it up.</p>
          </button>
        </div>
        <!-- Market picks of this kind under your own, so an empty or short list has examples to add in place. -->
        <MarketplaceShelf
          :key="'market:' + asset.id"
          style="margin-top: 24px"
          :asset-type="asset.noun"
          variant="catalogue"
          :dismissible="false"
          :max-items="marketExpanded ? 60 : 6"
          @availability="(shown) => (marketShown = shown)"
          @browse="browseMarket"
          @installed="() => fetchAsset(asset)"
        />
      </template>

      <!-- Your files: the workspace, a folder at a time. -->
      <MkFiles v-else-if="current.id === 'files'" :dir="dir" />

      <!-- The Market: agents, workflows, tools, skills and widgets from AGNT and makers. -->
      <template v-else>
        <ul v-if="status === 'loading' && !items.length" class="list"><li class="empty">Loading…</li></ul>
        <ul v-else-if="!items.length" class="list"><li class="empty">{{ status === 'error' ? 'The Market could not load. Try again in a moment.' : 'Nothing in the Market yet.' }}</li></ul>
        <div v-else class="cards">
          <div v-for="l in items" :key="l.id" class="card">
            <div class="card-top">
              <span v-if="l.asset_type === 'agent'" class="av agent lg"><img src="/images/agnt-logo-mark.svg" alt="" /></span>
              <span v-else class="r-icon"><MkIcon :name="MARKET_ICON[l.asset_type] || 'template'" size="sm" /></span>
              <div style="min-width: 0"><h4 class="mk-ellipsis">{{ l.title }}</h4><div style="font-size: 12px; color: var(--text-tertiary)">{{ l.creator_name || l.author || 'AGNT' }}</div></div>
            </div>
            <p>{{ l.description || '' }}</p>
            <div class="row-gap"><span class="tag">{{ assetTypeLabel(l) }}</span><span v-if="Number(l.price) > 0" class="tag">${{ Number(l.price).toFixed(2) }}</span></div>
            <div class="card-foot lib-foot">
              <button type="button" class="primary" style="min-height: 30px" :disabled="busy || isInstalled(l)" @click="install(l)">{{ installingId === l.id ? 'Adding…' : isInstalled(l) ? 'Added' : 'Add to My Space' }}</button>
            </div>
          </div>
        </div>
        <p v-if="installError" class="mk-error" role="alert" style="margin-top: 12px">{{ installError }}</p>
      </template>
    </div>
    <SimpleModal ref="modalRef" />
  </div>
</template>

<script setup>
import { computed, inject, onMounted, reactive, ref, watch } from 'vue';
import { useStore } from 'vuex';
import MkIcon from './MkIcon.vue';
import MkFiles from './MkFiles.vue';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import MarketplaceShelf from '@/views/Terminal/_components/MarketplaceShelf.vue';
import { useMarketplaceInstall } from '@/composables/useMarketplaceInstall';
import { assetTypeLabel } from '@/composables/useMarketplaceCard';
import { LIBRARY_TABS } from '@/views/One/team/teamModel.js';
import { libraryTab, libraryRows } from '@/views/Focused/focusedModel.js';

const MARKET_ICON = Object.freeze({ workflow: 'bolt', tool: 'pen', skill: 'library', widget: 'board', plugin: 'plug' });
// Your own kinds of things; the Market is a link after them.
const OWN_TABS = LIBRARY_TABS.filter((t) => t.id !== 'market');
const HUES = 7;
/** A stable colour for a name, so an item keeps its colour from visit to visit. */
function hueOf(name) {
  let h = 0;
  for (const ch of String(name || '')) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return h % HUES;
}
const initialOf = (name) => (String(name || '').trim()[0] || '?').toUpperCase();
const props = defineProps({
  tab: { type: String, default: 'agents' },
  /** The Files tab's open folder ('' is the top of the workspace). */
  dir: { type: String, default: '' },
});
const ctx = inject('teamCtx');
const store = useStore();
const modalRef = ref(null);
const { handleInstall } = useMarketplaceInstall(modalRef);
const installingId = ref(null);
const installError = ref('');
const installedHere = ref(new Set());
const loading = reactive({});

const current = computed(() => LIBRARY_TABS.find((t) => t.id === props.tab) || LIBRARY_TABS[0]);
/** The Focused Library tab behind an asset tab: its store getter, fetch and noun. */
const asset = computed(() => (current.value.asset ? libraryTab(current.value.asset) : null));
const listOf = (assetTab) => store.getters[assetTab.getter] || [];
const rows = computed(() => (asset.value ? libraryRows(asset.value.id, listOf(asset.value)) : []));
const counts = computed(() => Object.fromEntries(LIBRARY_TABS.filter((t) => t.asset).map((t) => [t.id, libraryRows(t.asset, listOf(libraryTab(t.asset))).length])));

const items = computed(() => store.getters['marketplace/shelfItems'] || []);
const status = computed(() => store.getters['marketplace/shelfStatus']);
const busy = computed(() => installingId.value !== null);
const isInstalled = (l) => installedHere.value.has(String(l.id)) || (store.state.marketplace?.myInstalls || []).some((owned) => String(owned.marketplace_item_id || owned.id) === String(l.id));
// A pick opens its listing; "Show all" shows more picks here.
const marketShown = ref(false);
const marketExpanded = ref(false);
function browseMarket(listing) {
  if (listing) ctx.openMarket(listing.asset_id || listing.id);
  else marketExpanded.value = !marketExpanded.value;
}
const statusLabel = (s) => ({ listening: 'Running', running: 'Running', stopped: 'Stopped', error: 'Needs a look' })[s] || s;

async function fetchAsset(assetTab) {
  loading[assetTab.id] = true;
  try { await store.dispatch(assetTab.fetch); } catch (e) { console.warn('[Library] could not load', assetTab.id, e?.message || e); } finally { loading[assetTab.id] = false; }
}
async function install(l) {
  if (busy.value || isInstalled(l)) return;
  installingId.value = l.id;
  installError.value = '';
  try {
    const result = await handleInstall({ ...l, price: Number(l.price) || 0 });
    if (result?.success) {
      installedHere.value = new Set([...installedHere.value, String(l.id)]);
      ctx.toast(`${l.title} added to My Space`);
    } else if (result?.error) installError.value = result.error;
  } catch (e) {
    installError.value = e.message || 'Could not add it. Please try again.';
  } finally {
    installingId.value = null;
  }
}
// Every kind loads once so each tab's count is real; the Market loads when opened.
onMounted(() => {
  for (const t of LIBRARY_TABS.filter((x) => x.asset)) fetchAsset(libraryTab(t.asset));
});
watch(() => props.tab, (t) => {
  marketExpanded.value = false;
  if (t === 'market') { store.dispatch('marketplace/fetchShelfItems', {}); store.dispatch('marketplace/fetchMyInstalls'); }
}, { immediate: true });
</script>
