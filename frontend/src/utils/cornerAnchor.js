import { ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';

/**
 * cornerAnchor — pin a fixed popup to the BOTTOM-RIGHT corner of a container.
 *
 * WHY BOTTOM-RIGHT AND NOT TOP-LEFT
 * ─────────────────────────────────
 * The provider popover changes height depending on which mode is selected
 * (Default is three lines, Specific is four dropdowns plus a reasoning
 * control). Anchored by top/left, a taller panel grows DOWNWARD, so the panel
 * appeared to jump every time the mode changed. Both call sites tried to
 * compensate with a constant:
 *
 *   BaseScreen           top: `${buttonRect.top - 420}px`   ← guess at height
 *   UnifiedChatContainer right: '1592px', bottom: '148px'   ← one window size
 *
 * A guessed height is only correct for one panel, and a hardcoded right edge
 * is only correct for one window. Anchoring the BOTTOM-RIGHT corner removes
 * the guess entirely: `right` + `bottom` are pinned, `top` + `left` are auto,
 * so the box shrink-to-fits from that corner and any content growth expands up
 * and to the left. The corner does not move, in any mode, at any size.
 *
 * WHY IT TRACKS THE PANELS
 * ────────────────────────
 * The offsets are measured from the CONTAINER, not the viewport or a trigger
 * button, so opening or closing a side panel moves the popup with the chat it
 * belongs to. A ResizeObserver on the container is what makes that automatic —
 * a side panel opening resizes the chat area, which recomputes the anchor.
 *
 * `top: auto` / `left: auto` are load-bearing: without them a stale `top` or
 * `left` from the popup's own stylesheet would fight the anchor and stretch
 * the box between two opposing edges.
 */

/** Inset from the container's corner. Small, so the popup reads as "in" it. */
export const CORNER_INSET_PX = 12;

/**
 * Style object pinning a fixed element to `anchorEl`'s bottom-right corner.
 *
 * A missing or unrendered anchor falls back to the viewport's own corner
 * rather than returning nothing — a popup in a slightly wrong place is
 * recoverable, a popup at 0,0 or with no position at all is not.
 */
export function cornerAnchorStyle(anchorEl, { inset = CORNER_INSET_PX } = {}) {
  const rect = anchorEl && typeof anchorEl.getBoundingClientRect === 'function'
    ? anchorEl.getBoundingClientRect()
    : null;

  // A zero-size rect means the element exists but is not laid out (hidden tab,
  // pre-mount). Treating that as a real measurement would pin the popup to the
  // top-left corner of the window, so it is rejected like a missing anchor.
  const measured = rect && rect.width > 0 && rect.height > 0 ? rect : null;

  const rightGap = measured ? window.innerWidth - measured.right : 0;
  const bottomGap = measured ? window.innerHeight - measured.bottom : 0;

  return {
    position: 'fixed',
    top: 'auto',
    left: 'auto',
    right: `${Math.max(0, Math.round(rightGap + inset))}px`,
    bottom: `${Math.max(0, Math.round(bottomGap + inset))}px`,
    margin: 0,
  };
}

/**
 * Find the on-screen container to anchor to.
 *
 * Chat screens are kept alive, so several `.conversation-canvas-wrapper`
 * elements can exist at once and `querySelector` would happily return a hidden
 * one from a background screen. Picking the first element that actually has a
 * size is what keeps the popup attached to the chat the user is looking at.
 */
export function findVisibleAnchor(selector, root = document) {
  const candidates = root.querySelectorAll(selector);
  for (const el of candidates) {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return el;
  }
  return null;
}

/**
 * Reactive bottom-right anchor for a popup.
 *
 * @param getAnchorEl  called lazily — the container often mounts after this
 *                     composable is created (slot content, v-if'd screens).
 * @param isOpen       ref/computed; the anchor is measured when it turns true,
 *                     because that is the only moment the position matters and
 *                     the only moment the container is guaranteed laid out.
 */
export function useCornerAnchor(getAnchorEl, isOpen, { inset = CORNER_INSET_PX } = {}) {
  const anchorStyle = ref(cornerAnchorStyle(null, { inset }));

  let observer = null;
  let observed = null;

  const recompute = () => {
    anchorStyle.value = cornerAnchorStyle(getAnchorEl(), { inset });
  };

  const detach = () => {
    if (observer) observer.disconnect();
    observer = null;
    observed = null;
  };

  const attach = () => {
    const el = getAnchorEl();
    recompute();
    if (!el || el === observed) return;
    detach();
    observed = el;
    // Absent in jsdom and older runtimes. The window resize listener below
    // still covers the common case, so this degrades rather than throws.
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(recompute);
      observer.observe(el);
    }
  };

  watch(
    isOpen,
    (open) => {
      if (open) nextTick(attach);
      else detach();
    },
    { immediate: false },
  );

  onMounted(() => window.addEventListener('resize', recompute));
  onBeforeUnmount(() => {
    window.removeEventListener('resize', recompute);
    detach();
  });

  return { anchorStyle, recomputeAnchor: recompute };
}

export default useCornerAnchor;
