<template>
  <svg class="apps-ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path :d="paths[name] || paths.plugin" />
  </svg>
</template>
<script setup>
defineProps({ name: { type: String, default: 'plugin' } });
const paths = {
  search: 'M18 18l4 4M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  arrow: 'M5 12h14m-5-5 5 5-5 5', back: 'M19 12H5m5-5-5 5 5 5', plus: 'M12 5v14M5 12h14',
  check: 'm5 12 4 4L19 6', down: 'm6 9 6 6 6-6',
  plugin: 'M9 3h6v4h4v6h-4v4H9v-4H5V7h4V3ZM9 17v4h6v-4',
  agent: 'M8 7h8a4 4 0 0 1 4 4v5a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4v-5a4 4 0 0 1 4-4ZM12 3v4M8 12h1m6 0h1m-7 4h6',
  tool: 'm14 5 5 5M4 20l7-7m-1-5 6-6 6 6-6 6-6-6ZM3 21l2-6 4 4-6 2Z',
  grid: 'M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3ZM14 14h7v7h-7Z',
  book: 'M12 5v16M3 3h5a4 4 0 0 1 4 2 4 4 0 0 1 4-2h5v16h-5a5 5 0 0 0-4 2 5 5 0 0 0-4-2H3V3Z',
  flow: 'M3 3h6v6H3ZM15 15h6v6h-6ZM6 9v6a3 3 0 0 0 3 3h6M15 6h6m-3-3v6',
  lock: 'M5 10h14v11H5ZM8 10V7a4 4 0 0 1 8 0v3m-4 5v2',
};
</script>
<style scoped>
.apps-ui-icon { width: 20px; height: 20px; flex: none; vertical-align: middle; }
</style>
