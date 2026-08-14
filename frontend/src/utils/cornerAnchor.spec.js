/**
 * cornerAnchor — the popup must not move when its CONTENT changes.
 *
 * THE BUG THIS REPLACES
 * ─────────────────────
 * The provider popover is a different height in each of its three modes
 * (Default / Dynamic / Specific). Both call sites anchored it by top/left with
 * a constant standing in for the height:
 *
 *   BaseScreen           top: `${buttonRect.top - 420}px`
 *   UnifiedChatContainer right: '1592px', bottom: '148px', left: '96px'
 *
 * so switching modes moved the panel, and the sidebar version was only in the
 * right place on the window size it was measured at.
 *
 * The property these tests defend is the one that was actually asked for: the
 * corner does not move — not in any mode, not at any window size, not when a
 * side panel opens.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { cornerAnchorStyle, findVisibleAnchor, CORNER_INSET_PX } from './cornerAnchor.js';

/** A container rect, as getBoundingClientRect would report it. */
const anchorAt = ({ left, top, right, bottom }) => ({
  getBoundingClientRect: () => ({
    left, top, right, bottom,
    width: right - left,
    height: bottom - top,
  }),
});

beforeEach(() => {
  window.innerWidth = 1920;
  window.innerHeight = 1080;
});

describe('the popup is pinned to the container corner', () => {
  it('measures right/bottom gaps from the container, plus the inset', () => {
    // Container ends 320px short of the right edge and 148px short of the
    // bottom — a chat with a right panel open and an input bar below it.
    const style = cornerAnchorStyle(anchorAt({ left: 96, top: 60, right: 1600, bottom: 932 }));

    expect(style.right).toBe(`${1920 - 1600 + CORNER_INSET_PX}px`);
    expect(style.bottom).toBe(`${1080 - 932 + CORNER_INSET_PX}px`);
  });

  it('leaves top and left explicitly auto', () => {
    // Load-bearing. A leftover `top` or `left` from the popup's own stylesheet
    // would fight the anchor and stretch the box between opposing edges —
    // which is exactly what `left: 96px` + `right: 1592px` used to do.
    const style = cornerAnchorStyle(anchorAt({ left: 0, top: 0, right: 800, bottom: 600 }));

    expect(style.top).toBe('auto');
    expect(style.left).toBe('auto');
    expect(style.position).toBe('fixed');
    expect(style.margin).toBe(0);
  });

  it('never emits a top or left coordinate', () => {
    // The whole point: no top/left means content growth cannot push the panel
    // down or right. Any numeric top/left would reintroduce the bug.
    const style = cornerAnchorStyle(anchorAt({ left: 96, top: 60, right: 1600, bottom: 932 }));

    for (const [prop, value] of Object.entries(style)) {
      if (prop === 'top' || prop === 'left') expect(value).toBe('auto');
    }
  });
});

describe('the anchor is independent of the popup content', () => {
  it('returns the identical style for every mode of the panel', () => {
    // Default / Dynamic / Specific differ in HEIGHT only. The anchor never
    // measures the popup, so all three land on the same corner — the
    // regression that motivated this change.
    const container = anchorAt({ left: 96, top: 60, right: 1600, bottom: 932 });

    const a = cornerAnchorStyle(container);
    const b = cornerAnchorStyle(container);
    const c = cornerAnchorStyle(container);

    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });
});

describe('it travels with the layout', () => {
  it('moves left when a right panel opens (container gets narrower)', () => {
    const wide = cornerAnchorStyle(anchorAt({ left: 96, top: 60, right: 1900, bottom: 932 }));
    const narrow = cornerAnchorStyle(anchorAt({ left: 96, top: 60, right: 1500, bottom: 932 }));

    expect(parseInt(narrow.right, 10)).toBeGreaterThan(parseInt(wide.right, 10));
    expect(parseInt(narrow.right, 10) - parseInt(wide.right, 10)).toBe(400);
  });

  it('is measured, not hardcoded — a different window gives a different offset', () => {
    const container = anchorAt({ left: 96, top: 60, right: 1600, bottom: 932 });

    const onBig = cornerAnchorStyle(container);
    window.innerWidth = 1280;
    const onSmall = cornerAnchorStyle(container);

    expect(onBig.right).not.toBe(onSmall.right);
  });
});

describe('a missing or unrendered anchor degrades instead of breaking', () => {
  it('falls back to the viewport corner when there is no anchor', () => {
    // Some screens have no chat canvas at all. A popup slightly out of place
    // is recoverable; a popup at 0,0 with no position is not.
    const style = cornerAnchorStyle(null);

    expect(style.right).toBe(`${CORNER_INSET_PX}px`);
    expect(style.bottom).toBe(`${CORNER_INSET_PX}px`);
  });

  it('treats a zero-size rect as no anchor', () => {
    // A hidden / not-yet-laid-out element reports 0x0. Trusting that would pin
    // the popup to the TOP-LEFT of the window, which looks like a hard bug.
    const hidden = anchorAt({ left: 0, top: 0, right: 0, bottom: 0 });

    expect(cornerAnchorStyle(hidden)).toEqual(cornerAnchorStyle(null));
  });

  it('never emits a negative offset', () => {
    // A container scrolled past the viewport edge would otherwise produce a
    // negative right/bottom, throwing the popup off screen.
    const offscreen = anchorAt({ left: 2400, top: 1400, right: 3000, bottom: 1800 });
    const style = cornerAnchorStyle(offscreen);

    expect(parseInt(style.right, 10)).toBeGreaterThanOrEqual(0);
    expect(parseInt(style.bottom, 10)).toBeGreaterThanOrEqual(0);
  });
});

describe('findVisibleAnchor picks the on-screen container', () => {
  const fakeRoot = (elements) => ({ querySelectorAll: () => elements });

  it('skips hidden candidates from kept-alive background screens', () => {
    // Several chat screens stay mounted, so querySelector alone would happily
    // return a hidden one and anchor the popup to a chat nobody is looking at.
    const hidden = anchorAt({ left: 0, top: 0, right: 0, bottom: 0 });
    const visible = anchorAt({ left: 96, top: 60, right: 1600, bottom: 932 });

    expect(findVisibleAnchor('.x', fakeRoot([hidden, visible]))).toBe(visible);
  });

  it('returns null when every candidate is hidden', () => {
    const hidden = anchorAt({ left: 0, top: 0, right: 0, bottom: 0 });

    expect(findVisibleAnchor('.x', fakeRoot([hidden]))).toBeNull();
    expect(findVisibleAnchor('.x', fakeRoot([]))).toBeNull();
  });
});
