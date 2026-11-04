<template>
  <section class="focused-market focused-page" aria-label="Market">
    <SimpleModal ref="modal" />
    <header class="focused-market-head">
      <div><h1>Market</h1><p>A little more possibility.</p></div>
      <button v-if="!item" type="button" class="focused-link" data-action="your-listings" @click="type = 'mine'">Your listings &amp; earnings <i class="fas fa-arrow-right" aria-hidden="true"></i></button>
    </header>

    <!-- A plugin listing: the Plugins page's own detail (what's inside, the
         access it declares, trust, package), so the Market shows exactly what
         a plugin does before you get it (2026-10-21). -->
    <template v-if="item && pluginName">
      <AppsSection
        detail-only
        back-label="Back"
        :selected-plugin="pluginName"
        @close-app="backFromListing()"
        @connect="connect"
        @reconnect="connect"
        @disconnect="disconnect"
        @open-widget="(id) => nav.go({ page: 'library', tab: 'widgets', item: id })"
        @open-app="(name) => nav.studio('PluginsScreen', { select: { kind: 'plugin', id: name } })"
        @open-ai-models="nav.go({ page: 'settings' })"
        @try-plugin="(plugin) => nav.ask(plugin.prompt || `Use ${plugin.displayName} to `)"
      />
    </template>

    <!-- An agent, workflow, tool or skill: what it contains and does, in the
         same layout (FocusedListingDetail), 2026-10-21. -->
    <template v-else-if="item && selectedItem && listingDetail(selectedItem)">
      <FocusedListingDetail
        :listing="selectedItem"
        :installed="isInstalled(selectedItem)"
        :installing="String(installingId) === String(selectedItem.id)"
        @install="install(selectedItem)"
        @back="backFromListing()"
        @details="nav.studio('MarketplaceScreen', { listing: selectedItem })"
      />
    </template>

    <template v-else-if="item">
      <button type="button" class="focused-back" @click="backFromListing()"><i class="fas fa-arrow-left" aria-hidden="true"></i> Back</button>
      <article v-if="selectedItem" class="focused-market-detail">
        <div class="focused-market-detail-art" :style="artStyle(selectedItem)">
          <img v-if="imageFor(selectedItem)" :src="imageFor(selectedItem)" alt="" @error="hideImage(selectedItem)" />
          <i v-else :class="assetIcon(selectedItem)" aria-hidden="true"></i>
        </div>
        <div class="focused-market-detail-body">
          <span class="focused-market-kind">{{ assetTypeLabel(selectedItem) }}</span>
          <h2>{{ selectedItem.title }}</h2>
          <p class="focused-market-author">By {{ selectedItem.publisher_pseudonym || 'Anonymous' }}</p>
          <p>{{ selectedItem.tagline || selectedItem.description || 'No description provided.' }}</p>
          <div class="focused-market-meta">
            <span>{{ installsLabel(Number(selectedItem.downloads) || 0) }}</span>
            <span v-if="Number(selectedItem.rating_count) > 0"><i class="fas fa-star" aria-hidden="true"></i> {{ Number(selectedItem.rating).toFixed(1) }} · {{ selectedItem.rating_count }} ratings</span>
            <span v-else>Not yet rated</span>
          </div>
          <button type="button" class="focused-market-get" :disabled="busy || isInstalled(selectedItem)" @click="install(selectedItem)">{{ installLabel(selectedItem) }}</button>
          <p v-if="selectedItem.description && selectedItem.tagline" class="focused-market-description">{{ selectedItem.description }}</p>
          <button type="button" class="focused-link" @click="nav.studio('MarketplaceScreen', { listing: selectedItem })">Reviews & more details <i class="fas fa-arrow-right" aria-hidden="true"></i></button>
        </div>
      </article>
      <div v-else-if="status === 'ready'" class="focused-empty" role="status">This item is no longer available. <button type="button" class="focused-link" @click="backFromListing()">Back</button></div>
    </template>

    <template v-else>
      <div class="focused-market-controls">
        <nav class="focused-market-tabs" aria-label="Asset types">
          <button v-for="tab in tabs" :key="tab.id" type="button" class="focused-tab" :class="{ active: type === tab.id }" :aria-pressed="type === tab.id" @click="type = tab.id">{{ tab.label }}</button>
        </nav>
        <label v-if="type !== 'mine'" class="focused-page-search focused-market-search"><i class="fas fa-search" aria-hidden="true"></i><input v-model="query" type="search" placeholder="Search Market" aria-label="Search Market" /></label>
      </div>

      <FocusedMarketMine v-if="type === 'mine'" @open="openItem" />

      <template v-if="type !== 'mine'">
      <div v-if="status === 'ready' && !query && type === 'all' && spotlight" class="focused-market-spotlight">
        <div class="focused-market-spotlight-copy">
          <span class="focused-market-kind">Discover {{ assetTypeLabel(spotlight).toLowerCase() }}s</span>
          <h2>{{ spotlight.title }}</h2>
          <p>{{ spotlight.tagline || spotlight.description || 'Find something useful. Make it yours.' }}</p>
          <button type="button" class="focused-market-get" @click="openItem(spotlight)">Take a look <i class="fas fa-arrow-right" aria-hidden="true"></i></button>
        </div>
        <button type="button" class="focused-market-spotlight-art" :style="artStyle(spotlight)" :aria-label="`View ${spotlight.title}`" @click="openItem(spotlight)">
          <img v-if="imageFor(spotlight)" :src="imageFor(spotlight)" alt="" @error="hideImage(spotlight)" />
          <i v-else :class="assetIcon(spotlight)" aria-hidden="true"></i>
        </button>
      </div>

      <template v-if="status === 'ready' && visibleItems.length">
        <div class="focused-market-section-head"><h2>{{ query ? 'Search results' : type === 'all' ? 'Explore the collection' : tabs.find(t => t.id === type)?.label }}</h2><span>{{ visibleItems.length }} {{ visibleItems.length === 1 ? 'item' : 'items' }}</span></div>
        <!-- The cards agnt.gg/marketplace shows (MarketListingCard). -->
        <div class="focused-market-catalogue">
          <MarketListingCard
            v-for="listing in visibleItems"
            :key="listing.id"
            :listing="listing"
            :installing="String(installingId) === String(listing.id)"
            :installed="isInstalled(listing)"
            @open="openItem"
            @install="install"
          />
        </div>
      </template>
      <div v-else-if="status === 'ready'" class="focused-empty" role="status">{{ query || type !== 'all' ? 'Nothing matches yet.' : 'The collection is empty for now.' }} <button v-if="query || type !== 'all'" type="button" class="focused-link" @click="query = ''; type = 'all'">Clear filters</button></div>
      </template>
    </template>

    <div v-if="type !== 'mine' && (status === 'loading' || status === 'idle')" class="focused-empty" role="status">Loading Market…</div>
    <div v-else-if="status === 'error'" class="focused-empty" role="alert">Market couldn’t load. <button type="button" class="focused-link" @click="load(true)">Try again</button></div>
    <p v-if="installError" class="focused-empty" role="alert">{{ installError }}</p>
  </section>
