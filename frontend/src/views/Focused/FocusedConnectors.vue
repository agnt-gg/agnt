<template>
  <!-- An old link to one account: its own page. -->
  <FocusedConnection v-if="providerId" :key="providerId" :card-id="providerId" :return-tab="lastTab || null" />
  <!-- Edit a custom app: the provider editor, shared with Studio. -->
  <section v-else-if="view === 'integrations'" class="focused-page focused-integrations" aria-label="Custom apps">
    <button type="button" class="focused-page-back" @click="view = null"><i class="fas fa-arrow-left" aria-hidden="true"></i>Apps</button>
    <IntegrationsScreen embedded @screen-change="(screen, options) => nav.studio(screen, options)" />
  </section>
  <!-- Add or edit MCP servers: the MCP manager, shared with Studio. -->
  <section v-else-if="view === 'mcp'" class="focused-page focused-mcp" aria-label="Custom connection manager">
    <button type="button" class="focused-page-back" @click="view = null"><i class="fas fa-arrow-left" aria-hidden="true"></i>Custom connections</button>
    <McpServers compact />
  </section>
  <!-- One plugin in full: contents, access, trust, install and update (the Market's detail). -->
  <section v-else-if="pluginName" class="focused-page focused-apps" aria-label="Add-on">
    <AppsSection
      detail-only
      back-label="Apps"
      :selected-plugin="pluginName"
      @close-app="backToList"
      @connect="connect"
      @reconnect="connect"
      @disconnect="disconnect"
      @open-widget="(id) => nav.go({ page: 'library', tab: 'widgets', item: id })"
      @open-app="(name) => nav.studio('PluginsScreen', { select: { kind: 'plugin', id: name } })"
      @open-ai-models="nav.go({ page: 'settings' })"
      @open-workflow="(id) => nav.go({ page: 'library', tab: 'workflows', item: id })"
      @try-plugin="(plugin) => nav.ask(plugin.prompt || `Use ${plugin.displayName} to `)"
    />
  </section>
  <!-- The Apps page stays mounted underneath, so its section, search and filters survive a visit to the views above. -->
  <OneApps
    v-show="!covered"
    ref="appsRef"
    :tab="lastTab"
    :active="!covered"
    :studio-panels="studioPanels"
    @summary="(value) => emit('summary', value)"
    @open-integrations="view = 'integrations'"
    @open-mcp-manager="view = 'mcp'"
  />
</template>

<script setup>
// AGNT One's Apps page (route page 'connectors'): App connections, Plugins,
// MCP servers and Email & webhooks (OneApps). A plugin's full details, an old
// account link and the two shared editors open over it.
import { computed, inject, ref, watch } from 'vue';
import { useStore } from 'vuex';
import { lazyComponent } from '@/utils/chunkRecovery.js';
import AppsSection from '@/views/Terminal/CenterPanel/screens/Connectors/components/AppsSection.vue';
import McpServers from '@/views/Terminal/CenterPanel/screens/Connectors/components/McpServers.vue';
import OneApps from '@/views/One/apps/OneApps.vue';
import FocusedConnection from './FocusedConnection.vue';
import { AI_PROVIDERS_WITH_API } from '@/store/app/aiProvider.js';
import { useAppCards } from '@/composables/useAppCards.js';
import { findAppCard } from '@/services/appCards.js';
import { useAppSignIn } from './useAppSignIn.js';

const IntegrationsScreen = lazyComponent(() => import('@/views/Terminal/CenterPanel/screens/Connectors/Connectors.vue'));
const props = defineProps({
  item: { type: String, default: null },
  tab: { type: String, default: '' },
  // In Studio: the sections and create button live in Studio's panels (AppsScreen).
  studioPanels: { type: Boolean, default: false },
});
const emit = defineEmits(['summary']);
const appsRef = ref(null);
// Studio's panels act through the page; a details view open over it closes first.
defineExpose({
  act: (name, ...args) => { view.value = null; return appsRef.value?.act(name, ...args); },
  fix: (id) => appsRef.value?.fix(id),
  go: (section) => appsRef.value?.go(section),
});
const nav = inject('focusedNav');
const store = useStore();
const { cards } = useAppCards('', { autoload: false });
const findCard = (id) => findAppCard(cards.value, id);
const signIn = useAppSignIn({ store, nav, findCard });

const view = ref(null);
// The section the list shows: kept while a plugin's details are open, so Back returns to it.
const lastTab = ref(props.tab || '');
const providerId = computed(() => (props.item && !props.item.startsWith('app:') ? props.item : null));
const pluginName = computed(() => (props.item?.startsWith('app:') ? props.item.slice(4) : null));
const covered = computed(() => !!(providerId.value || view.value || pluginName.value));

watch(() => [props.item, props.tab], ([item, tab]) => {
  if (!item) lastTab.value = tab || '';
  // Any move to another place leaves the editors.
  view.value = null;
});

function backToList() {
  nav.go({ page: 'connectors', ...(lastTab.value ? { tab: lastTab.value } : {}) });
}
const isModelProvider = (id) => AI_PROVIDERS_WITH_API.some((provider) => provider.toLowerCase() === String(id).toLowerCase());
// Connect and disconnect from a plugin's details run in place; model keys are Settings'.
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
</script>
