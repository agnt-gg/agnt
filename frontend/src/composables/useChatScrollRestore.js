/**
 * useChatScrollRestore — measure the transcript, and put it back where it was.
 *
 * This is the DOM half of the scroll-restore feature. Every DECISION lives in
 * services/scrollAnchor.js as pure arithmetic; everything here is measurement
 * and application, kept deliberately thin because jsdom reports 0 for all
 * layout and so nothing in this file can be meaningfully unit-tested against
 * real geometry. What IS tested here is the control flow — debounce, restart,
 * abort, the guard that stops a half-settled position from being saved — via
 * an injected element stub.
 *
 * WHY RESTORE IS A LOOP AND NOT A ONE-SHOT
 * ----------------------------------------
 * A transcript is not finished growing when Vue says it is rendered. Markdown
 * parse, sanitize, MathJax typeset and image decode all resolve over the next
 * few hundred milliseconds and each one changes the height of the document
 * under us. Setting scrollTop once inside nextTick() lands correctly and then
 * drifts as the content settles. So we re-apply the anchor every frame until
 * the document height stops changing (or we run out of patience), which
 * converges on the right pixel instead of racing the content.
 *
 * The loop yields to the user immediately: any wheel, touch, pointer or key
 * input aborts it. A restore that fights the user is worse than no restore.
 */

import { ref, nextTick } from 'vue';
import { ANCHOR_ATTR, isAtBottom, pickAnchor, resolveScrollTarget } from '@/services/scrollAnchor.js';
import { getScrollPosition, setScrollPosition } from '@/services/chatScrollPositions.js';

/** Trailing debounce on scroll. Fast enough to survive a hard nav, slow enough not to thrash storage during a flick. */
export const CAPTURE_DEBOUNCE_MS = 250;

/** How long the settle loop keeps correcting before it accepts the layout as final. */
export const SETTLE_TIMEOUT_MS = 600;

/** Consecutive frames of unchanged scrollHeight that count as "settled". */
export const STABLE_FRAMES = 2;

const raf =
  typeof requestAnimationFrame === 'function' ? (cb) => requestAnimationFrame(cb) : (cb) => setTimeout(() => cb(), 16);
const cancelRaf = typeof cancelAnimationFrame === 'function' ? (id) => cancelAnimationFrame(id) : (id) => clearTimeout(id);

/**
 * Measure every anchored message in the scroll container's CONTENT coordinate
 * space (0 = top of the transcript).
 *
 * getBoundingClientRect is used rather than offsetTop because offsetTop is
 * relative to the nearest positioned ancestor, which the transcript's wrappers
 * do not guarantee. Subtracting the container's own rect and adding back its
 * scrollTop converts viewport coordinates into content coordinates for any
 * nesting depth.
 */
export function measureItems(el) {
  if (!el || typeof el.querySelectorAll !== 'function' || typeof el.getBoundingClientRect !== 'function') return [];
  const containerTop = el.getBoundingClientRect().top - (el.scrollTop || 0);
  const items = [];
  for (const node of el.querySelectorAll(`[${ANCHOR_ATTR}]`)) {
    const id = node.getAttribute(ANCHOR_ATTR);
    if (!id) continue;
    const rect = node.getBoundingClientRect();
    items.push({ id, top: rect.top - containerTop, height: rect.height });
  }
  return items;
}

/**
 * @param {object}   opts
 * @param {Function} opts.getEl     returns the scrollable element (or null)
 * @param {Function} opts.getKey    returns the current conversation identity
 * @param {Function} [opts.getWindow]  current rendered-message-window size
 * @param {Function} [opts.setWindow]  restore a rendered-message-window size
 */
