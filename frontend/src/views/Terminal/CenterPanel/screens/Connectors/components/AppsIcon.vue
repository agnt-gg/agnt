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
  check: 'm5 12 4 4L19 6', down: 'm6 9 6 6 6-6', chevron: 'm9 6 6 6-6 6',
  plugin: 'M9 3h6v4h4v6h-4v4H9v-4H5V7h4V3ZM9 17v4h6v-4',
  agent: 'M8 7h8a4 4 0 0 1 4 4v5a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4v-5a4 4 0 0 1 4-4ZM12 3v4M8 12h1m6 0h1m-7 4h6',
  tool: 'm14 5 5 5M4 20l7-7m-1-5 6-6 6 6-6 6-6-6ZM3 21l2-6 4 4-6 2Z',
  trigger: 'M13 2 4 14h7l-1 8 9-12h-7l1-8Z',
  grid: 'M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3ZM14 14h7v7h-7Z',
  book: 'M12 5v16M3 3h5a4 4 0 0 1 4 2 4 4 0 0 1 4-2h5v16h-5a5 5 0 0 0-4 2 5 5 0 0 0-4-2H3V3Z',
  flow: 'M3 3h6v6H3ZM15 15h6v6h-6ZM6 9v6a3 3 0 0 0 3 3h6M15 6h6m-3-3v6',
  lock: 'M5 10h14v11H5ZM8 10V7a4 4 0 0 1 8 0v3m-4 5v2',
  key: 'M14 10a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM13 12l8 8M17 16l2-2M19 18l2-2',
  pack: 'm21 8-9-5-9 5v8l9 5 9-5V8ZM3 8l9 5 9-5M12 13v8',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18',
  file: 'M14 3H6v18h12V7l-4-4ZM14 3v4h4',
  env: 'M8 3H7a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h1M16 3h1a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2 2 2 0 0 0-2 2v4a2 2 0 0 1-2 2h-1',
  terminal: 'M3 4h18v16H3ZM7 9l3 3-3 3M13 15h4',
  code: 'm8 6-6 6 6 6M16 6l6 6-6 6',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z',
  refresh: 'M20 11a8 8 0 0 0-14.9-3.9M4 4v4h4M4 13a8 8 0 0 0 14.9 3.9M20 20v-4h-4',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
};
</script>
<style scoped>
.apps-ui-icon { width: 20px; height: 20px; flex: none; vertical-align: middle; }
</style>
