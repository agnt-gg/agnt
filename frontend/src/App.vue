<template>
  <WindowControls v-if="isElectron" />
  <!-- <LeftSidebar></LeftSidebar> -->
  <RouterView />
</template>

<script setup>
import LeftSidebar from '@/views/_components/layout/LeftSidebar.vue';
import { RouterView } from 'vue-router';
import WindowControls from '@/views/_components/layout/WindowControls.vue';
import { useElectron } from '@/composables/useElectron';
import { useRealtimeSync } from '@/composables/useRealtimeSync';

const { isElectron } = useElectron();

// Initialize real-time sync (connects on mount, disconnects on unmount)
const { isConnected } = useRealtimeSync();
</script>

<style scoped></style>
