import { describe, it, expect } from 'vitest';
import { centeredView } from './canvasView.js';

// Screen position of canvas point p under translate(o) scale(z) about centre c.
const onScreen = (p, c, o, z) => c + o + z * (p - c);
const viewport = { width: 1000, height: 600 };

describe('centeredView', () => {
  it('puts the middle of the graph at the middle of the viewport, at any zoom', () => {
    // A graph far from the origin: the saved-offset bug put this off screen.
    const boxes = [
      { x: 2000, y: 1500, width: 200, height: 50 },
      { x: 2400, y: 1700, width: 200, height: 50 },
    ];
    for (const zoom of [1, 0.6, 0.35]) {
      const view = centeredView(boxes, viewport, { zoom });
      expect(onScreen(2300, 500, view.offsetX, view.zoom)).toBeCloseTo(500);
      expect(onScreen(1625, 300, view.offsetY, view.zoom)).toBeCloseTo(300);
    }
  });

  it('keeps a saved zoom when the graph fits, and shrinks only when it does not', () => {
    const small = [{ x: 0, y: 0, width: 200, height: 50 }];
    expect(centeredView(small, viewport, { zoom: 0.8 }).zoom).toBe(0.8);
    const wide = [
      { x: 0, y: 0, width: 200, height: 50 },
      { x: 3000, y: 0, width: 200, height: 50 },
    ];
    const view = centeredView(wide, viewport, { zoom: 1 });
    expect(view.zoom).toBeCloseTo((1000 - 96) / 3200);
    // Every node is inside the viewport.
    expect(onScreen(0, 500, view.offsetX, view.zoom)).toBeGreaterThanOrEqual(0);
    expect(onScreen(3200, 500, view.offsetX, view.zoom)).toBeLessThanOrEqual(1000);
  });

  it('fit fills the viewport but never magnifies past maxZoom', () => {
    const tiny = [{ x: 10, y: 10, width: 100, height: 40 }];
    expect(centeredView(tiny, viewport, { fit: true }).zoom).toBe(1);
    expect(centeredView(tiny, viewport, { fit: true, maxZoom: 2 }).zoom).toBe(2);
  });

  it('never zooms below minZoom however large the graph', () => {
    const huge = [
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 100000, y: 100000, width: 10, height: 10 },
    ];
    expect(centeredView(huge, viewport).zoom).toBe(0.2);
  });

  it('declines when there is nothing to centre or nowhere to centre it', () => {
    expect(centeredView([], viewport)).toBeNull();
    expect(centeredView([{ x: 0, y: 0, width: 1, height: 1 }], { width: 0, height: 0 })).toBeNull();
  });
});
