/**
 * useStickToBottom — keep a live transcript pinned to its bottom edge until
 * the user says otherwise, and let go the instant they do.
 *
 * The DOM half of services/stickToBottom.js: listeners and observers only.
 * See that file for why following is a state rather than a distance check.
 *
 * Growth is detected from the DOM, not from the message store, because most of
 * what grows a transcript never touches the store: markdown and MathJax
 * settling, images decoding, tool calls expanding.
 *
 * @param {object}   opts
 * @param {Function} opts.getEl        returns the scroll container (or null)
 * @param {Function} [opts.isSuspended] true while something else owns
 *   scrollTop (the scroll-restore settle loop). Suspended: no pinning, and
 *   scroll events are not read as intent. On resume, following is re-derived
 *   from where the viewport landed — unless the user released during the
 *   suspension, which always wins.
 */

import { ref, watch, onMounted, onBeforeUnmount } from 'vue';
import {
  distanceFromBottom,
  followAfterScroll,
  isUpwardWheel,
  isUpwardTouch,
  isScrollbarPress,
  FOLLOW_THRESHOLD,
} from '@/services/stickToBottom.js';

export function useStickToBottom({ getEl, isSuspended = () => false } = {}) {
  const following = ref(true);

  let el = null;
  let lastTop = 0;
  let touchStartY = null;
  let releasedWhileSuspended = false;
  let mutationObserver = null;
  let resizeObserver = null;

  const suspended = () => Boolean(isSuspended());

  const atBottom = () =>
    !!el && distanceFromBottom(el.scrollTop || 0, el.scrollHeight || 0, el.clientHeight || 0) <= FOLLOW_THRESHOLD;

  /** Snap to the bottom if following. Instant on purpose — see stickToBottom.js. */
  const pin = () => {
    if (!el || !following.value || suspended()) return;
    if (distanceFromBottom(el.scrollTop || 0, el.scrollHeight || 0, el.clientHeight || 0) > 0.5) {
      el.scrollTop = el.scrollHeight;
    }
    lastTop = el.scrollTop || 0;
  };

  const release = () => {
    following.value = false;
    if (suspended()) releasedWhileSuspended = true;
  };

  /**
   * Re-engage following. `pin: false` is for callers already animating to the
   * bottom themselves (the scroll-to-bottom control): an instant pin would cut
   * their smooth scroll short. The next content growth pins regardless.
   */
  const follow = ({ pin: pinNow = true } = {}) => {
    following.value = true;
    releasedWhileSuspended = false;
    if (pinNow) pin();
  };

  const onScroll = () => {
    const scrollTop = el.scrollTop || 0;
    if (!suspended()) {
      following.value = followAfterScroll(following.value, {
        prevTop: lastTop,
        scrollTop,
        scrollHeight: el.scrollHeight || 0,
        clientHeight: el.clientHeight || 0,
      });
    }
    lastTop = scrollTop;
  };

  const onWheel = (event) => {
    if (isUpwardWheel(event)) release();
  };

  const onTouchStart = (event) => {
    touchStartY = event.touches?.[0]?.clientY ?? null;
  };

  const onTouchMove = (event) => {
    if (isUpwardTouch(touchStartY, event.touches?.[0]?.clientY)) release();
  };

  const onTouchEnd = () => {
    touchStartY = null;
  };

  // Grabbing the scrollbar thumb: release before the first drag frame, or a
  // token landing in between would yank the thumb out from under the pointer.
  const onPointerDown = (event) => {
    if (event.target === el && isScrollbarPress(event.offsetX, el.clientWidth)) release();
  };

  // A drag-select while pinned would have its text scrolled out from under it.
  const onSelectionChange = () => {
    if (!el || typeof document === 'undefined') return;
    const selection = document.getSelection?.();
    if (selection && !selection.isCollapsed && selection.anchorNode && el.contains(selection.anchorNode)) release();
  };

  // Direct children grow when anything inside them settles (images, MathJax,
  // expanded tool calls). observe() on an already-observed node is a no-op, so
  // re-walking after each mutation batch only picks up new children.
  const observeChildren = () => {
    if (!resizeObserver || !el) return;
    for (const child of el.children) resizeObserver.observe(child);
  };

  const listeners = [
    ['scroll', onScroll],
    ['wheel', onWheel],
    ['touchstart', onTouchStart],
    ['touchmove', onTouchMove],
    ['touchend', onTouchEnd],
    ['touchcancel', onTouchEnd],
    ['pointerdown', onPointerDown],
  ];

  const detach = () => {
    if (el) listeners.forEach(([name, handler]) => el.removeEventListener(name, handler, { passive: true }));
    if (typeof document !== 'undefined') document.removeEventListener('selectionchange', onSelectionChange);
    mutationObserver?.disconnect();
    resizeObserver?.disconnect();
    mutationObserver = null;
    resizeObserver = null;
    el = null;
  };

  const attach = () => {
    const next = getEl?.() || null;
    if (next === el) return;
    detach();
    if (!next || typeof next.addEventListener !== 'function') return;
    el = next;
    lastTop = el.scrollTop || 0;
    listeners.forEach(([name, handler]) => el.addEventListener(name, handler, { passive: true }));
    if (typeof document !== 'undefined') document.addEventListener('selectionchange', onSelectionChange);
    if (typeof MutationObserver !== 'undefined') {
      mutationObserver = new MutationObserver(() => {
        observeChildren();
        pin();
      });
      mutationObserver.observe(el, { childList: true, subtree: true, characterData: true });
    }
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => pin());
      resizeObserver.observe(el);
      observeChildren();
    }
    pin();
  };

  // flush: 'sync' is load-bearing. The restore loop ends inside the same wheel
  // event that releases following; with a deferred flush the resume below
  // would run AFTER the release and re-engage on a viewport that has not
  // moved yet.
  watch(
    suspended,
    (isNow, was) => {
      if (isNow && !was) {
        releasedWhileSuspended = false;
        return;
      }
      if (!isNow && was) {
        following.value = !releasedWhileSuspended && atBottom();
        releasedWhileSuspended = false;
        if (el) lastTop = el.scrollTop || 0;
      }
    },
    { flush: 'sync' },
  );

  onMounted(attach);
  watch(() => getEl?.(), attach, { flush: 'post' });
  onBeforeUnmount(detach);

  return { following, follow, release, pin };
}

export default useStickToBottom;
