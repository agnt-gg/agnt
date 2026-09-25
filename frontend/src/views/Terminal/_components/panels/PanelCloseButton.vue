<template>
  <!-- Explicit close for a details view. Emits the existing 'close-panel'
       action every collection screen already handles as "clear selection". -->
  <button type="button" class="panel-close" :aria-label="label" v-tooltip="label" @click.stop="$emit('panel-action', 'close-panel')">
    <i class="fas fa-times" aria-hidden="true"></i>
  </button>
</template>

<script>
export default {
  name: 'PanelCloseButton',
  props: { label: { type: String, default: 'Close details' } },
  emits: ['panel-action'],
};
</script>

<style scoped>
.panel-close {
  display: inline-grid;
  place-items: center;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  border: 1px solid transparent;
  border-radius: 7px;
  background: none;
  color: var(--color-text-muted);
  cursor: pointer;
}

.panel-close:hover,
.panel-close:focus-visible {
  color: var(--color-text);
  border-color: var(--terminal-border-color);
  outline: none;
}
</style>
