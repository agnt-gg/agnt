<!-- Providers.vue — the AI Providers screen (CONNECT › AI Providers).

     The most-touched setup page in the app: which model Annie thinks with,
     what happens when it is unavailable, and how she behaves. It rendered as
     a section of Settings and, before that, a view inside Connectors; the
     toolbar's "no provider" pill and the first-run card both land here, so
     it earns a rail row of its own.

     Thin wrapper by design: the three cards are the same components Settings
     › AI Provider draws, imported rather than copied, so there is exactly one
     implementation of each. -->
<template>
  <BaseScreen ref="baseScreenRef" screenId="ProvidersScreen" :panelProps="{ context: 'providers' }" @screen-change="(s, o) => emit('screen-change', s, o)">
    <template #default>
      <div class="providers-content">
        <div class="content-header">
          <h2 class="content-title">AI Providers</h2>
          <p class="content-subtitle">
            The model Annie uses everywhere she isn't told otherwise — and what happens when it's unavailable.
          </p>
        </div>
        <!--
          ORDERED BY HOW OFTEN EACH ONE IS ACTUALLY TOUCHED:
            01 Model        daily          ← the reason anyone opens this page
            02 Fallback     a few × / year
            03 Instructions monthly
        -->
        <div class="providers-grid">
          <ProviderSelector />
          <FallbackProviders />
          <ChatBehaviorSettings />
        </div>
      </div>
    </template>
  </BaseScreen>
</template>

<script setup>
import { ref } from 'vue';
import BaseScreen from '../../BaseScreen.vue';
import ProviderSelector from '../Settings/components/ProviderSelector/ProviderSelector.vue';
import FallbackProviders from '../Connectors/components/FallbackProviders.vue';
import ChatBehaviorSettings from '../Connectors/components/ChatBehaviorSettings.vue';

const emit = defineEmits(['screen-change']);
const baseScreenRef = ref(null);
</script>

<style scoped>
.providers-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  max-width: 1048px;
  margin: 0 auto;
  align-items: flex-start;
}
.content-header {
  padding: 0 0 16px;
  border-bottom: 1px solid var(--terminal-border-color);
  width: 100%;
}
.content-title {
  font-size: 1.8em;
  font-weight: 600;
  margin: 0 0 8px;
}
.content-subtitle {
  color: var(--color-text-muted);
  font-size: 1em;
  margin: 0;
  line-height: 1.4;
}
.providers-grid {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
}
</style>
