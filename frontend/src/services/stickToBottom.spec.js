import { describe, it, expect } from 'vitest';
import {
  FOLLOW_THRESHOLD,
  CLAMP_EPSILON,
  TOUCH_SLOP,
  distanceFromBottom,
  followAfterScroll,
  isUpwardWheel,
  isUpwardTouch,
  isScrollbarPress,
} from './stickToBottom.js';
import { BOTTOM_THRESHOLD } from './scrollAnchor.js';

// 1000px of content in a 400px viewport: the bottom is scrollTop 600.
const geometry = (scrollTop, prevTop) => ({ prevTop, scrollTop, scrollHeight: 1000, clientHeight: 400 });

describe('distanceFromBottom', () => {
  it('measures the gap below the viewport', () => {
    expect(distanceFromBottom(600, 1000, 400)).toBe(0);
    expect(distanceFromBottom(500, 1000, 400)).toBe(100);
  });

  it('never goes negative (overscroll / non-scrollable)', () => {
    expect(distanceFromBottom(0, 300, 400)).toBe(0);
  });

  it('treats unmeasurable geometry as at-bottom rather than throwing', () => {
    expect(distanceFromBottom(NaN, 1000, 400)).toBe(0);
  });
});

describe('followAfterScroll — the reported bug', () => {
  it('a 1px scroll up from the bottom releases following', () => {
    // The old rule was "within 150px of the bottom = follow", which is why a
    // small scroll up was undone by the next token.
    expect(followAfterScroll(true, geometry(598, 600))).toBe(false);
  });

  it('a 100px scroll up releases — well inside the old 150px catch zone', () => {
    expect(followAfterScroll(true, geometry(500, 600))).toBe(false);
  });

  it('stays released while the user reads, even when parked near the bottom', () => {
    expect(followAfterScroll(false, geometry(560, 560))).toBe(false);
  });
});

describe('followAfterScroll — re-engaging', () => {
  it('scrolling back down to the bottom re-engages', () => {
    expect(followAfterScroll(false, geometry(600, 400))).toBe(true);
  });

  it('re-engages within FOLLOW_THRESHOLD of the bottom', () => {
    expect(followAfterScroll(false, geometry(600 - FOLLOW_THRESHOLD, 300))).toBe(true);
    expect(followAfterScroll(false, geometry(600 - FOLLOW_THRESHOLD - 1, 300))).toBe(false);
  });

  it('scrolling down but stopping short of the bottom stays released', () => {
    expect(followAfterScroll(false, geometry(450, 300))).toBe(false);
  });
});

describe('followAfterScroll — things that are not the user', () => {
  it('our own pin (moving down onto the bottom) keeps following', () => {
    expect(followAfterScroll(true, geometry(600, 550))).toBe(true);
  });

  it('a browser clamp after content shrank (moved up, still at bottom) keeps following', () => {
    // Content shrank: scrollTop was forced from 700 to the new max of 600.
    expect(followAfterScroll(true, geometry(600, 700))).toBe(true);
    expect(followAfterScroll(true, geometry(600 - CLAMP_EPSILON, 700))).toBe(true);
  });

  it('a clamp does not re-engage a released reader', () => {
    expect(followAfterScroll(false, geometry(600, 700))).toBe(false);
  });

  it('sub-pixel jitter is not a scroll', () => {
    expect(followAfterScroll(true, geometry(599.8, 600))).toBe(true);
  });
});

describe('intent classifiers', () => {
  it('upward wheel releases; downward and horizontal do not', () => {
    expect(isUpwardWheel({ deltaY: -1 })).toBe(true);
    expect(isUpwardWheel({ deltaY: 3 })).toBe(false);
    expect(isUpwardWheel({ deltaY: 0 })).toBe(false);
  });

  it('ctrl+wheel is zoom, not scroll', () => {
    expect(isUpwardWheel({ deltaY: -100, ctrlKey: true })).toBe(false);
  });

  it('a finger dragged down the screen past the slop scrolls content up', () => {
    expect(isUpwardTouch(100, 100 + TOUCH_SLOP + 1)).toBe(true);
    expect(isUpwardTouch(100, 100 + TOUCH_SLOP)).toBe(false);
    expect(isUpwardTouch(100, 60)).toBe(false);
    expect(isUpwardTouch(null, 200)).toBe(false);
  });

  it('a press in the scrollbar gutter is detected; one in content is not', () => {
    expect(isScrollbarPress(395, 390)).toBe(true);
    expect(isScrollbarPress(200, 390)).toBe(false);
    expect(isScrollbarPress(10, 0)).toBe(false);
  });
});

describe('restore agrees with following', () => {
  it('"at bottom" for scroll-restore is the same distance that re-engages following', () => {
    expect(BOTTOM_THRESHOLD).toBe(FOLLOW_THRESHOLD);
  });
});
