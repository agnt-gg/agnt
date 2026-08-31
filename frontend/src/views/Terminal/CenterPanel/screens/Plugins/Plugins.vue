<!-- Plugins.vue — the Plugins screen.

     Plugins was one of six views inside Connectors, reached only from that
     screen's left-panel nav. It is an ASSET rather than a connection — a thing
     you install and own, the same kind of thing as an agent, a tool or a
     skill — so it now has its own BUILD row and its own route.

     The page itself is unchanged: same header, same copy, same component, in
     the same wrapper markup and styles Connectors gave it.

     PluginManager still lives in the Connectors directory beside the two
     siblings it imports relatively (PluginBuilder, PackStudio). It is imported
     from there rather than copied so there stays exactly one implementation;
     moving all three is a mechanical rename worth doing on its own, not
     inside a navigation change. -->
<template>
  <BaseScreen
    ref="baseScreenRef"
    screenId="PluginsScreen"
    :activeRightPanel="activeRightPanel"
    @screen-change="(screenName) => emit('screen-change', screenName)"
  >
    <template #default>
      <SimpleModal ref="modalRef" />
      <!-- Click-away clears the selection, which is what closes the detail
           panel on the right. Carried over from Connectors unchanged. -->
      <div class="plugins-content" @click="handlePluginAreaClick">
        <div class="content-header">
          <h2 class="content-title">My Plugins</h2>
          <p class="content-subtitle">
            Extend AGNT with community plugins. Install tools like Discord, Slack, GitHub and more without bloating your app.
          </p>
        </div>
        <div class="plugins-grid">
          <div class="plugins-section">
            <PluginManager @show-alert="showAlert" />
          </div>
        </div>
      </div>
    </template>
  </BaseScreen>
</template>

<script setup>
import { ref, computed } from 'vue';
import { useStore } from 'vuex';
import BaseScreen from '../../BaseScreen.vue';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import PluginManager from '../Connectors/components/Plugins.vue';

const emit = defineEmits(['screen-change']);
const store = useStore();
const baseScreenRef = ref(null);
const modalRef = ref(null);

// Selecting a plugin swaps the right panel to its detail view; with nothing
// selected the screen keeps NewsPanel, exactly as it did inside Connectors.
const activeRightPanel = computed(() => (store.getters['connectors/selectedPlugin'] ? 'ConnectorsPanel' : 'NewsPanel'));

async function showAlert(title, message) {
  await modalRef.value?.showModal({ title, message, confirmText: 'OK', showCancel: false });
}

function handlePluginAreaClick(event) {
  // Anything that is not a plugin card deselects, closing the right panel.
  if (!event.target.closest('.plugin-card')) {
    store.dispatch('connectors/selectPlugin', null);
  }
}
</script>

<style scoped>
/* Copied from Connectors.vue's scoped block so the page renders identically
   to the view it was lifted out of. */
.plugins-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  max-width: 1048px;
  margin: 0 auto;
  align-items: flex-start;
}

.content-header {
  padding: 0;
  border-bottom: 1px solid var(--terminal-border-color);
  padding-bottom: 16px;
  width: 100%;
  max-width: 1048px;
}

.content-title {
  font-size: 1.8em;
  font-weight: 600;
  margin: 0 0 8px 0;
  display: flex;
  align-items: center;
  gap: 12px;
}

.content-subtitle {
  color: var(--color-light-med-navy);
  font-size: 1em;
  margin: 0;
  opacity: 0.8;
  line-height: 1.4;
}

.plugins-grid {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  margin: 0;
}

.plugins-section {
  background: transparent;
  border: none;
  padding: 24px;
  width: 100%;
  transition: all 0.3s ease;
  border-radius: 16px;
}
</style>
