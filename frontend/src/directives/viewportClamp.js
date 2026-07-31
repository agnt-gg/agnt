/**
 * v-viewport-clamp — keep any fixed/absolute popup fully on screen.
 *
 * The recurring bug this kills: popups positioned with hand-tuned offsets
 * (`bottom: 140px; right: 399px`, negative margins, caller-computed
 * top/left) bleed off the viewport the moment the window is smaller or
 * panel widths differ from the geometry they were tuned on.
 *
 * Instead of re-deriving correct coordinates per component, this directive
 * measures the rendered element AFTER layout and nudges it back inside the
 * viewport with the CSS `translate` property. `translate` composes with
 * `transform`, so open/close animations that use transform (e.g. the
 * provider dropdown's translateY+scale) are not clobbered.
 *
 * Usage: `<div class="my-popup" v-viewport-clamp>` on the popup ROOT
 * (the element that is v-if mounted when open). No binding value needed.
 * Re-clamps on window resize and on component updates (content growth).
 *
 * Also guards height: an element taller than the viewport gets a maxHeight
 * + overflow-y so its content scrolls instead of being unreachable.
 */

const VIEWPORT_MARGIN_PX = 8;
/** Transition-settle delay: re-clamp after open animations finish. */
const SETTLE_MS = 250;

/** Parse the correction we previously applied via el.style.translate. */
function currentCorrection(el) {
  const t = el.style.translate;
  if (!t) return { x: 0, y: 0 };
  const parts = t.split(/\s+/).map((v) => parseFloat(v) || 0);
  return { x: parts[0] || 0, y: parts[1] ?? 0 };
}

export function clampElementToViewport(el) {
  if (!el || !el.getBoundingClientRect) return;

  // Measure IN PLACE and subtract the correction we already applied, instead
  // of resetting translate and re-applying. A reset-then-reapply cycle is a
  // real style change every clamp, and popups with `transition: all` animate
  // it — producing a visible slide on every component update (the "modal
  // keeps moving" bug). Measuring in place makes an already-clamped element
  // a no-op: same input → same correction → no style write → no animation.
  const applied = currentCorrection(el);
  const measured0 = el.getBoundingClientRect();
  if (measured0.width === 0 && measured0.height === 0) return; // not laid out (hidden)
  const rect = {
    top: measured0.top - applied.y,
    bottom: measured0.bottom - applied.y,
    left: measured0.left - applied.x,
    right: measured0.right - applied.x,
    width: measured0.width,
    height: measured0.height,
  };

  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Height guard first: a popup taller than the viewport can never fit by
  // nudging alone. Cap it so the content scrolls.
  const maxUsableHeight = vh - 2 * VIEWPORT_MARGIN_PX;
  if (rect.height > maxUsableHeight) {
    el.style.maxHeight = `${maxUsableHeight}px`;
    el.style.overflowY = 'auto';
  }

  const measured = rect.height > maxUsableHeight
    ? { ...rect, bottom: rect.top + maxUsableHeight, height: maxUsableHeight }
    : rect;

  let dx = 0;
  let dy = 0;
  if (measured.right > vw - VIEWPORT_MARGIN_PX) dx = vw - VIEWPORT_MARGIN_PX - measured.right;
  if (measured.left + dx < VIEWPORT_MARGIN_PX) dx = VIEWPORT_MARGIN_PX - measured.left;
  if (measured.bottom > vh - VIEWPORT_MARGIN_PX) dy = vh - VIEWPORT_MARGIN_PX - measured.bottom;
  if (measured.top + dy < VIEWPORT_MARGIN_PX) dy = VIEWPORT_MARGIN_PX - measured.top;

  // Only touch style when the correction actually changes — writing the same
  // (or a cleared) value re-triggers CSS transitions on every update.
  const next = dx !== 0 || dy !== 0 ? `${Math.round(dx)}px ${Math.round(dy)}px` : '';
  if (el.style.translate !== next) {
    el.style.translate = next;
  }
}

function scheduleClamp(el) {
  // Clamp after the current layout pass, then once more after open
  // transitions settle (animated popups measure mid-flight on frame 1).
  requestAnimationFrame(() => clampElementToViewport(el));
  clearTimeout(el.__vClampSettleTimer);
  el.__vClampSettleTimer = setTimeout(() => clampElementToViewport(el), SETTLE_MS);
}

export const vViewportClamp = {
  mounted(el) {
    el.__vClampOnResize = () => clampElementToViewport(el);
    window.addEventListener('resize', el.__vClampOnResize);
    scheduleClamp(el);
  },
  updated(el) {
    scheduleClamp(el);
  },
  unmounted(el) {
    window.removeEventListener('resize', el.__vClampOnResize);
    clearTimeout(el.__vClampSettleTimer);
    delete el.__vClampOnResize;
    delete el.__vClampSettleTimer;
  },
};

export default vViewportClamp;
