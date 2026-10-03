<template>
  <!-- Teleported to <body>, like SimpleModal: inside the canvas a fixed box
       is clipped by its ancestors (it rendered with its top cut off). -->
  <Teleport to="body">
    <div class="try-focused-scrim" @click.self="dismiss">
      <section
        ref="dialogEl"
        class="try-focused"
        role="dialog"
        aria-modal="true"
        aria-labelledby="try-focused-title"
        aria-describedby="try-focused-body"
        tabindex="-1"
      >
        <img class="try-focused-logo" src="/images/agnt-logo-mark.svg" alt="" />
        <span class="try-focused-badge">New</span>
        <h2 id="try-focused-title">Meet <em>Focused</em></h2>
        <p id="try-focused-body">
          A calmer way to use AGNT: one input, your chats and your library. Same app, same data, and everything
          you use now is still one click away.
        </p>

        <ul class="try-focused-points">
          <li><i class="fas fa-comment" aria-hidden="true"></i>Just ask. Steps fold into one line.</li>
          <li><i class="fas fa-book" aria-hidden="true"></i>Agents, workflows, tools and plugins in one library.</li>
          <li><i class="fas fa-th-large" aria-hidden="true"></i>Open any Studio screen in full when you need it.</li>
        </ul>

        <div class="try-focused-actions">
          <button ref="primaryEl" type="button" class="try-focused-primary" @click="tryFocused">Try Focused</button>
          <button type="button" class="try-focused-quiet" @click="dismiss">Not now</button>
        </div>
        <small>Switch any time with Ctrl+Shift+S, or in Settings → Navigation.</small>
      </section>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { useStore } from 'vuex';

const emit = defineEmits(['dismiss']);
const store = useStore();
const primaryEl = ref(null);
const dialogEl = ref(null);

function dismiss() {
  emit('dismiss');
}

function tryFocused() {
  store.dispatch('theme/setUiMode', 'focused');
  emit('dismiss');
}

// A modal keeps focus. Measured: the chat composer autofocuses AFTER this
// mounts, which left Enter typing into the chat behind the dialog. So focus
// that leaves the dialog is brought back, and Esc works from anywhere.
function keepFocus(e) {
  if (dialogEl.value && !dialogEl.value.contains(e.target)) primaryEl.value?.focus({ preventScroll: true });
}
function onKey(e) {
  if (e.key !== 'Escape') return;
  e.preventDefault();
  e.stopPropagation();
  dismiss();
}
onMounted(() => {
  primaryEl.value?.focus({ preventScroll: true });
  document.addEventListener('focusin', keepFocus, true);
  window.addEventListener('keydown', onKey, true);
});
onBeforeUnmount(() => {
  document.removeEventListener('focusin', keepFocus, true);
  window.removeEventListener('keydown', onKey, true);
});
</script>

<style scoped>
.try-focused-scrim {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--scrim);
  backdrop-filter: blur(6px);
  animation: try-focused-fade 160ms ease-out;
}
.try-focused {
  width: min(460px, 100%);
  max-height: calc(100vh - 48px);
  overflow-y: auto;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 12px;
  padding: 32px 32px 24px;
  border-radius: 18px;
  border: 1px solid var(--terminal-border-color);
  /* --color-popup is 95% opaque in every theme; on a dialog this size the
     5% ghosted the chat through it. The theme's solid background goes
     underneath, so the popup tint shows and nothing behind it does. */
  background: linear-gradient(var(--color-popup), var(--color-popup)), var(--color-background);
  color: var(--text-primary);
  box-shadow: var(--shadow-overlay);
  outline: none;
  animation: try-focused-rise 200ms ease-out;
}
.try-focused-logo {
  height: 44px;
  width: auto;
  margin-bottom: 6px;
}
.try-focused-badge {
  padding: 3px 10px;
  border-radius: 999px;
  background: rgba(var(--green-rgb), 0.12);
  color: var(--color-green);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
h2 {
  margin: 0;
  font-size: 26px;
  font-weight: 700;
}
h2 em {
  font-style: normal;
  color: var(--color-green);
}
p {
  margin: 0;
  font-size: 14px;
  line-height: 1.55;
  color: var(--text-secondary);
  text-wrap: balance;
}
.try-focused-points {
  list-style: none;
  margin: 6px 0 4px;
  padding: 0;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
  text-align: left;
}
.try-focused-points li {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--surface-active);
  font-size: 13px;
}
.try-focused-points i {
  width: 16px;
  text-align: center;
  color: var(--color-green);
}
.try-focused-actions {
  display: flex;
  gap: 10px;
  width: 100%;
  margin-top: 6px;
}
.try-focused-primary,
.try-focused-quiet {
  flex: 1;
  min-height: 42px;
  padding: 0 16px;
  border-radius: 10px;
  font: inherit;
  font-size: 14px;
  cursor: pointer;
}
.try-focused-primary {
  border: none;
  background: var(--color-green);
  color: var(--color-dark-navy);
  font-weight: 700;
}
.try-focused-quiet {
  border: 1px solid var(--terminal-border-color);
  background: transparent;
  color: var(--text-primary);
}
.try-focused-quiet:hover {
  background: var(--surface-hover);
}
.try-focused-primary:focus-visible,
.try-focused-quiet:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}
small {
  font-size: 12px;
  color: var(--text-secondary);
}
@keyframes try-focused-fade {
  from {
    opacity: 0;
  }
}
@keyframes try-focused-rise {
  from {
    opacity: 0;
    transform: translateY(8px) scale(0.98);
  }
}
@media (prefers-reduced-motion: reduce) {
  .try-focused-scrim,
  .try-focused {
    animation: none;
  }
}
</style>
