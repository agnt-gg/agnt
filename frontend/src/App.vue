<template>
  <WindowControls v-if="isElectron" />
  <!-- <LeftSidebar></LeftSidebar> -->
  <RouterView />
</template>

<script setup>
import { ref, onMounted } from 'vue';
import LeftSidebar from '@/views/_components/layout/LeftSidebar.vue';
import { RouterView } from 'vue-router';
import WindowControls from '@/views/_components/layout/WindowControls.vue';

const isElectron = ref(false);

onMounted(() => {
  isElectron.value = window.electron !== undefined;
});
</script>

<style scoped></style>
