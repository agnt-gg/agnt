<template>
  <RouterView />
  <AIGuidedTourHost />
</template>

<script setup>
import { RouterView } from 'vue-router';
import { onUnmounted } from 'vue';
import { useStore } from 'vuex';
import { bindCodexVoiceIdentity } from '@/voice/codexVoiceSettings.js';
import { API_CONFIG } from '../user.config.js';
import { useRealtimeSync } from '@/composables/useRealtimeSync';
import AIGuidedTourHost from '@/views/_components/utility/AIGuidedTourHost.vue';

// Voice preferences belong to this verified user and API installation only.
const releaseVoiceIdentity = bindCodexVoiceIdentity(useStore(), API_CONFIG.BASE_URL);
onUnmounted(releaseVoiceIdentity);

// Initialize real-time sync (connects on mount, disconnects on unmount)
const { isConnected } = useRealtimeSync();
</script>

<style scoped></style>
