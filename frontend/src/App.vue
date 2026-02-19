<template>
  <!-- <LeftSidebar></LeftSidebar> -->
  <RouterView />
</template>

<script setup>
import LeftSidebar from '@/views/_components/layout/LeftSidebar.vue';
import { RouterView } from 'vue-router';
import { useRealtimeSync } from '@/composables/useRealtimeSync';

// Initialize real-time sync (connects on mount, disconnects on unmount)
const { isConnected } = useRealtimeSync();
</script>

<style scoped></style>