</template>

<script setup>
import { ref, computed, inject, onMounted } from 'vue';
import { useStore } from 'vuex';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import { useMarketplaceInstall } from '@/composables/useMarketplaceInstall';
import { MARKETPLACE_ASSET_TYPES, assetIcon, assetTypeLabel, artStyle, installsLabel, matchesQuery, byPopularity } from '@/composables/useMarketplaceCard';
import { marketplaceItemKey, matchesMarketplaceKey } from '@/services/marketplaceLink.js';
import AppsSection from '@/views/Terminal/CenterPanel/screens/Connectors/components/AppsSection.vue';
import FocusedListingDetail from './FocusedListingDetail.vue';
import FocusedMarketMine from './FocusedMarketMine.vue';
import MarketListingCard from '@/views/Terminal/_components/MarketListingCard.vue';
import { listingDetail } from '@/services/marketplaceListingDetail.js';
import { AI_PROVIDERS_WITH_API } from '@/store/app/aiProvider.js';
import { useAppCards } from '@/composables/useAppCards.js';
import { findAppCard } from '@/services/appCards.js';
import { useAppSignIn } from './useAppSignIn.js';

const props = defineProps({ item: { type: String, default: null }, tab: { type: String, default: null } });
const nav = inject('focusedNav');
const store = useStore();
const modal = ref(null);
const { handleInstall } = useMarketplaceInstall(modal);
// `mine` is Your listings & earnings; the rest filter the collection by kind.
const type = ref(props.tab === 'mine' ? 'mine' : 'all');
const query = ref('');
const installingId = ref(null);
const installError = ref('');
const installedHere = ref(new Set());
const failedImages = ref(new Set());
const tabs = [{ id: 'all', label: 'Discover' }, ...MARKETPLACE_ASSET_TYPES.map(id => ({ id, label: `${assetTypeLabel({ asset_type: id })}s` })), { id: 'mine', label: 'Your listings' }];
const status = computed(() => store.getters['marketplace/shelfStatus']);
const items = computed(() => store.getters['marketplace/shelfItems'] || []);
const visibleItems = computed(() => items.value.filter(listing => (type.value === 'all' || listing.asset_type === type.value) && matchesQuery(listing, query.value)).slice().sort(byPopularity));
// `item` is a link key: asset id (shelves, agnt:// links) or listing id.
const selectedItem = computed(() => items.value.find(listing => matchesMarketplaceKey(listing, props.item)));
const spotlight = computed(() => visibleItems.value[0]);
// Back from a listing: to the Market when it was opened here; otherwise to
// the page whose Market section opened it (a Library tab, or Plugins).
const LISTING_HOME = { agent: 'agents', workflow: 'workflows', tool: 'tools', skill: 'skills', widget: 'widgets' };
const openedHere = ref(false);
function backFromListing() {
  if (openedHere.value) {
    openedHere.value = false;
    return nav.go({ page: 'market', ...(type.value === 'mine' ? { tab: 'mine' } : {}) });
  }
  const kind = selectedItem.value?.asset_type;
  if (kind === 'plugin') nav.go({ page: 'connectors' });
  else nav.go({ page: 'library', tab: LISTING_HOME[kind] || 'agents' });
}
// A plugin listing's asset_id is the plugin's name in the catalog. Shown as the
// Plugins page's detail when the catalog has it; otherwise the listing view.
const catalogNames = computed(() => new Set([...(store.getters['apps/available'] || []), ...(store.getters['apps/installed'] || [])].map((p) => p?.name).filter(Boolean)));
const pluginName = computed(() => (selectedItem.value?.asset_type === 'plugin' && catalogNames.value.has(selectedItem.value.asset_id) ? selectedItem.value.asset_id : null));
// As the Plugins page does: the sign-in runs right here, model keys in Settings.
const { cards: appCards } = useAppCards();
const findCard = (id) => findAppCard(appCards.value, id);
const signIn = useAppSignIn({ store, nav, findCard });
const isModelProvider = (id) => AI_PROVIDERS_WITH_API.some((provider) => provider.toLowerCase() === id.toLowerCase());
function connect(connection) {
  const id = connection?.providerId;
  if (!id) return;
  if (isModelProvider(id)) return nav.go({ page: 'settings' });
  const card = findCard(id);
  if (card) signIn.signIn(card);
  else nav.go({ page: 'connectors', item: id });
}
function disconnect(connection) {
  const id = connection?.providerId;
  if (!id) return;
  if (isModelProvider(id)) return nav.go({ page: 'settings' });
  const card = findCard(id);
  if (card) signIn.disconnect(card);
  else nav.go({ page: 'connectors', item: id });
}
const busy = computed(() => installingId.value !== null);
const isInstalled = listing => installedHere.value.has(String(listing.id)) || (store.state.marketplace?.myInstalls || []).some(owned => String(owned.marketplace_item_id || owned.id) === String(listing.id));
const price = listing => Number(listing.price) > 0 ? `$${Number(listing.price).toFixed(2)}` : 'Get';
const installLabel = listing => String(installingId.value) === String(listing.id) ? 'Installing…' : isInstalled(listing) ? 'Installed' : price(listing);
const openItem = listing => {
  openedHere.value = true;
  nav.go({ page: 'market', item: marketplaceItemKey(listing) });
};
const imageFor = listing => failedImages.value.has(String(listing.id)) ? null : listing.preview_image;
const hideImage = listing => { failedImages.value = new Set([...failedImages.value, String(listing.id)]); };
async function load(force = false) {
  await store.dispatch('marketplace/fetchShelfItems', { force });
}
async function install(listing) {
  if (busy.value || isInstalled(listing)) return;
  installingId.value = listing.id;
  installError.value = '';
  try {
    const result = await handleInstall({ ...listing, price: Number(listing.price) || 0 });
    if (result?.success) {
      installedHere.value = new Set([...installedHere.value, String(listing.id)]);
      nav.toast(`${listing.title} installed`);
    } else if (result?.error) installError.value = result.error;
  } catch (error) {
    console.error('[FocusedMarket] install failed:', error);
    installError.value = error.message || 'Installation failed. Please try again.';
  } finally {
    installingId.value = null;
  }
}
onMounted(() => {
  load();
  store.dispatch('marketplace/fetchMyInstalls');
  // The plugin catalog, to show a plugin listing as the Plugins page does.
  Promise.all([store.dispatch('apps/fetchAvailable'), store.dispatch('apps/fetchInstalled')]).catch((e) => console.warn('[FocusedMarket] plugin catalog:', e?.message || e));
});
</script>
