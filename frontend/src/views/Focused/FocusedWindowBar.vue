<template>
  <!-- The window is frameless. Studio's toolbar is what you drag it by and where
       its buttons live; Focused replaces that toolbar, so without this bar the
       window could not be moved, minimised, maximised or closed. -->
  <div v-if="isElectron" class="focused-window-bar" :class="{ mac: isMac }" data-testid="focused-window-bar">
    <div v-if="isMac" class="fwb-mac">
      <button type="button" class="fwb-mac-btn close" aria-label="Close window" @click="close"></button>
      <button type="button" class="fwb-mac-btn min" aria-label="Minimize window" @click="minimize"></button>
      <button type="button" class="fwb-mac-btn max" aria-label="Maximize window" @click="maximize"></button>
    </div>
    <div v-else class="fwb-win">
      <button type="button" class="fwb-btn" aria-label="Minimize window" @click="minimize">
        <svg width="10" height="1" viewBox="0 0 10 1" aria-hidden="true"><rect width="10" height="1" fill="currentColor" /></svg>
      </button>
      <button type="button" class="fwb-btn" aria-label="Maximize window" @click="maximize">
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect x="0.5" y="0.5" width="9" height="9" rx="1" stroke="currentColor" stroke-width="1" fill="none" /></svg>
      </button>
      <button type="button" class="fwb-btn fwb-close" aria-label="Close window" @click="close">
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" /></svg>
      </button>
    </div>
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
/* The whole strip drags the window; only the buttons opt out. */
.focused-window-bar {
  position: absolute;
  inset: 0 0 auto 0;
  height: var(--focused-window-bar-height, 32px);
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 0 8px;
  box-sizing: border-box;
  background: var(--color-background);
  border-bottom: 1px solid var(--terminal-border-color);
  z-index: 50;
  user-select: none;
  -webkit-app-region: drag;
}
.focused-window-bar.mac { justify-content: flex-start; padding-left: 12px; }
.fwb-win, .fwb-mac { display: flex; align-items: center; gap: 2px; -webkit-app-region: no-drag; }
.fwb-mac { gap: 8px; }
.fwb-btn {
  width: 36px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}
.fwb-btn:hover { background: var(--surface-hover); color: var(--text-primary); }
.fwb-close:hover { background: var(--color-red); color: var(--text-on-fill); }
.fwb-btn:focus-visible, .fwb-mac-btn:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 1px; }
.fwb-mac-btn { width: 12px; height: 12px; padding: 0; border: 0; border-radius: 50%; cursor: pointer; }
.fwb-mac-btn.close { background: var(--color-red); }
.fwb-mac-btn.min { background: var(--color-yellow); }
.fwb-mac-btn.max { background: var(--color-green); }
</style>
