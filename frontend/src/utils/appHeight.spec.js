import { describe, it, expect, vi } from 'vitest';
import { installAppHeight, APP_HEIGHT_VAR } from './appHeight.js';

/**
 * A fake Window that exposes exactly the four things the module touches.
 * Building it by hand rather than driving jsdom keeps the assertions about
 * behaviour rather than about jsdom's visualViewport stub (it has none).
 */
function makeWin({ coarse = true, viewport = {}, hasViewport = true } = {}) {
  const listeners = new Map();
  const props = new Map();

  const visualViewport = hasViewport
    ? {
        height: 640,
        scale: 1,
        ...viewport,
        addEventListener: vi.fn((type, fn) => listeners.set(type, fn)),
        removeEventListener: vi.fn((type) => listeners.delete(type)),
      }
    : undefined;

  return {
    visualViewport,
    matchMedia: vi.fn((q) => ({ matches: coarse && q.includes('coarse') })),
    document: {
      documentElement: {
        style: {
          setProperty: (name, value) => props.set(name, value),
          removeProperty: (name) => props.delete(name),
          getPropertyValue: (name) => props.get(name) ?? '',
        },
      },
    },
    // test handles
    _fire: (type) => listeners.get(type)?.(),
    _has: (type) => listeners.has(type),
    _get: () => props.get(APP_HEIGHT_VAR),
  };
}

describe('installAppHeight', () => {
  it('publishes the visual viewport height immediately', () => {
    const win = makeWin({ viewport: { height: 640 } });
    installAppHeight(win);
    expect(win._get()).toBe('640px');
  });

  it('follows the viewport when the keyboard opens and closes', () => {
    const win = makeWin({ viewport: { height: 844 } });
    installAppHeight(win);
    expect(win._get()).toBe('844px');

    win.visualViewport.height = 508; // keyboard up
    win._fire('resize');
    expect(win._get()).toBe('508px');

    win.visualViewport.height = 844; // keyboard down
    win._fire('resize');
    expect(win._get()).toBe('844px');
  });

  it('rounds to whole pixels (iOS reports fractions)', () => {
    const win = makeWin({ viewport: { height: 843.3333 } });
    installAppHeight(win);
    expect(win._get()).toBe('843px');
  });

  it('does nothing on a fine-pointer device, leaving the CSS dvh value live', () => {
    const win = makeWin({ coarse: false });
    installAppHeight(win);
    expect(win._get()).toBeUndefined();
    expect(win._has('resize')).toBe(false);
  });

  it('does nothing when visualViewport is unsupported', () => {
    const win = makeWin({ hasViewport: false });
    expect(() => installAppHeight(win)).not.toThrow();
    expect(win._get()).toBeUndefined();
  });

  it('does not throw when called with no window at all', () => {
    expect(() => installAppHeight(undefined)).not.toThrow();
  });

  it('hands the token back to CSS while the user is pinch-zoomed', () => {
    // Following the zoom would reflow the whole shell under the user's
    // fingers; the CSS fallback is the correct value at that moment.
    const win = makeWin({ viewport: { height: 640 } });
    installAppHeight(win);
    expect(win._get()).toBe('640px');

    win.visualViewport.scale = 2;
    win.visualViewport.height = 320;
    win._fire('resize');
    expect(win._get()).toBeUndefined();

    win.visualViewport.scale = 1;
    win.visualViewport.height = 640;
    win._fire('resize');
    expect(win._get()).toBe('640px');
  });

  it('ignores a zero height rather than collapsing the app', () => {
    const win = makeWin({ viewport: { height: 640 } });
    installAppHeight(win);
    win.visualViewport.height = 0;
    win._fire('resize');
    expect(win._get()).toBe('640px');
  });

  it('uninstalls cleanly', () => {
    const win = makeWin();
    const stop = installAppHeight(win);
    expect(win._has('resize')).toBe(true);
    stop();
    expect(win._has('resize')).toBe(false);
    expect(win._get()).toBeUndefined();
  });
});
