<template>
  <FocusedConnection
    v-if="providerId"
    :key="providerId"
    :card-id="providerId"
    :return-item="lastPlugin ? `app:${lastPlugin}` : null"
  />
  <!-- Keep the catalog mounted during sign-in, preserving search, tab and selection. -->
  <section v-show="!providerId" class="focused-page focused-apps" aria-label="Plugins">
    <AppsSection
      :selected-plugin="selectedPlugin"
      @select-app="openPlugin"
      @close-app="closePlugin"
      @connect="connect"
      @reconnect="connect"
      @open-widget="(id) => nav.go({ page: 'library', tab: 'widgets', item: id })"
      @open-app="(name) => nav.studio('PluginsScreen', { select: { kind: 'plugin', id: name } })"
      @build-app="nav.studio('PluginsScreen')"
      @open-market="nav.go({ page: 'market' })"
      @add-account="nav.studio('ConnectorsScreen', { section: 'oauth' })"
    />
  </section>
</template>

<script setup>
// The same component supplies both shells' catalog, details, purchase checks and installer.
// Focused owns only route navigation and its existing account-connection pages.
import { computed, inject, ref, watch } from 'vue';
import AppsSection from '@/views/Terminal/CenterPanel/screens/Connectors/components/AppsSection.vue';
import FocusedConnection from './FocusedConnection.vue';
import { AI_PROVIDERS_WITH_API } from '@/store/app/aiProvider.js';

const props = defineProps({ item: { type: String, default: null } });
const nav = inject('focusedNav');
const lastPlugin = ref(null);
const providerId = computed(() => props.item && !props.item.startsWith('app:') ? props.item : null);
const selectedPlugin = computed(() => providerId.value ? lastPlugin.value : props.item?.slice(4) || null);
watch(() => props.item, (item) => {
  if (!item) lastPlugin.value = null;
  else if (item.startsWith('app:')) lastPlugin.value = item.slice(4);
}, { immediate: true });

function openPlugin(name) {
  if (props.item !== `app:${name}`) nav.go({ page: 'connectors', item: `app:${name}` });
}
function closePlugin() {
  if (props.item) nav.go({ page: 'connectors' });
}
function connect(connection) {
  const id = connection.providerId;
  if (!id) return;
  // Model credentials remain Settings' responsibility in both shells.
  if (AI_PROVIDERS_WITH_API.some((provider) => provider.toLowerCase() === id.toLowerCase())) {
    nav.go({ page: 'settings' });
  } else {
    nav.go({ page: 'connectors', item: id });
  }
}
</script>
