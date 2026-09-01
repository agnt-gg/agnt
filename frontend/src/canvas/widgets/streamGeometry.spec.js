// POINTER COORDINATES ACROSS A LETTERBOXED CANVAS.
//
// The stream canvas keeps the frame's aspect ratio via object-fit: contain, so
// the page is painted into a sub-rectangle with bars around it. The original
// math scaled by the ELEMENT's size, which is only correct when the aspect
// ratios match — true enough in a narrow card to look fine, and badly wrong
// once the card spans the full message width.
import { describe, it, expect } from 'vitest';
import { viewportToPage } from './streamGeometry.js';

// A frame as the service sends it, and an element far wider than that ratio:
// 1280x800 is 1.6:1, the element is 1200x320 = 3.75:1, so the paint is
// 512x320 with 344px bars either side.
const FRAME = { frameWidth: 1280, frameHeight: 800 };
const WIDE = {
  left: 100, top: 50, width: 1200, height: 320,
};

describe('a letterboxed canvas', () => {
  it('maps the element centre to the page centre', () => {
    const p = viewportToPage({
      ...FRAME, rect: WIDE, clientX: 100 + 600, clientY: 50 + 160,
    });
    expect(p).toEqual({ x: 640, y: 400 });
  });

  it('maps the painted top-left corner to the page origin', () => {
    // paint starts at left + (1200 - 512)/2 = 100 + 344 = 444
    const p = viewportToPage({
      ...FRAME, rect: WIDE, clientX: 444, clientY: 50,
    });
    expect(p).toEqual({ x: 0, y: 0 });
  });

  it('maps the painted bottom-right corner to the page extent', () => {
    const p = viewportToPage({
      ...FRAME, rect: WIDE, clientX: 444 + 512, clientY: 50 + 320,
    });
    expect(p).toEqual({ x: 1280, y: 800 });
  });

  it('REFUSES a point on the letterbox bar', () => {
    // THE REGRESSION THIS PINS: the old math clamped this into the page and
    // clicked something at the edge. It is not the page; it is empty space.
    const onLeftBar = viewportToPage({
      ...FRAME, rect: WIDE, clientX: 200, clientY: 50 + 160,
    });
    expect(onLeftBar).toBeNull();

    const onRightBar = viewportToPage({
      ...FRAME, rect: WIDE, clientX: 100 + 1150, clientY: 50 + 160,
    });
    expect(onRightBar).toBeNull();
  });

  it('is exact when the element already matches the frame ratio', () => {
    // The narrow card was near this, which is why the bug looked like nothing.
    const matched = {
      left: 0, top: 0, width: 640, height: 400,
    };
    const p = viewportToPage({
      ...FRAME, rect: matched, clientX: 320, clientY: 200,
    });
    expect(p).toEqual({ x: 640, y: 400 });
  });

  it('letterboxes vertically too, for a TALL element', () => {
    // 400x800 = 0.5:1 against a 1.6:1 frame: paint is 400x250, bars top and
    // bottom. The axis that binds is not always the horizontal one.
    const tall = {
      left: 0, top: 0, width: 400, height: 800,
    };
    const centre = viewportToPage({
      ...FRAME, rect: tall, clientX: 200, clientY: 400,
    });
    expect(centre).toEqual({ x: 640, y: 400 });

    const onTopBar = viewportToPage({
      ...FRAME, rect: tall, clientX: 200, clientY: 100,
    });
    expect(onTopBar).toBeNull();
  });

  it('answers null rather than NaN for a canvas with no frame yet', () => {
    // Before the first frame arrives the canvas is 0x0, and a click during
    // that window must not send NaN coordinates to the page.
    expect(viewportToPage({
      frameWidth: 0, frameHeight: 0, rect: WIDE, clientX: 500, clientY: 100,
    })).toBeNull();
    expect(viewportToPage({
      ...FRAME, rect: { left: 0, top: 0, width: 0, height: 0 }, clientX: 0, clientY: 0,
    })).toBeNull();
    expect(viewportToPage({ ...FRAME, rect: null, clientX: 0, clientY: 0 })).toBeNull();
  });
});
