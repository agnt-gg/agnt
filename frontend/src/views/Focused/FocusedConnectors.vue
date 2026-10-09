<template>
  <FocusedConnection
    v-if="providerId"
    :key="providerId"
    :card-id="providerId"
    :return-item="lastPlugin ? `app:${lastPlugin}` : null"
    :return-tab="returnTab"
  />
  <!-- Edit integrations: the provider editor (custom sign-in setups), shared with Studio. -->
  <section v-else-if="showIntegrations" class="focused-page focused-integrations" aria-label="Integrations">
    <button type="button" class="focused-page-back" @click="showIntegrations = false"><i class="fas fa-arrow-left" aria-hidden="true"></i>Accounts &amp; keys</button>
    <IntegrationsScreen embedded @screen-change="(screen, options) => nav.studio(screen, options)" />
  </section>
  <!-- Keep the page mounted during sign-in and integrations, preserving search, tab and selection. -->
  <section v-show="!providerId && !showIntegrations" class="focused-page focused-apps" aria-label="Plugins">
    <AppsSection
      :selected-plugin="selectedPlugin"
      :vault-active="tab === 'vault'"
      @open-vault="nav.go({ page: 'connectors', tab: 'vault' })"
      @open-plugins="nav.go({ page: 'connectors' })"
      @select-app="openPlugin"
      @close-app="closePlugin"
      @connect="connect"
      @reconnect="connect"
      @disconnect="connect"
      @open-widget="(id) => nav.go({ page: 'library', tab: 'widgets', item: id })"
      @open-app="(name) => nav.studio('PluginsScreen', { select: { kind: 'plugin', id: name } })"
      @build-app="nav.studio('PluginsScreen')"
      @open-market="nav.go({ page: 'market' })"
      @open-ai-models="nav.go({ page: 'settings' })"
      @open-integrations="showIntegrations = true"
      @add-account="showIntegrations = true"
      @open-section="(section) => nav.studio('ConnectorsScreen', { section })"
    />
  </section>
</template>

<script setup>
// The same component supplies both shells' Plugins page: catalog, details,
// purchase checks, installer, updates and Accounts & keys. Focused owns only
// route navigation and its existing account page (FocusedConnection), which is
// where connect, reconnect and sign-out happen in this shell.
import { computed, inject, ref, watch } from 'vue';
import { lazyComponent } from '@/utils/chunkRecovery.js';
import AppsSection from '@/views/Terminal/CenterPanel/screens/Connectors/components/AppsSection.vue';
import FocusedConnection from './FocusedConnection.vue';
import { AI_PROVIDERS_WITH_API } from '@/store/app/aiProvider.js';

const IntegrationsScreen = lazyComponent(() => import('@/views/Terminal/CenterPanel/screens/Connectors/Connectors.vue'));
const props = defineProps({ item: { type: String, default: null }, tab: { type: String, default: '' } });
const nav = inject('focusedNav');
const lastPlugin = ref(null);
// The tab a sign-in started from (Accounts & keys is the route's 'vault' tab), so Back returns there.
const returnTab = ref(null);
const showIntegrations = ref(false);
const providerId = computed(() => props.item && !props.item.startsWith('app:') ? props.item : null);
const selectedPlugin = computed(() => providerId.value ? lastPlugin.value : props.item?.slice(4) || null);
watch(() => props.item, (item) => {
  if (!item) lastPlugin.value = null;
  else if (item.startsWith('app:')) lastPlugin.value = item.slice(4);
  if (!item || item.startsWith('app:')) returnTab.value = null;
}, { immediate: true });
// Any navigation within the page (a tab, a plugin, an account page) leaves the editor.
watch(() => [props.item, props.tab], () => { showIntegrations.value = false; });

function openPlugin(name) {
  if (props.item !== `app:${name}`) nav.go({ page: 'connectors', item: `app:${name}` });
}
function closePlugin() {
  if (props.item) nav.go({ page: 'connectors' });
}
// Connect, reconnect and sign out all happen on the account's own page.
function connect(connection) {
  const id = connection?.providerId;
  if (!id) return;
  // Model credentials remain Settings' responsibility in both shells.
  if (AI_PROVIDERS_WITH_API.some((provider) => provider.toLowerCase() === id.toLowerCase())) {
    nav.go({ page: 'settings' });
  } else {
    const from = props.tab || null;
    nav.go({ page: 'connectors', item: id });
    returnTab.value = from;
  }
}
</script>
