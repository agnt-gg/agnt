<template>
  <Teleport to="body">
    <div v-if="open" class="message-actions-backdrop" @click.self="close" @contextmenu.prevent>
      <section ref="menu" class="mobile-message-actions-sheet" role="dialog" aria-label="Message actions" aria-modal="true" @keydown.esc.stop="close" @keydown.tab="trapFocus">
        <button type="button" @click="copy">Copy message</button>
        <button v-if="canEdit" type="button" @click="edit">Edit message</button>
        <p v-if="error" role="alert">{{ error }}</p>
        <button type="button" class="cancel-action" @click="close">Cancel</button>
      </section>
    </div>
  </Teleport>
</template>

<script setup>
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';

const props = defineProps({ target: { default: null }, text: { type: String, default: '' }, canEdit: Boolean, disabled: Boolean });
const emit = defineEmits(['edit']);
const open = ref(false);
const error = ref('');
const menu = ref(null);
let timer;
let start;
let restoreFocus;
const compact = () => window.innerWidth <= 800;
const cancelPress = () => { clearTimeout(timer); start = null; };
function close() { cancelPress(); open.value = false; restoreFocus?.focus?.({ preventScroll: true }); }
async function show() {
  cancelPress();
  error.value = '';
  restoreFocus = document.activeElement;
  open.value = true;
  window.getSelection()?.removeAllRanges();
  await nextTick();
  menu.value?.querySelector('button')?.focus();
}
function pointerDown(event) {
  cancelPress();
  if (!compact() || props.disabled || event.pointerType !== 'touch' || event.isPrimary === false) return;
  if (event.target.closest('button,a,input,textarea,select,iframe,[contenteditable="true"]')) return;
  start = { x: event.clientX, y: event.clientY };
  timer = setTimeout(show, 500);
}
function pointerMove(event) {
  if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) cancelPress();
}
function contextMenu(event) {
  if (!compact() || props.disabled || event.target.closest('button,a,input,textarea,select,iframe')) return;
  event.preventDefault();
  if (!open.value) show();
}
function suppressClick(event) { if (open.value) { event.preventDefault(); event.stopImmediatePropagation(); } }
async function copy() {
  try { await navigator.clipboard.writeText(props.text); close(); }
  catch (cause) { error.value = 'Could not copy. Check clipboard access and try again.'; console.error('[message-copy]', cause); }
}
function edit() { close(); emit('edit'); }
function trapFocus(event) {
  const buttons = [...menu.value.querySelectorAll('button')];
  const first = buttons[0];
  const last = buttons[buttons.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}
const events = { pointerdown: pointerDown, pointermove: pointerMove, pointerup: cancelPress, pointercancel: cancelPress, contextmenu: contextMenu, click: suppressClick };
watch(() => props.target, (element, previous) => {
  cancelPress();
  for (const [name, handler] of Object.entries(events)) {
    previous?.removeEventListener(name, handler, true);
    element?.addEventListener(name, handler, true);
  }
}, { flush: 'post', immediate: true });
function onScroll() { cancelPress(); }
window.addEventListener('scroll', onScroll, true);
window.addEventListener('resize', close);
onBeforeUnmount(() => {
  cancelPress();
  for (const [name, handler] of Object.entries(events)) props.target?.removeEventListener(name, handler, true);
  window.removeEventListener('scroll', onScroll, true);
  window.removeEventListener('resize', close);
});
</script>

<style scoped>
.message-actions-backdrop { position: fixed; inset: 0; z-index: 12000; display: flex; align-items: flex-end; justify-content: center; background: var(--scrim); padding: 12px 12px max(12px, env(safe-area-inset-bottom)); box-sizing: border-box; }
.mobile-message-actions-sheet { width: 100%; max-width: 420px; padding: 8px; border-radius: 16px; border: 1px solid var(--terminal-border-color); background: var(--color-popup); color: var(--color-text); box-shadow: var(--shadow-overlay); }
.mobile-message-actions-sheet button { display: block; width: 100%; min-height: 48px; padding: 12px 16px; border: 0; border-radius: 9px; color: inherit; background: transparent; font: inherit; text-align: left; }
.mobile-message-actions-sheet button:focus-visible, .mobile-message-actions-sheet button:hover { background: var(--color-darker-1); outline: 2px solid var(--color-green); }
.mobile-message-actions-sheet .cancel-action { border-top: 1px solid var(--terminal-border-color); color: var(--color-text-muted); }
.mobile-message-actions-sheet p { padding: 0 16px; }
</style>
