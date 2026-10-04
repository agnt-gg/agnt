<template>
  <section class="focused-market focused-page" aria-label="Market">
    <SimpleModal ref="modal" />
    <header class="focused-market-head">
      <div><h1>Market</h1><p>A little more possibility.</p></div>
      <button type="button" class="focused-link" @click="nav.studio('MarketplaceScreen')">Publish & manage <i class="fas fa-arrow-right" aria-hidden="true"></i></button>
    </header>

    <template v-if="item">
      <button type="button" class="focused-back" @click="nav.go({ page: 'market' })"><i class="fas fa-arrow-left" aria-hidden="true"></i> Browse Market</button>
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
          <button type="button" class="focused-link" @click="nav.studio('MarketplaceScreen', { select: { kind: 'marketplace', id: selectedItem.id } })">Reviews & more details <i class="fas fa-arrow-right" aria-hidden="true"></i></button>
        </div>
      </article>
      <div v-else-if="status === 'ready'" class="focused-empty" role="status">This item is no longer available. <button type="button" class="focused-link" @click="nav.go({ page: 'market' })">Browse Market</button></div>
    </template>

    <template v-else>
      <div class="focused-market-controls">
        <nav class="focused-market-tabs" aria-label="Asset types">
          <button v-for="tab in tabs" :key="tab.id" type="button" class="focused-tab" :class="{ active: type === tab.id }" :aria-pressed="type === tab.id" @click="type = tab.id">{{ tab.label }}</button>
        </nav>
        <label class="focused-page-search focused-market-search"><i class="fas fa-search" aria-hidden="true"></i><input v-model="query" type="search" placeholder="Search Market" aria-label="Search Market" /></label>
      </div>

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
        <div class="focused-market-grid">
          <article v-for="listing in visibleItems" :key="listing.id" class="focused-market-card">
            <button type="button" class="focused-market-card-open" @click="openItem(listing)">
              <span class="focused-market-tile" :style="iconStyle(listing)"><img v-if="imageFor(listing)" :src="imageFor(listing)" alt="" @error="hideImage(listing)" /><i v-else :class="assetIcon(listing)" aria-hidden="true"></i></span>
              <span class="focused-market-card-copy"><strong>{{ listing.title }}</strong><span>{{ listing.tagline || listing.description || assetTypeLabel(listing) }}</span><small>{{ assetTypeLabel(listing) }} · {{ listing.publisher_pseudonym || 'Anonymous' }}</small></span>
            </button>
            <button type="button" class="focused-market-get" :aria-label="`${installLabel(listing)} ${listing.title}`" :disabled="busy || isInstalled(listing)" @click="install(listing)">{{ installLabel(listing) }}</button>
          </article>
        </div>
      </template>
      <div v-else-if="status === 'ready'" class="focused-empty" role="status">{{ query || type !== 'all' ? 'Nothing matches yet.' : 'The collection is empty for now.' }} <button v-if="query || type !== 'all'" type="button" class="focused-link" @click="query = ''; type = 'all'">Clear filters</button></div>
    </template>

    <div v-if="status === 'loading' || status === 'idle'" class="focused-empty" role="status">Loading Market…</div>
    <div v-else-if="status === 'error'" class="focused-empty" role="alert">Market couldn’t load. <button type="button" class="focused-link" @click="load(true)">Try again</button></div>
    <p v-if="installError" class="focused-empty" role="alert">{{ installError }}</p>
  </section>
</template>

<script setup>
import { ref, computed, inject, onMounted } from 'vue';
import { useStore } from 'vuex';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import { useMarketplaceInstall } from '@/composables/useMarketplaceInstall';
import { MARKETPLACE_ASSET_TYPES, assetIcon, assetTypeLabel, artStyle, iconStyle, installsLabel, matchesQuery, byPopularity } from '@/composables/useMarketplaceCard';

const props = defineProps({ item: { type: String, default: null } });
const nav = inject('focusedNav');
const store = useStore();
const modal = ref(null);
const { handleInstall } = useMarketplaceInstall(modal);
const type = ref('all');
const query = ref('');
const installingId = ref(null);
const installError = ref('');
const installedHere = ref(new Set());
const failedImages = ref(new Set());
const tabs = [{ id: 'all', label: 'Discover' }, ...MARKETPLACE_ASSET_TYPES.map(id => ({ id, label: `${assetTypeLabel({ asset_type: id })}s` }))];
const status = computed(() => store.getters['marketplace/shelfStatus']);
const items = computed(() => store.getters['marketplace/shelfItems'] || []);
const visibleItems = computed(() => items.value.filter(listing => (type.value === 'all' || listing.asset_type === type.value) && matchesQuery(listing, query.value)).slice().sort(byPopularity));
const selectedItem = computed(() => items.value.find(listing => String(listing.id) === props.item));
const spotlight = computed(() => visibleItems.value[0]);
const busy = computed(() => installingId.value !== null);
const isInstalled = listing => installedHere.value.has(String(listing.id)) || (store.state.marketplace?.myInstalls || []).some(owned => String(owned.marketplace_item_id || owned.id) === String(listing.id));
const price = listing => Number(listing.price) > 0 ? `$${Number(listing.price).toFixed(2)}` : 'Get';
const installLabel = listing => String(installingId.value) === String(listing.id) ? 'Installing…' : isInstalled(listing) ? 'Installed' : price(listing);
const openItem = listing => nav.go({ page: 'market', item: String(listing.id) });
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
onMounted(() => { load(); store.dispatch('marketplace/fetchMyInstalls'); });
</script>