export function useChatScrollRestore({
  getEl,
  getKey,
  getWindow = null,
  setWindow = null,
  debounceMs = CAPTURE_DEBOUNCE_MS,
  settleMs = SETTLE_TIMEOUT_MS,
} = {}) {
  /**
   * True while the settle loop owns scrollTop. Hosts read this to stand down:
   * the near-bottom autoscroll watcher must not yank a mid-restore transcript
   * to the bottom just because a streamed chunk arrived.
   */
  const isRestoring = ref(false);

  let debounceTimer = null;
  let rafId = null;
  let abortListeners = null;

  const clearDebounce = () => {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  };

  /**
   * Record the current position under `key`.
   *
   * Refuses to run mid-restore: at that moment scrollTop is whatever the
   * settle loop has reached against a document that is still growing, and
   * writing it would overwrite the user's real position with an artefact of
   * our own restoration.
   */
  const captureNow = (key = getKey?.()) => {
    if (!key || typeof key !== 'string') return;
    if (isRestoring.value) return;
    const el = getEl?.();
    if (!el) return;

    const scrollTop = el.scrollTop || 0;
    const scrollHeight = el.scrollHeight || 0;
    const clientHeight = el.clientHeight || 0;

    // Nothing to scroll: there is no position to remember, and writing one
    // would clobber a real position saved before the transcript was trimmed.
    if (scrollHeight <= clientHeight) return;

    const atBottom = isAtBottom(scrollTop, scrollHeight, clientHeight);
    const anchor = atBottom ? null : pickAnchor(measureItems(el), scrollTop);

    // Non-bottom with nothing measurable to anchor to is not a position we can
    // reproduce; storing it would only mean "bottom" while looking specific.
    if (!atBottom && !anchor) return;

    setScrollPosition(key, {
      anchorId: anchor ? anchor.anchorId : null,
      anchorOffset: anchor ? anchor.anchorOffset : 0,
      atBottom,
      window: typeof getWindow === 'function' ? getWindow() : null,
    });
  };

  /**
   * Debounced capture. The key is resolved when the timer FIRES, not when it
   * is scheduled — but a conversation switch cancels the timer first (see
   * flushCapture), so a pending save can never be filed under the wrong
   * conversation.
   */
  const scheduleCapture = () => {
    if (isRestoring.value) return;
    clearDebounce();
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      captureNow();
    }, debounceMs);
  };

  /** Cancel any pending debounce and save `key` immediately. */
  const flushCapture = (key = getKey?.()) => {
    clearDebounce();
    captureNow(key);
  };

  const stopSettle = () => {
    if (rafId !== null) {
      cancelRaf(rafId);
      rafId = null;
    }
    if (abortListeners) {
      abortListeners();
      abortListeners = null;
    }
    isRestoring.value = false;
  };

  /**
   * Put the viewport back for `key`.
   *
   * Restarts cleanly if called again while a previous restore is still
   * settling — conversation opens can overlap (the switch watcher fires, then
   * the loader finishes fetching), and the last caller is always the one with
   * the correct DOM.
   */
  const restore = async (key = getKey?.()) => {
    stopSettle();
    clearDebounce();

    const saved = key && typeof key === 'string' ? getScrollPosition(key) : null;

    // A missing entry is not a failure: a conversation with no remembered
    // position opens where a chat naturally opens, at the bottom.
    const target = saved || { anchorId: null, anchorOffset: 0, atBottom: true, window: null };

    // The window must be restored BEFORE we look for the anchor, or the
    // anchor is simply not mounted and every lookup falls back to the bottom.
    if (target.window && typeof setWindow === 'function') setWindow(target.window);

    isRestoring.value = true;
    await nextTick();

    const el = getEl?.();
    if (!el) {
      isRestoring.value = false;
      return;
    }

    abortListeners = attachAbortListeners(el, stopSettle);

    const deadline = Date.now() + settleMs;
    let lastHeight = -1;
    let stable = 0;

    const step = () => {
      rafId = null;
      const live = getEl?.();
      if (!live) return stopSettle();

      const scrollHeight = live.scrollHeight || 0;
      const clientHeight = live.clientHeight || 0;

      const top = resolveScrollTarget({
        items: target.atBottom ? [] : measureItems(live),
        anchorId: target.anchorId,
        anchorOffset: target.anchorOffset,
        atBottom: target.atBottom,
        scrollHeight,
        clientHeight,
      });

      if (Math.abs((live.scrollTop || 0) - top) > 0.5) live.scrollTop = top;

      if (scrollHeight === lastHeight) stable += 1;
      else {
        stable = 0;
        lastHeight = scrollHeight;
      }

      if (stable >= STABLE_FRAMES || Date.now() >= deadline) return stopSettle();
      rafId = raf(step);
    };

    rafId = raf(step);
  };

  /** Release timers and listeners. Hosts call this from their unmount hook. */
  const teardown = () => {
    clearDebounce();
    stopSettle();
  };

  return { isRestoring, captureNow, scheduleCapture, flushCapture, restore, teardown };
}

/**
 * Hand the scroll back to the user the instant they ask for it. Only genuine
 * input events are listened for — a `scroll` event cannot be used here because
 * the settle loop's own scrollTop writes produce them.
 */
function attachAbortListeners(el, abort) {
  const opts = { passive: true };
  const events = ['wheel', 'touchstart', 'pointerdown', 'mousedown'];
  if (typeof el.addEventListener === 'function') {
    events.forEach((name) => el.addEventListener(name, abort, opts));
  }
  if (typeof window !== 'undefined') window.addEventListener('keydown', abort, opts);

  return () => {
    if (typeof el.removeEventListener === 'function') {
      events.forEach((name) => el.removeEventListener(name, abort, opts));
    }
    if (typeof window !== 'undefined') window.removeEventListener('keydown', abort, opts);
  };
}

export default useChatScrollRestore;
