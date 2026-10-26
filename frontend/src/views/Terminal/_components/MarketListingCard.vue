<template>
  <!-- One Market listing, laid out as agnt.gg/marketplace lays it out
       (agnt-server agnt.gg/public/marketplace.html, .catalogue-card): a 16:9
       cover with the kind and tier, then title, two lines of what it does,
       who made it, and a footer with tier · price and the one action.
       Same card in the Market page and every Library tab's Market section. -->
  <article class="mlc" :class="'mlc-' + kind" :data-listing="listing.id">
    <button type="button" class="mlc-tile" :class="cover ? 'has-cover' : 'no-cover'" :style="cover ? null : artStyle(listing)" :aria-label="listing.title" @click="$emit('open', listing)">
      <img v-if="cover" :src="cover" alt="" loading="lazy" decoding="async" @error="coverFailed = true" />
      <i v-else class="mlc-mark" :class="assetIcon(listing)" aria-hidden="true"></i>
      <span class="mlc-type">{{ assetTypeLabel(listing) }} · <b>{{ tier }}</b></span>
    </button>
    <div class="mlc-body">
      <h3><button type="button" class="mlc-title" @click="$emit('open', listing)">{{ listing.title }}</button></h3>
      <p class="mlc-desc">{{ listing.tagline || listing.description || 'No description yet.' }}</p>
      <p class="mlc-by">by <b>{{ publisher }}</b></p>
      <div class="mlc-foot">
        <span class="mlc-meta"><b>{{ tier }}</b> · {{ priceLabel }}</span>
        <button type="button" class="mlc-cta" :disabled="installing || installed" data-sound="chaChingMoney" @click="$emit('install', listing)">
          {{ installing ? 'Installing…' : installed ? 'Installed' : actionLabel }}
        </button>
      </div>
    </div>
  </article>
</template>

<script setup>
import { ref, computed } from 'vue';
import { assetIcon, assetTypeLabel, artStyle } from '@/composables/useMarketplaceCard';

const props = defineProps({
  listing: { type: Object, required: true },
  installing: { type: Boolean, default: false },
  installed: { type: Boolean, default: false },
});
defineEmits(['open', 'install']);

const coverFailed = ref(false);
const kind = computed(() => String(props.listing.asset_type || 'item'));
const cover = computed(() => (coverFailed.value ? null : props.listing.cover_url || props.listing.preview_image || null));
const TIERS = { official: 'Official', verified: 'Verified' };
const tier = computed(() => TIERS[String(props.listing.trust_tier || '').toLowerCase()] || 'Community');
// As on plugins and the website: an official listing is published by AGNT.
const publisher = computed(() => (tier.value === 'Official' ? 'AGNT' : props.listing.publisher_pseudonym || 'Anonymous'));
const price = computed(() => Number(props.listing.price) || 0);
const priceLabel = computed(() => (price.value > 0 ? `$${price.value.toFixed(2)}` : 'Free'));
// The website's verbs (agnt.gg/public/asset-actions.js): templates are got, the rest installed.
const VERBS = { agent: 'Get template', workflow: 'Get template', plugin: 'Install plugin', skill: 'Install skill', tool: 'Install tool' };
const actionLabel = computed(() => (price.value > 0 ? `Buy ${priceLabel.value}` : VERBS[kind.value] || 'Install'));
</script>

<style scoped>
.mlc {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--terminal-border-color);
  border-radius: 14px;
  background: var(--color-darker-0);
  transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
}
.mlc:hover {
  transform: translateY(-2px);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.28);
  border-color: var(--terminal-border-color-light);
}
.mlc-tile {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 16 / 9;
  padding: 0;
  border: 0;
  border-bottom: 1px solid var(--terminal-border-color);
  cursor: pointer;
  overflow: hidden;
  background: var(--color-darker-0);
}
.mlc-tile.has-cover img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
/* No cover: the item's generated art field (artStyle, inline), dark in every
   theme, so the mark uses the on-scrim ink (MarketplaceShelf's ART-INK RULE). */
.mlc-mark {
  font-size: 44px;
  color: var(--text-on-scrim);
  opacity: 0.85;
}
/* The pill sits on artwork of any colour: the shared scrim + on-scrim ink pair
   (as MarketplaceShelf's .ms-tag), so it reads on every cover in every theme. */
.mlc-type {
  position: absolute;
  top: 10px;
  left: 12px;
  z-index: 1;
  padding: 3px 8px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.13);
  background: var(--scrim);
  color: var(--text-on-scrim);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.mlc-type b {
  font-weight: 900;
}
.mlc-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
  padding: 14px 16px 16px;
}
.mlc-body h3 {
  margin: 2px 0 0;
  font-size: 17px;
  line-height: 1.2;
  letter-spacing: -0.02em;
}
.mlc-title {
  padding: 0;
  border: 0;
  background: none;
  color: var(--color-text);
  font: inherit;
  font-weight: var(--font-weight-semibold);
  text-align: left;
  cursor: pointer;
}
.mlc-title:hover {
  color: var(--color-primary);
}
.mlc-desc {
  margin: 0;
  font-size: 13.5px;
  line-height: 1.5;
  color: var(--color-text);
  opacity: 0.82;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 40.5px;
}
.mlc-by {
  margin: 0;
  font-size: 12.5px;
  color: var(--color-text);
  opacity: 0.82;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mlc-by b {
  font-weight: 700;
}
.mlc-foot {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  margin-top: auto;
  padding-top: 8px;
}
.mlc-meta {
  font-size: 12px;
  color: var(--color-text);
  opacity: 0.82;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mlc-meta b {
  color: var(--text-green);
  font-weight: 800;
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.mlc-cta {
  padding: 8px 14px;
  border: 0;
  border-radius: var(--border-radius-full);
  background: var(--fill-accent, var(--color-primary));
  color: var(--on-fill-accent);
  font-family: var(--font-family-primary);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  white-space: nowrap;
  cursor: pointer;
}
.mlc-cta:disabled {
  cursor: default;
  opacity: 0.6;
}
@media (prefers-reduced-motion: reduce) {
  .mlc,
  .mlc:hover {
    transition: none;
    transform: none;
  }
}
</style>
