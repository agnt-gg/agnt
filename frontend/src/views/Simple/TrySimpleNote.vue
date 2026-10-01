<template>
  <aside class="try-simple" role="status" aria-label="Simple mode">
    <div class="try-simple-text">
      <strong>New: Simple</strong>
      <span>One input, your chats and your library. Everything here stays one click away.</span>
    </div>
    <div class="try-simple-actions">
      <button type="button" class="try-simple-primary" @click="trySimple">Try Simple</button>
      <button type="button" class="try-simple-quiet" aria-label="Dismiss" @click="$emit('dismiss')">Not now</button>
    </div>
    <small>Switch any time: Settings → Navigation, or Ctrl+Shift+S.</small>
  </aside>
</template>

<script setup>
import { useStore } from 'vuex';

const emit = defineEmits(['dismiss']);
const store = useStore();

function trySimple() {
  store.dispatch('theme/setUiMode', 'simple');
  emit('dismiss');
}
</script>

<style scoped>
.try-simple {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 900;
  width: 320px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  border-radius: 12px;
  border: 1px solid var(--terminal-border-color);
  background: var(--surface-raised);
  color: var(--text-primary);
  box-shadow: var(--shadow-overlay);
}
.try-simple-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
}
.try-simple-text span,
.try-simple small {
  color: var(--text-secondary);
}
.try-simple small {
  font-size: 11px;
}
.try-simple-actions {
  display: flex;
  gap: 8px;
}
.try-simple-primary,
.try-simple-quiet {
  min-height: 32px;
  padding: 0 14px;
  border-radius: 8px;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.try-simple-primary {
  border: none;
  background: var(--fill-brand);
  color: var(--on-fill-brand);
  font-weight: 600;
}
.try-simple-quiet {
  border: 1px solid var(--terminal-border-color);
  background: transparent;
  color: var(--text-primary);
}
.try-simple-quiet:hover {
  background: var(--surface-hover);
}
</style>
