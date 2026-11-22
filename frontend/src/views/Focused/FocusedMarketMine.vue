<template>
  <!-- Your side of the Market: what you earn, what you listed, and publishing.
       It was a jump to Studio's Marketplace screen; with no Market page in AGNT
       One there was no way to publish or see earnings at all (2026-10-26). -->
  <section class="focused-market-mine" aria-label="Your listings">
    <div class="fmm-stats" data-testid="market-earnings">
      <div v-for="stat in stats" :key="stat.id" class="fmm-stat" :data-stat="stat.id">
        <span>{{ stat.label }}</span>
        <strong>{{ stat.value }}</strong>
      </div>
    </div>
    <p v-if="earningsError" class="focused-empty" role="alert">Earnings couldn’t load. {{ earningsError }}</p>

    <div class="focused-market-section-head">
      <h2>Your listings</h2>
      <span>{{ listings.length }} {{ listings.length === 1 ? 'item' : 'items' }}</span>
      <button type="button" class="focused-primary fmm-publish" data-action="publish" :aria-expanded="String(picking)" @click="picking = !picking">
        <i class="fas fa-upload" aria-hidden="true"></i>Publish
      </button>
    </div>

    <!-- Publish: pick the thing, then the listing form. Two clicks to the form. -->
    <div v-if="picking" class="fmm-picker" data-testid="publish-picker">
      <nav class="focused-market-tabs" aria-label="What to publish">
        <button v-for="k in kinds" :key="k.noun" type="button" class="focused-tab" :class="{ active: kind === k.noun }" :aria-pressed="kind === k.noun" :data-kind="k.noun" @click="kind = k.noun">
          <i :class="k.icon" aria-hidden="true"></i>{{ k.label }}<span class="focused-count">{{ itemsOf(k).length }}</span>
        </button>
      </nav>
      <ul v-if="pickable.length" class="focused-list">
        <li v-for="item in pickable" :key="item.id">
          <button type="button" class="focused-row" :data-pick="item.id" @click="choose(item)">
            <span class="focused-row-icon" aria-hidden="true"><i :class="currentKind.icon"></i></span>
            <span class="focused-row-text"><strong>{{ labelOf(item) }}</strong><small v-if="item.description">{{ item.description }}</small></span>
            <span v-if="listedIds.has(String(item.id))" class="focused-status-pill live">Listed</span>
            <i class="fas fa-chevron-right focused-row-go" aria-hidden="true"></i>
          </button>
        </li>
      </ul>
      <p v-else class="focused-empty">You have no {{ currentKind.label.toLowerCase() }} yet.</p>
    </div>

    <ul v-if="listings.length" class="focused-list" data-testid="my-listings">
      <li v-for="listing in listings" :key="listing.id" class="focused-row static" :data-listing="listing.id">
        <span class="focused-row-icon" aria-hidden="true"><i :class="assetIcon(listing)"></i></span>
        <span class="focused-row-text">
          <strong>{{ listing.title || 'Untitled' }}</strong>
          <small>{{ assetTypeLabel(listing) }} · {{ priceOf(listing) }} · {{ installsLabel(Number(listing.downloads ?? listing.installs) || 0) }}{{ isLive(listing) ? '' : ' · Not listed now' }}</small>
        </span>
        <button v-if="isLive(listing)" type="button" class="focused-btn" data-action="view" @click="$emit('open', listing)">View</button>
        <button type="button" class="focused-btn" :data-action="isLive(listing) ? 'unshare' : 'reshare'" :disabled="busyId === listing.id" @click="toggle(listing)">
          {{ isLive(listing) ? 'Stop listing' : 'List again' }}
        </button>
      </li>
    </ul>
    <p v-else-if="loaded" class="focused-empty" data-testid="no-listings">Nothing listed yet. Publish an agent, workflow, tool or skill and it shows here with its installs and earnings.</p>

    <MarketplaceFormModal
      :is-open="!!target"
      mode="publish"
      :item-type="target ? target.kind : 'agent'"
      :item="target ? target.item : null"
      :categories="target ? categoriesFor(target.kind) : []"
      :stripe-connected="stripeConnected"
      :show-preview-image="true"
      @close="target = null"
      @submit="publish"
      @setup-stripe="nav.studio('MarketplaceScreen')"
      @open-billing="nav.go({ page: 'settings' })"
    />
  </section>
</template>

<script setup>
import { ref, computed, inject, onMounted } from 'vue';
import { useStore } from 'vuex';
import MarketplaceFormModal from '@/views/_components/common/MarketplaceFormModal.vue';
import { assetIcon, assetTypeLabel, installsLabel } from '@/composables/useMarketplaceCard';
import { LIBRARY_TABS } from './focusedModel.js';
import { PUBLISHABLE_KINDS, buildPublishRequest, fetchStripeConnected, money } from '@/services/marketplacePublish.js';

