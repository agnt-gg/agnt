<!-- Plugins.vue — the Plugin Forge screen.

     Plugins was one of six views inside Connectors, reached only from that
     screen's left-panel nav. It is an ASSET rather than a connection — a thing
     you install and own, the same kind of thing as an agent, a tool or a
     skill — so it has its own BUILD row and its own route.

     PluginManager owns the whole page: its own single header (this screen
     used to stack three titles), the library views, and the Forge. While the
     Forge is open it takes the full height of the scroll area, which is why
     the marketplace shelf and the page padding step aside in that mode.

     While the Forge is building a plugin the left column is its chat
     (PluginForgePanel), exactly as Widget Forge's is; in the library it is
     the Apps navigation the registry assigns this screen.

     PluginManager still lives in the Connectors directory beside the two
     siblings it imports relatively (PluginBuilder, PackStudio). It is imported
     from there rather than copied so there stays exactly one implementation;
     moving all three is a mechanical rename worth doing on its own. -->
<template>
  <BaseScreen
    ref="baseScreenRef"
    screenId="PluginsScreen"
    :activeRightPanel="activeRightPanel"
    :activeLeftPanel="isBuilderMode ? 'PluginForgePanel' : undefined"
    :panelProps="{ context: 'plugins' }"
    :leftPanelProps="{ screenName: 'PluginsScreen' }"
    @screen-change="(screenName) => emit('screen-change', screenName)"
  >
    <template #default>
      <SimpleModal ref="modalRef" />
      <!-- Click-away clears the selection, which is what closes the detail
           panel on the right. Carried over from Connectors unchanged. -->
      <div class="plugins-content" :class="{ 'is-forge': isForgeMode }" @click="handlePluginAreaClick">
        <PluginManager @show-alert="showAlert" />
        <MarketplaceShelf
          v-if="!isForgeMode"
          asset-type="plugin"
          variant="strip"
          @browse="listing => emit('screen-change', 'MarketplaceScreen', { listing })"
        />
      </div>
    </template>
  </BaseScreen>
</template>

<script setup>
import { ref, computed, inject, provide, watch, nextTick } from 'vue';
import { useStore } from 'vuex';
import BaseScreen from '../../BaseScreen.vue';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import MarketplaceShelf from '@/views/Terminal/_components/MarketplaceShelf.vue';
import PluginManager from '../Connectors/components/Plugins.vue';

const emit = defineEmits(['screen-change']);
const store = useStore();
const mobileView = inject('isMobile', ref(false));
const baseScreenRef = ref(null);
const modalRef = ref(null);
watch(() => store.getters['connectors/selectedPlugin'], plugin => { if (mobileView.value && plugin) baseScreenRef.value?.openMobilePanel('right'); });

// Library views; anything else is a Forge mode (builder, pack-studio).
const LIBRARY_VIEWS = ['installed', 'marketplace', 'mine'];
const isForgeMode = computed(() => !LIBRARY_VIEWS.includes(store.getters['connectors/activeTab']));
const isBuilderMode = computed(() => store.getters['connectors/activeTab'] === 'builder');

// The chat is the builder, so it must be on screen when the builder opens,
// even if the Apps column was collapsed earlier on this screen.
watch(
  isBuilderMode,
  async (building) => {
    if (!building || mobileView.value) return;
    await nextTick();
    if (baseScreenRef.value?.leftPanelCollapsed) baseScreenRef.value.toggleLeftPanelCollapsed();
  },
  { immediate: true },
);
// Phones show the left column as a sheet; the Forge opens it from its Chat button.
provide('openForgeChat', () => baseScreenRef.value?.openMobilePanel('left'));

// The right panel is ConnectorsPanel in both states: a selected plugin shows
// its detail; nothing selected shows the plugins summary (context: 'plugins').
// News & updates moved to Settings › About.
const activeRightPanel = computed(() => 'ConnectorsPanel');

async function showAlert(title, message) {
  await modalRef.value?.showModal({ title, message, confirmText: 'OK', showCancel: false });
}

function handlePluginAreaClick(event) {
  // Anything that is not a plugin card deselects, closing the right panel.
  if (!event.target.closest('.plugin-card, .m-collection')) {
    store.dispatch('connectors/selectPlugin', null);
  }
}
</script>

<style scoped>
.plugins-content {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
  width: 100%;
  max-width: 1200px;
  margin: 0 auto;
}

/* Fill the scroll area exactly; the Forge scrolls inside itself. */
.plugins-content.is-forge {
  flex: 1;
  min-height: 0;
  max-width: none;
}
</style>
