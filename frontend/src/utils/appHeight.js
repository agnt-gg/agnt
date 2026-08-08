/**
 * Keeps `--app-height` equal to the height that is actually on screen.
 *
 * The token is DEFINED in styles/base/_layout.css as `100dvh` (with `100svh`
 * and `100vh` fallbacks). That covers every case except one: iOS never shrinks
 * the layout viewport for its on-screen keyboard, and `interactive-widget=`
 * is a no-op there — so `dvh` keeps its full value while the keyboard is up
 * and the composer, being the bottom-most child of an overflow:hidden column,
 * ends up behind the keys.
 *
 * `window.visualViewport` is the one API that does see the keyboard on every
 * mobile engine. This module is therefore a REFINEMENT of the CSS value, never
 * a second source of truth for it: it writes the same custom property and
 * nothing else, so removing this file degrades to the CSS fallback rather than
 * breaking the layout.
 *
 * Deliberately inert on desktop. There is no keyboard to compensate for, and
 * an inline override would replace a live `dvh` with a number frozen at the
 * last resize event.
 */

export const APP_HEIGHT_VAR = '--app-height';

/**
 * A pinch-zoom also shrinks the visual viewport, and following it would make
 * the whole shell reflow under the user's fingers. Anything above 1 is a zoom;
 * the epsilon absorbs the fractional scale iOS reports at rest.
 */
const ZOOM_EPSILON = 0.01;

/**
 * @param {Window} [win] injectable for tests
 * @returns {() => void} uninstall
 */
export function installAppHeight(win = typeof window !== 'undefined' ? window : undefined) {
  const noop = () => {};

  const viewport = win?.visualViewport;
  if (!viewport) return noop;

  // Primary pointer is coarse => a device with an on-screen keyboard.
  if (!win.matchMedia?.('(pointer: coarse)')?.matches) return noop;

  const root = win.document?.documentElement;
  if (!root?.style) return noop;

  const apply = () => {
    if (viewport.scale > 1 + ZOOM_EPSILON) {
      // Hand the token back to CSS for the duration of the zoom.
      root.style.removeProperty(APP_HEIGHT_VAR);
      return;
    }
    const height = Math.round(viewport.height);
    if (height > 0) root.style.setProperty(APP_HEIGHT_VAR, `${height}px`);
  };

  apply();
  viewport.addEventListener('resize', apply);

  return () => {
    viewport.removeEventListener('resize', apply);
    root.style.removeProperty(APP_HEIGHT_VAR);
  };
}