defineEmits(['open']);
const store = useStore();
const nav = inject('focusedNav');

const kinds = LIBRARY_TABS.filter((t) => PUBLISHABLE_KINDS.includes(t.noun));
const CATEGORY_GETTERS = { agent: 'agents/agentCategories', workflow: 'workflows/workflowCategories', tool: 'tools/toolCategories', skill: 'skills/skillCategories' };

const picking = ref(false);
const kind = ref('agent');
const target = ref(null);
const busyId = ref(null);
const loaded = ref(false);
const earningsError = ref('');
const stripeConnected = ref(false);

const itemsOf = (k) => store.getters[k.getter] || [];
const currentKind = computed(() => kinds.find((k) => k.noun === kind.value) || kinds[0]);
const pickable = computed(() => itemsOf(currentKind.value));
const labelOf = (item) => item.name || item.title || 'Untitled';
const categoriesFor = (k) => store.getters[CATEGORY_GETTERS[k]] || [];

const listings = computed(() => store.state.marketplace?.myPublishedItems || []);
const listedIds = computed(() => new Set(listings.value.map((l) => String(l.asset_id ?? l.workflow_id ?? ''))));
const isLive = (listing) => !/unpublished|draft|removed|archived/i.test(String(listing.status || 'published'));
const priceOf = (listing) => (Number(listing.price) > 0 ? money(listing.price) : 'Free');

const earnings = computed(() => store.state.marketplace?.myEarnings || {});
const stats = computed(() => [
  { id: 'net', label: 'You earned', value: money(earnings.value.totalNetEarnings) },
  { id: 'month', label: 'This month', value: money(earnings.value.thisMonthNetEarnings) },
  { id: 'sales', label: 'Sales', value: (Number(earnings.value.totalSales) || 0).toLocaleString() },
  { id: 'installs', label: 'Installs', value: listings.value.reduce((n, l) => n + (Number(l.downloads ?? l.installs) || 0), 0).toLocaleString() },
]);

function choose(item) {
  target.value = { kind: kind.value, item };
}

async function publish(form) {
  const { kind: k, item } = target.value || {};
  try {
    const request = await buildPublishRequest(k, item, form);
    await store.dispatch('marketplace/publishWorkflow', request);
    target.value = null;
    picking.value = false;
    await store.dispatch('marketplace/fetchMyPublishedItems', { force: true });
    nav.toast(`${labelOf(item)} is listed on the Market.`);
  } catch (e) {
    // The form stays open so nothing typed is lost; the reason is shown.
    await nav.confirm({ title: 'Couldn’t publish', message: e?.message || String(e), confirmText: 'OK' });
  }
}

async function toggle(listing) {
  busyId.value = listing.id;
  const wasLive = isLive(listing);
  try {
    await store.dispatch(wasLive ? 'marketplace/unpublishMarketplaceItem' : 'marketplace/republishMarketplaceItem', listing.id);
    await store.dispatch('marketplace/fetchMyPublishedItems', { force: true });
    nav.toast(wasLive ? 'Not listed any more.' : 'Listed again.');
  } catch (e) {
    nav.toast(`That didn’t work. ${e?.message || ''}`);
  } finally {
    busyId.value = null;
  }
}

onMounted(async () => {
  // Library lists are usually loaded at boot; fetch only what is still empty.
  kinds.forEach((k) => {
    if (!itemsOf(k).length) store.dispatch(k.fetch).catch((e) => console.warn(`[Market] could not load ${k.id}:`, e?.message || e));
  });
  fetchStripeConnected().then((connected) => { stripeConnected.value = connected; });
  const [published, earned] = await Promise.allSettled([
    store.dispatch('marketplace/fetchMyPublishedItems', { force: true }),
    store.dispatch('marketplace/fetchMyEarnings', { force: true }),
  ]);
  if (published.status === 'rejected') console.warn('[Market] listings:', published.reason?.message || published.reason);
  if (earned.status === 'rejected') earningsError.value = earned.reason?.message || '';
  loaded.value = true;
});
</script>

<style scoped>
.fmm-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-lg);
}
.fmm-stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 14px 16px;
  border: 1px solid var(--terminal-border-color);
  border-radius: var(--border-radius-lg);
  background: var(--color-darker-0);
}
.fmm-stat span {
  font-size: var(--font-size-xs);
  color: var(--color-text);
  opacity: 0.82;
}
.fmm-stat strong {
  font-size: var(--font-size-xl, 22px);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text);
  font-variant-numeric: tabular-nums;
}
.fmm-publish {
  margin-left: auto;
}
.fmm-picker {
  margin-bottom: var(--spacing-lg);
  padding: var(--spacing-md);
  border: 1px solid var(--terminal-border-color);
  border-radius: var(--border-radius-lg);
}
.fmm-picker .focused-market-tabs {
  margin-bottom: var(--spacing-sm);
}
</style>
