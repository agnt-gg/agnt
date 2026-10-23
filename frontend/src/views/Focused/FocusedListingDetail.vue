<!-- A Market listing (agent, workflow, tool, skill): what it contains and does,
     in the Plugins page's own layout and styles (PluginDetail): the lead
     action, what's inside, the access it uses, the package. Every fact comes
     from the listing (services/marketplaceListingDetail.js). -->
<template>
  <div class="apps-studio detail-only focused-listing-detail">
    <div class="ap-layout has-detail">
      <aside class="ap-detail" aria-label="Details">
        <button type="button" class="ap-btn quiet small ap-back" data-action="back" @click="emit('back')"><AppsIcon name="back" /> Browse Market</button>
        <article class="ap-plugin-detail" :data-listing="listing.id">
          <header class="ap-detail-head">
            <div class="ap-identity">
              <span class="ap-logo large"><i :class="assetIcon(listing)" aria-hidden="true"></i></span>
              <div>
                <h2 class="ap-detail-name">{{ listing.title }}</h2>
                <p class="ap-sub">{{ subline }}</p>
              </div>
            </div>
            <div class="ap-detail-actions">
              <span v-if="tier" class="ap-badge" :class="tier.id" v-tooltip="tier.detail">{{ tier.label }}</span>
              <span class="ap-grow"></span>
              <button type="button" class="ap-btn primary" data-action="install" :disabled="installed || installing" @click="emit('install')">{{ installLabel }}</button>
            </div>
            <p v-if="listing.tagline" class="ap-hint ap-next-line">{{ listing.tagline }}</p>
          </header>

          <div class="ap-detail-body">
            <section v-if="description" class="ap-detail-section">
              <p class="ap-hint focused-listing-text">{{ description }}</p>
            </section>

            <section class="ap-detail-section" data-section="inside">
              <h3>What’s inside <small v-if="detail.itemCount">{{ detail.itemCount }} {{ detail.itemCount === 1 ? 'item' : 'items' }}</small></h3>
              <div v-if="detail.groups.length" class="ap-inside">
                <details v-for="(group, index) in detail.groups" :key="group.key" class="ap-inside-group" :data-group="group.key" :open="index === 0">
                  <summary>
                    <span class="ap-inside-icon"><AppsIcon :name="group.icon" /></span>
                    <span class="ap-inside-label"><strong>{{ group.label }}<span>{{ group.items.length }}</span></strong></span>
                    <AppsIcon class="ap-inside-chevron" name="chevron" />
                  </summary>
                  <div class="ap-inside-items">
                    <div v-for="item in group.items" :key="item.id" class="ap-inside-item" :data-item="item.id">
                      <div>
                        <strong><span v-if="group.numbered" class="focused-listing-num">{{ item.number }}</span>{{ item.name }}</strong>
                        <small v-if="item.detail">{{ item.detail }}</small>
                        <dl v-if="item.settings && item.settings.length" class="ap-kv focused-listing-settings">
                          <template v-for="setting in item.settings" :key="setting.key"><dt>{{ setting.key }}</dt><dd>{{ setting.value }}</dd></template>
                        </dl>
                      </div>
                    </div>
                  </div>
                </details>
              </div>
              <p v-else class="ap-hint">{{ detail.known ? 'Nothing else is listed inside it.' : 'The publisher hasn’t included what’s inside.' }}</p>
            </section>

            <section v-if="detail.instructions" class="ap-detail-section" data-section="instructions">
              <details class="ap-inside-group focused-listing-long">
                <summary>
                  <span class="ap-inside-icon"><AppsIcon name="book" /></span>
                  <span class="ap-inside-label"><strong>{{ detail.instructionsLabel }}</strong><small>{{ lineCount(detail.instructions) }}</small></span>
                  <AppsIcon class="ap-inside-chevron" name="chevron" />
                </summary>
                <pre>{{ detail.instructions }}</pre>
              </details>
            </section>

            <section v-if="detail.code" class="ap-detail-section" data-section="code">
              <details class="ap-inside-group focused-listing-long">
                <summary>
                  <span class="ap-inside-icon"><AppsIcon name="code" /></span>
                  <span class="ap-inside-label"><strong>{{ detail.codeLabel }}</strong><small>{{ lineCount(detail.code) }}</small></span>
                  <AppsIcon class="ap-inside-chevron" name="chevron" />
                </summary>
                <pre>{{ detail.code }}</pre>
              </details>
            </section>

            <section class="ap-detail-section" data-section="access">
              <h3>Access it uses</h3>
              <ul v-if="detail.access.length" class="ap-caps">
                <li v-for="entry in detail.access" :key="entry.id" :data-access="entry.id">
                  <AppsIcon :name="entry.icon" />
                  <div>{{ entry.label }}<small>Through {{ entry.because.join(', ') }}</small></div>
                </li>
              </ul>
              <ul v-else-if="detail.known" class="ap-caps">
                <li><AppsIcon name="check" /><div>Uses no special access<small>Nothing it includes runs programs, touches files or reaches the internet on its own.</small></div></li>
              </ul>
              <p v-else class="ap-hint">The publisher hasn’t included enough to tell.</p>
              <dl v-if="tier" class="ap-kv"><dt>Trust</dt><dd>{{ tier.label }} · {{ tier.detail }}</dd></dl>
              <p class="ap-hint">Read from what the publisher shipped. Only install from publishers you trust.</p>
            </section>

            <section class="ap-detail-section" data-section="package">
              <h3>Package</h3>
              <dl class="ap-kv">
                <dt>Type</dt><dd>{{ assetTypeLabel(listing) }}</dd>
                <dt>Publisher</dt><dd>{{ publisher }}</dd>
                <template v-for="fact in detail.facts" :key="fact.key"><dt>{{ fact.key }}</dt><dd>{{ fact.value }}</dd></template>
                <template v-if="listing.current_version"><dt>Version</dt><dd>{{ listing.current_version }}</dd></template>
                <template v-if="listing.category"><dt>Category</dt><dd>{{ titleFromSlug(listing.category) }}</dd></template>
                <template v-if="requirements"><dt>Needs</dt><dd>{{ requirements }}</dd></template>
                <dt>Price</dt><dd>{{ price }}</dd>
                <dt>Installs</dt><dd>{{ Number(listing.downloads) || 0 }}</dd>
              </dl>
            </section>
          </div>
        </article>
      </aside>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import AppsIcon from '@/views/Terminal/CenterPanel/screens/Connectors/components/AppsIcon.vue';
