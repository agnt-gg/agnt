<template>
  <!-- Minimize / maximize / close for the frameless window. They sit at the end
       of Focused's one top bar (FocusedShell), which is also the drag area.
       Desktop app only: in a browser the browser owns its window. -->
  <div v-if="isElectron" class="focused-window-controls" :class="{ mac: isMac }" data-testid="focused-window-controls">
    <template v-if="isMac">
      <button type="button" class="fwc-mac close" aria-label="Close window" @click="close"></button>
      <button type="button" class="fwc-mac min" aria-label="Minimize window" @click="minimize"></button>
      <button type="button" class="fwc-mac max" aria-label="Maximize window" @click="maximize"></button>
    </template>
    <template v-else>
      <button type="button" class="fwc-btn" aria-label="Minimize window" @click="minimize">
        <svg width="10" height="1" viewBox="0 0 10 1" aria-hidden="true"><rect width="10" height="1" fill="currentColor" /></svg>
      </button>
      <button type="button" class="fwc-btn" aria-label="Maximize window" @click="maximize">
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect x="0.5" y="0.5" width="9" height="9" rx="1" stroke="currentColor" stroke-width="1" fill="none" /></svg>
      </button>
      <button type="button" class="fwc-btn fwc-close" aria-label="Close window" @click="close">
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" /></svg>
      </button>
    </template>
  </div>
</template>

<script setup>
import { useElectron, electronUtils } from '@/composables/useElectron';

const { isElectron } = useElectron();
const isMac = typeof navigator !== 'undefined' && String(navigator.platform || '').toUpperCase().includes('MAC');
const minimize = () => electronUtils.window.minimize();
const maximize = () => electronUtils.window.maximize();
const close = () => electronUtils.window.close();
</script>

<style scoped>
/* The bar around them drags the window; the buttons must not. */
.focused-window-controls { display: flex; align-items: center; gap: 2px; margin-left: auto; -webkit-app-region: no-drag; }
.focused-window-controls.mac { order: -1; gap: 8px; margin: 0 10px 0 4px; }
.fwc-btn {
  width: 36px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}
.fwc-btn:hover { background: var(--surface-hover); color: var(--text-primary); }
.fwc-close:hover { background: var(--color-red); color: var(--text-on-fill); }
.fwc-btn:focus-visible, .fwc-mac:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 1px; }
.fwc-mac { width: 12px; height: 12px; padding: 0; border: 0; border-radius: 50%; cursor: pointer; }
.fwc-mac.close { background: var(--color-red); }
.fwc-mac.min { background: var(--color-yellow); }
.fwc-mac.max { background: var(--color-green); }
</style>
