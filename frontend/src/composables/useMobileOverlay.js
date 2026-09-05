import { nextTick, onActivated, onBeforeUnmount, onDeactivated, ref, watch } from 'vue';

// Presentation state only: never writes the desktop theme, navigation or layout.
// The existing panel DOM stays mounted, preserving its filters and scroll position.
const layers = [];
const focusable = 'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function useMobileOverlay(isMobile, elementFor, { beforeClose } = {}) {
  const active = ref(null);
  let returnFocus = null;
  let listening = false;
  const owner = {};
  const element = () => {
    const candidate = elementFor(active.value);
    return candidate?.$el || candidate;
  };
  const forgetLayer = () => {
    const index = layers.indexOf(owner);
    if (index !== -1) layers.splice(index, 1);
  };
  function close({ restoreFocus = true } = {}) {
    active.value = null;
    forgetLayer();
    const target = returnFocus;
    returnFocus = null;
    if (restoreFocus) nextTick(() => { if (target?.isConnected && !target.closest('[inert]')) target.focus({ preventScroll: true }); });
  }
  async function open(name = 'navigation', trigger = document.activeElement) {
    if (!isMobile.value) return;
    if (!active.value) returnFocus = trigger;
    active.value = name;
    forgetLayer();
    layers.push(owner);
    await nextTick();
    if (active.value !== name) return;
    const panel = element();
    const first = panel?.querySelector(focusable);
    (first || panel)?.focus({ preventScroll: true });
  }
  function onKeydown(event) {
    if (!active.value || layers.at(-1) !== owner || event.defaultPrevented) return;
    const panel = element();
    // A provider picker / confirmation can be teleported above this panel.
    // Let its own close handler run; do not consume its Tab or Escape.
    if (event.target !== document.body && panel && !panel.contains(event.target)) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (beforeClose?.() === false) return;
      close();
    } else if (event.key === 'Tab' && panel) {
      const controls = [...panel.querySelectorAll(focusable)].filter(el =>
        !el.disabled && !el.closest('[inert]') && !el.hidden && el.getClientRects().length,
      );
      if (!controls.length) { event.preventDefault(); panel.focus(); return; }
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    }
  }
  function listen() {
    if (listening) return;
    listening = true;
    document.addEventListener('keydown', onKeydown);
  }
  function suspend() {
    close({ restoreFocus: false });
    document.removeEventListener('keydown', onKeydown);
    listening = false;
  }
  // setup also covers non-KeepAlive hosts; listener identity prevents duplicates.
  listen();
  onActivated(listen);
  onDeactivated(suspend);
  onBeforeUnmount(suspend);
  watch(isMobile, mobile => { if (!mobile) close({ restoreFocus: false }); });
  return { active, open, close };
}
