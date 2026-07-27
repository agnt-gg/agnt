/**
 * Grid spacing + containment contract — shared by BOTH canvas surfaces
 * (custom pages via the widgetLayout store, the workspace canvas via
 * useWorkspaces).
 *
 * Two guarantees, both reported broken by the user:
 *   1. SPACING: exactly GRID_GAP (4px) between every pair of adjacent
 *      widgets, and ZERO inset against the container. No 2px, no doubling.
 *      (The outer inset was removed after the uniform-4px pass: GRID_GAP is a
 *      gutter, and using it as a margin too left the canvas visibly indented
 *      and the bottom row 4px short of the container.)
 *   2. CONTAINMENT: a widget can never be positioned, resized, loaded or
 *      templated past the canvas edge (where it can't be grabbed back).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import {
  calculateCellDimensions,
  gridToPixel,
  clampInstance,
  isInsideGrid,
  findEmptySlot,
  GRID_COLS,
  GRID_ROWS,
  GRID_GAP,
} from './gridUtils.js';

describe('spacing — exactly GRID_GAP everywhere', () => {
  // Real-world container sizes, including fractional cell widths.
  const SIZES = [[1200, 800], [1771, 917], [2560, 1329], [901, 613]];

  it.each(SIZES)('%ix%i: a full-span widget is flush to all four edges', (W, H) => {
    const { cellWidth, cellHeight } = calculateCellDimensions(W, H);
    const at = (c, r, cs, rs) => gridToPixel(c, r, cs, rs, cellWidth, cellHeight);

    const full = at(0, 0, GRID_COLS, GRID_ROWS);
    expect(full.x).toBe(0);
    expect(full.y).toBe(0);
    expect(W - (full.x + full.width)).toBeCloseTo(0, 6);
    expect(H - (full.y + full.height)).toBeCloseTo(0, 6);
    // and it therefore occupies the container exactly
    expect(full.width).toBeCloseTo(W, 6);
    expect(full.height).toBeCloseTo(H, 6);
  });

  it.each(SIZES)('%ix%i: 4px between every pair of adjacent widgets', (W, H) => {
    const { cellWidth, cellHeight } = calculateCellDimensions(W, H);
    const at = (c, r, cs, rs) => gridToPixel(c, r, cs, rs, cellWidth, cellHeight);

    // Walk every column seam and every row seam.
    for (let c = 1; c < GRID_COLS; c++) {
      const left = at(0, 0, c, 1);
      const right = at(c, 0, GRID_COLS - c, 1);
      expect(right.x - (left.x + left.width)).toBeCloseTo(GRID_GAP, 6);
    }
    for (let r = 1; r < GRID_ROWS; r++) {
      const top = at(0, 0, 1, r);
      const bottom = at(0, r, 1, GRID_ROWS - r);
      expect(bottom.y - (top.y + top.height)).toBeCloseTo(GRID_GAP, 6);
    }
  });

  it('the gap constant is 4 and the grid is 12x8', () => {
    expect(GRID_GAP).toBe(4);
    expect([GRID_COLS, GRID_ROWS]).toEqual([12, 8]);
  });

  it('.widget-frame renders border-box so the 1px border cannot eat the gap', async () => {
    // Regression: without border-box the rendered box is 2px wider/taller than
    // gridToPixel computed, collapsing the right/bottom/between gaps to 2px
    // while left/top stayed 4px (measured on the live canvas).
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = fs.readFileSync(path.join(here, 'WidgetFrame.vue'), 'utf8');
    const i = src.indexOf('.widget-frame {');
    expect(src.slice(i, src.indexOf('}', i))).toMatch(/box-sizing:\s*border-box/);
  });
});

describe('clampInstance — the canonical grid invariant', () => {
  it('leaves a valid instance untouched', () => {
    const w = { instanceId: 'a', widgetId: 'x', col: 6, row: 4, cols: 6, rows: 4 };
    expect(clampInstance(w)).toMatchObject(w);
  });

  it('pulls an over-wide / over-tall footprint back inside', () => {
    expect(clampInstance({ col: 8, row: 0, cols: 6, rows: 2 })).toMatchObject({ col: 6, cols: 6 });
    expect(clampInstance({ col: 0, row: 6, cols: 2, rows: 6 })).toMatchObject({ row: 2, rows: 6 });
  });

  it('caps a span larger than the whole grid', () => {
    expect(clampInstance({ col: 0, row: 0, cols: 99, rows: 99 }))
      .toMatchObject({ col: 0, row: 0, cols: GRID_COLS, rows: GRID_ROWS });
  });

  it('repairs negative, missing and non-numeric geometry', () => {
    expect(clampInstance({ col: -5, row: -3, cols: 4, rows: 2 })).toMatchObject({ col: 0, row: 0 });
    expect(isInsideGrid(clampInstance({}))).toBe(true);
    expect(isInsideGrid(clampInstance({ col: NaN, row: 'x', cols: null, rows: undefined }))).toBe(true);
  });

  it('preserves every non-geometry field', () => {
    const w = { instanceId: 'a', widgetId: 'traces', chatKey: 'k', zIndex: 12, visible: true, col: 20, row: 0, cols: 4, rows: 4 };
    const c = clampInstance(w);
    expect(c).toMatchObject({ instanceId: 'a', widgetId: 'traces', chatKey: 'k', zIndex: 12, visible: true });
    expect(isInsideGrid(c)).toBe(true);
  });

  it('survives being passed straight to array.map', () => {
    // `.map(clampInstance)` hands over (element, index, array) — the index and
    // array landed on the optional grid-bound parameters and produced NaN
    // geometry. The bounds are sanitized, so this is safe.
    const out = [
      { col: 3, row: 2, cols: 4, rows: 3 },
      { col: 8, row: 5, cols: 6, rows: 4 },
      { col: 0, row: 0, cols: 12, rows: 8 },
    ].map(clampInstance);
    for (const w of out) expect(isInsideGrid(w)).toBe(true);
    expect(out[0]).toMatchObject({ col: 3, row: 2, cols: 4, rows: 3 });
    expect(out[2]).toMatchObject({ col: 0, row: 0, cols: 12, rows: 8 });
  });

  it('ignores nonsense bounds instead of emitting NaN', () => {
    const w = { col: 2, row: 2, cols: 4, rows: 3 };
    for (const bad of [0, -5, NaN, undefined, null, 'x', [], 7]) {
      expect(clampInstance(w, bad)).toMatchObject(w); // non-options → defaults
    }
    for (const bad of [{ gridCols: 0 }, { gridCols: NaN }, { gridRows: -3 }, { gridCols: 'x' }]) {
      expect(isInsideGrid(clampInstance(w, bad))).toBe(true);
    }
  });

  it('honours explicit bounds when given properly', () => {
    expect(clampInstance({ col: 5, row: 5, cols: 4, rows: 4 }, { gridCols: 6, gridRows: 6 }))
      .toMatchObject({ col: 2, row: 2, cols: 4, rows: 4 });
  });

  it('every clamped instance satisfies col+cols<=12 and row+rows<=8', () => {
    for (let col = -3; col <= 15; col++) {
      for (let cols = -1; cols <= 15; cols++) {
        expect(isInsideGrid(clampInstance({ col, row: col, cols, rows: cols }))).toBe(true);
      }
    }
  });
});

describe('findEmptySlot — never places a widget past the edge', () => {
  it('returns an in-bounds slot on an empty grid', () => {
    const s = findEmptySlot([], 6, 4);
    expect(isInsideGrid({ ...s, cols: 6, rows: 4 })).toBe(true);
  });

  it('a full canvas still yields an in-bounds slot for a large widget', () => {
    // Regression: the overlap fallback scanned bounds derived from a SMALLER
    // probe size (1x1 / 2x1) while the widget kept its real span, so it could
    // return col 11 for a 6-wide widget — 5 columns off-canvas.
    const full = [{ col: 0, row: 0, cols: GRID_COLS, rows: GRID_ROWS, visible: true }];
    for (const [cols, rows] of [[6, 4], [12, 8], [4, 3], [8, 2]]) {
      const s = findEmptySlot(full, cols, rows);
      expect(isInsideGrid({ ...s, cols, rows })).toBe(true);
    }
  });

  it('holds for every span against a nearly-full canvas', () => {
    // Leave a single 1x1 hole at the bottom-right so the clean-fit scan fails
    // for anything bigger and the overlap fallback is exercised.
    const occupied = [
      { col: 0, row: 0, cols: GRID_COLS, rows: GRID_ROWS - 1, visible: true },
      { col: 0, row: GRID_ROWS - 1, cols: GRID_COLS - 1, rows: 1, visible: true },
    ];
    for (let cols = 1; cols <= GRID_COLS; cols++) {
      for (let rows = 1; rows <= GRID_ROWS; rows++) {
        const s = findEmptySlot(occupied, cols, rows);
        expect(isInsideGrid({ ...s, cols, rows })).toBe(true);
      }
    }
  });
});

describe('custom-page store — clamping is a property of the mutations', () => {
  let mod;
  beforeEach(async () => {
    vi.resetModules();
    mod = (await import('@/store/features/widgetLayout.js')).default;
  });

  const freshState = () => ({ pages: [], activePageId: null, layouts: {}, isLoaded: false, isDirty: false });

  it('SET_ALL_LAYOUTS repairs out-of-bounds geometry loaded from the backend', () => {
    const state = freshState();
    mod.mutations.SET_ALL_LAYOUTS(state, {
      p1: [
        { instanceId: 'a', widgetId: 'x', col: 10, row: 0, cols: 6, rows: 4 },
        { instanceId: 'b', widgetId: 'y', col: 0, row: 7, cols: 4, rows: 6 },
      ],
    });
    for (const w of state.layouts.p1) expect(isInsideGrid(w)).toBe(true);
    expect(state.layouts.p1[0]).toMatchObject({ col: 6, cols: 6 });
    expect(state.layouts.p1[1]).toMatchObject({ row: 2, rows: 6 });
  });

  it('SET_LAYOUT clamps template / default / reset layouts', () => {
    const state = freshState();
    mod.mutations.SET_LAYOUT(state, {
      pageId: 'p1',
      layout: [{ instanceId: 'a', widgetId: 'x', col: 9, row: 6, cols: 8, rows: 5 }],
    });
    expect(isInsideGrid(state.layouts.p1[0])).toBe(true);
  });

  it('ADD_WIDGET clamps whatever the catalog hands it', () => {
    const state = freshState();
    mod.mutations.ADD_WIDGET(state, {
      pageId: 'p1',
      widget: { instanceId: 'a', widgetId: 'x', col: 11, row: 7, cols: 6, rows: 4 },
    });
    expect(isInsideGrid(state.layouts.p1[0])).toBe(true);
  });

  it('UPDATE_WIDGET clamps the MERGED result, not just the patch', () => {
    const state = freshState();
    mod.mutations.SET_LAYOUT(state, {
      pageId: 'p1',
      layout: [{ instanceId: 'a', widgetId: 'x', col: 0, row: 0, cols: 4, rows: 4 }],
    });
    // Each update looks fine alone; combined they'd run off the right edge.
    mod.mutations.UPDATE_WIDGET(state, { pageId: 'p1', instanceId: 'a', updates: { col: 10 } });
    mod.mutations.UPDATE_WIDGET(state, { pageId: 'p1', instanceId: 'a', updates: { cols: 6 } });
    const w = state.layouts.p1[0];
    expect(isInsideGrid(w)).toBe(true);
    expect(w.col + w.cols).toBeLessThanOrEqual(GRID_COLS);
  });

  it('non-geometry updates (zIndex, collapsed) still apply', () => {
    const state = freshState();
    mod.mutations.SET_LAYOUT(state, {
      pageId: 'p1',
      layout: [{ instanceId: 'a', widgetId: 'x', col: 0, row: 0, cols: 4, rows: 4, collapsed: false, zIndex: 1 }],
    });
    mod.mutations.UPDATE_WIDGET(state, { pageId: 'p1', instanceId: 'a', updates: { zIndex: 42, collapsed: true } });
    expect(state.layouts.p1[0]).toMatchObject({ zIndex: 42, collapsed: true, col: 0, cols: 4 });
  });
});

describe('WidgetFrame resize — minSize can never push a widget off-canvas', () => {
  const mountFrame = async (widget, minSize) => {
    const { registerWidget, unregisterWidget } = await import('./widgetRegistry.js');
    unregisterWidget('clamp-test');
    registerWidget('clamp-test', {
      name: 'Clamp Test',
      icon: 'fas fa-square',
      category: 'home',
      component: { template: '<div/>' },
      defaultSize: { cols: 6, rows: 4 },
      minSize,
    });
    const WidgetFrame = (await import('./WidgetFrame.vue')).default;
    return mount(WidgetFrame, {
      props: { widget, cellWidth: 100, cellHeight: 80, isCustomPage: true },
      global: { stubs: { Tooltip: { template: '<div><slot/></div>' } } },
      attachTo: document.body,
    });
  };

  it('a widget at the right edge cannot be resized past it, even with a large minSize', async () => {
    // col 10 leaves 2 columns; minSize demands 4. The old ordering
    // (max(min, min(span, bound))) returned 4 → col+cols = 14 > 12.
    const widget = { instanceId: 'a', widgetId: 'clamp-test', col: 10, row: 6, cols: 2, rows: 2, collapsed: false, visible: true, zIndex: 1 };
    const wrapper = await mountFrame(widget, { cols: 4, rows: 4 });

    await wrapper.find('.wf-resize').trigger('mousedown', { clientX: 0, clientY: 0 });
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 900, clientY: 900 }));
    document.dispatchEvent(new MouseEvent('mouseup'));

    const ev = wrapper.emitted('resize-end');
    expect(ev).toBeTruthy();
    const { cols, rows } = ev[ev.length - 1][0];
    expect(isInsideGrid({ col: widget.col, row: widget.row, cols, rows })).toBe(true);
    expect(cols).toBeLessThanOrEqual(GRID_COLS - widget.col);
    expect(rows).toBeLessThanOrEqual(GRID_ROWS - widget.row);
    wrapper.unmount();
  });

  it('a normal resize still honours minSize when there is room', async () => {
    const widget = { instanceId: 'a', widgetId: 'clamp-test', col: 0, row: 0, cols: 6, rows: 4, collapsed: false, visible: true, zIndex: 1 };
    const wrapper = await mountFrame(widget, { cols: 4, rows: 3 });

    await wrapper.find('.wf-resize').trigger('mousedown', { clientX: 500, clientY: 500 });
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 0, clientY: 0 })); // shrink hard
    document.dispatchEvent(new MouseEvent('mouseup'));

    const ev = wrapper.emitted('resize-end');
    const { cols, rows } = ev[ev.length - 1][0];
    expect(cols).toBe(4); // minSize floor respected
    expect(rows).toBe(3);
    wrapper.unmount();
  });
});


describe('custom-page render path — real WidgetFrame, 4px everywhere', () => {
  // isCustomPage: true is exactly what WidgetCanvas passes on a custom page.
  // This drives the REAL frame component and reads the inline geometry it
  // renders, so the assertion covers the same chain the page uses:
  // store layout -> WidgetCanvas -> WidgetFrame -> gridToPixel.
  const W = 1200, H = 800;

  const mountAt = async (widget) => {
    const { registerWidget } = await import('./widgetRegistry.js');
    registerWidget('cp-test', {
      name: 'CP Test', icon: 'fas fa-square', category: 'home',
      component: { template: '<div/>' },
      defaultSize: { cols: 6, rows: 4 }, minSize: { cols: 1, rows: 1 },
    });
    const WidgetFrame = (await import('./WidgetFrame.vue')).default;
    const { cellWidth, cellHeight } = calculateCellDimensions(W, H);
    return mount(WidgetFrame, {
      props: { widget, cellWidth, cellHeight, isCustomPage: true },
      global: { stubs: { Tooltip: { template: '<div><slot/></div>' } } },
    });
  };

  const box = (w) => {
    const s = w.element.style;
    return {
      left: parseFloat(s.left), top: parseFloat(s.top),
      width: parseFloat(s.width), height: parseFloat(s.height),
    };
  };

  it('a 2x2 custom-page layout is flush outside and 4px between, on every side', async () => {
    const mk = (id, col, row) => ({ instanceId: id, widgetId: 'cp-test', col, row, cols: 6, rows: 4, collapsed: false, visible: true, zIndex: 1 });
    const tl = box(await mountAt(mk('tl', 0, 0)));
    const tr = box(await mountAt(mk('tr', 6, 0)));
    const bl = box(await mountAt(mk('bl', 0, 4)));
    const br = box(await mountAt(mk('br', 6, 4)));

    // Outer edges — flush against the container
    expect(tl.left).toBeCloseTo(0, 6);
    expect(tl.top).toBeCloseTo(0, 6);
    expect(W - (tr.left + tr.width)).toBeCloseTo(0, 6);
    expect(H - (br.top + br.height)).toBeCloseTo(0, 6);
    expect(bl.left).toBeCloseTo(0, 6);
    expect(tr.top).toBeCloseTo(0, 6);

    // Between
    expect(tr.left - (tl.left + tl.width)).toBeCloseTo(GRID_GAP, 6);
    expect(br.left - (bl.left + bl.width)).toBeCloseTo(GRID_GAP, 6);
    expect(bl.top - (tl.top + tl.height)).toBeCloseTo(GRID_GAP, 6);
    expect(br.top - (tr.top + tr.height)).toBeCloseTo(GRID_GAP, 6);
  });

  it('a full-width widget spans truly edge to edge', async () => {
    const b = box(await mountAt({ instanceId: 'f', widgetId: 'cp-test', col: 0, row: 0, cols: GRID_COLS, rows: GRID_ROWS, collapsed: false, visible: true, zIndex: 1 }));
    expect(b.left).toBeCloseTo(0, 6);
    expect(W - (b.left + b.width)).toBeCloseTo(0, 6);
    expect(b.top).toBeCloseTo(0, 6);
    expect(H - (b.top + b.height)).toBeCloseTo(0, 6);
  });

  it('every column/row seam in a 12-across strip is exactly 4px', async () => {
    let prev = null;
    for (let c = 0; c < GRID_COLS; c++) {
      const b = box(await mountAt({ instanceId: 'c' + c, widgetId: 'cp-test', col: c, row: 0, cols: 1, rows: 1, collapsed: false, visible: true, zIndex: 1 }));
      if (prev) expect(b.left - (prev.left + prev.width)).toBeCloseTo(GRID_GAP, 6);
      prev = b;
    }
    // last column ends flush against the container edge
    expect(W - (prev.left + prev.width)).toBeCloseTo(0, 6);
  });
});
