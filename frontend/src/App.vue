<template>
  <RouterView />
  <AIGuidedTourHost />
</template>

<script setup>
import { RouterView } from 'vue-router';
import { useRealtimeSync } from '@/composables/useRealtimeSync';
import AIGuidedTourHost from '@/views/_components/utility/AIGuidedTourHost.vue';

// Initialize real-time sync (connects on mount, disconnects on unmount)
const { isConnected } = useRealtimeSync();
</script>

<style scoped></style>
