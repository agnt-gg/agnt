<template>
  <RouterView />
  <AIGuidedTourHost />
  <!-- One share sheet and one receive card for the whole app; see composables/useShare.js. -->
  <ShareSheet />
  <ReceiveShareDialog />
</template>

<script setup>
import { RouterView } from 'vue-router';
import { useRealtimeSync } from '@/composables/useRealtimeSync';
import AIGuidedTourHost from '@/views/_components/utility/AIGuidedTourHost.vue';
import ShareSheet from '@/views/_components/share/ShareSheet.vue';
import ReceiveShareDialog from '@/views/_components/share/ReceiveShareDialog.vue';

// Initialize real-time sync (connects on mount, disconnects on unmount)
const { isConnected } = useRealtimeSync();
</script>

<style scoped></style>
