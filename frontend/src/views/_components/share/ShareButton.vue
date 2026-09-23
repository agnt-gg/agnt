<template>
  <button
    v-if="id !== '' && id !== null && id !== undefined"
    type="button"
    class="share-button"
    :class="[buttonClass, { 'is-bare': !buttonClass && !plain }]"
    :aria-label="'Share ' + name"
    v-tooltip="'Share'"
    @click.stop="share"
  >
    <!-- Font Awesome 5 (public/vendor/fontawesome): fa-share-alt, the icon Artifacts already uses. -->
    <i class="fas fa-share-alt" aria-hidden="true"></i>
  </button>
</template>
<script setup>
/**
 * The share button: one icon, the same everywhere. It carries no logic of its
 * own; it opens the app's single share sheet for this item. Pass the host
 * row's own button class (`card-btn`, `action-btn`, …) so it sits in that row
 * exactly like its neighbours.
 */
import { openShare } from '@/composables/useShare.js';

const props = defineProps({
  kind: { type: String, required: true },
  id: { type: [String, Number], default: '' },
  name: { type: String, default: 'This item' },
  /** Optional: the screen's own Marketplace publish flow. */
  publish: { type: Function, default: null },
  /** Optional: the screen's own file export. */
  exportItem: { type: Function, default: null },
  buttonClass: { type: [String, Array, Object], default: '' },
  /** Take all styling from the host row (a row that styles its bare <button>s). */
  plain: { type: Boolean, default: false },
});
const share = () => openShare({ kind: props.kind, id: props.id, name: props.name, publish: props.publish, exportItem: props.exportItem });
</script>
<style scoped>
/* Bare unless the host dresses it: via buttonClass (card-btn, action-btn, …) or `plain` (the row styles its <button>s). */
.share-button.is-bare { background: transparent; border: 0; padding: 4px 6px; color: var(--color-text-muted); cursor: pointer; border-radius: 4px; line-height: 1; }
.share-button.is-bare:hover { color: var(--color-primary); }
.share-button:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 1px; }
</style>
