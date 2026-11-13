<template>
  <!-- eslint-disable-next-line vue/no-v-html -- static glyphs below and from mkIcons.js, never user data -->
  <svg class="i" :class="size" viewBox="0 0 24 24" aria-hidden="true" v-html="glyph"></svg>
</template>

<script setup>
// AGNT One's icon set (mkIcons.js) plus the glyphs the Apps page adds, in the same 24px stroke style.
import { computed } from 'vue';
import { MK_ICONS } from '../mk/mkIcons.js';

const EXTRA = Object.freeze({
  help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.4a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.7"/><path d="M12 16.9h.01"/>',
  grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.8"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.8"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.8"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.8"/>',
  sort: '<path d="m8 9.5 4-4 4 4M8 14.5l4 4 4-4"/>',
  arrowDown: '<path d="M12 5v14M6.5 13.5 12 19l5.5-5.5"/>',
  arrowUp: '<path d="M12 19V5M6.5 10.5 12 5l5.5 5.5"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
  filter: '<path d="M4 5.5h16l-6.2 7.3v5.7l-3.6-1.8v-3.9z"/>',
  kebab: '<circle cx="12" cy="5.5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="18.5" r="1.5"/>',
  puzzle: '<path d="M10 4.8a2 2 0 1 1 4 0V6h3a1 1 0 0 1 1 1v3h1.2a2 2 0 1 1 0 4H18v3a1 1 0 0 1-1 1h-3v-1.2a2 2 0 1 0-4 0V18H7a1 1 0 0 1-1-1v-3h1.2a2 2 0 1 0 0-4H6V7a1 1 0 0 1 1-1h3z"/>',
  server: '<rect x="4" y="4.5" width="16" height="6.2" rx="1.6"/><rect x="4" y="13.3" width="16" height="6.2" rx="1.6"/><path d="M7.6 7.6h.01M7.6 16.4h.01"/>',
  mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="m4.2 7.2 7.8 5.8 7.8-5.8"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4"/>',
  terminal: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="m7.5 10 2.5 2.5L7.5 15M12.5 15h4"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.6 3.6 5.4 3.6 8.5s-1.2 5.9-3.6 8.5c-2.4-2.6-3.6-5.4-3.6-8.5S9.6 6.1 12 3.5z"/>',
  trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/>',
  back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  external: '<path d="M14 4.5h5.5V10M19.5 4.5 11 13M17 13.5v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1h5"/>',
  update: '<path d="M12 19.5V8M7 12.5l5-5 5 5M5 4.5h14"/>',
});

const props = defineProps({ name: { type: String, required: true }, size: { type: String, default: '' } });
const glyph = computed(() => EXTRA[props.name] || MK_ICONS[props.name] || '');
</script>