import '@/views/Terminal/CenterPanel/screens/Connectors/components/apps/apps-ui.css';
import { assetIcon, assetTypeLabel } from '@/composables/useMarketplaceCard';
import { listingDetail } from '@/services/marketplaceListingDetail.js';
import { trustTier } from '@/services/pluginDirectory.js';
import { titleFromSlug } from '@/services/studioApps.js';

const props = defineProps({
  listing: { type: Object, required: true },
  installed: { type: Boolean, default: false },
  installing: { type: Boolean, default: false },
});
const emit = defineEmits(['install', 'back']);

const detail = computed(() => listingDetail(props.listing) || { groups: [], access: [], facts: [], itemCount: 0, known: false });
const tier = computed(() => trustTier({ trustTier: props.listing.trust_tier }));
// As on plugins: an official listing is published by AGNT (publisherName).
const publisher = computed(() => (tier.value?.id === 'official' ? 'AGNT' : props.listing.publisher_pseudonym || 'Not listed'));
const price = computed(() => (Number(props.listing.price) > 0 ? `$${Number(props.listing.price).toFixed(2)}` : 'Free'));
const installLabel = computed(() => (props.installing ? 'Installing…' : props.installed ? 'Installed' : Number(props.listing.price) > 0 ? `Get · ${price.value}` : `Get ${assetTypeLabel(props.listing).toLowerCase()}`));
const description = computed(() => String(props.listing.long_description || props.listing.description || '').trim());
const requirements = computed(() => (typeof props.listing.requirements === 'string' ? props.listing.requirements.trim() : ''));
const subline = computed(() => [assetTypeLabel(props.listing), `by ${publisher.value}`, props.listing.current_version ? `v${props.listing.current_version}` : ''].filter(Boolean).join(' · '));
const lineCount = (value) => {
  const lines = String(value || '').split('\n').length;
  return `${lines} line${lines === 1 ? '' : 's'} · open to read it all`;
};
</script>
