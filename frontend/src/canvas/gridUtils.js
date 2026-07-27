/**
 * Grid math utilities for the widget canvas system.
 * 12-column snap grid with configurable rows.
 */

export const GRID_COLS = 12;
export const GRID_ROWS = 8;
export const GRID_GAP = 4;

/**
 * Calculate cell dimensions from container size.
 */
export function calculateCellDimensions(containerWidth, containerHeight, cols = GRID_COLS, rows = GRID_ROWS) {
  // (W + GAP) / cols, NOT (W - GAP) / cols.
  //
  // GRID_GAP is a gutter BETWEEN widgets, not an outer inset. Each cell is
  // sized so that subtracting one gap from a widget's span leaves the gutter
  // on its trailing edge only — so the first widget starts flush at 0 and the
  // last one ends flush at the container edge, while neighbours stay GAP apart.
  return {
    cellWidth: (containerWidth + GRID_GAP) / cols,
    cellHeight: (containerHeight + GRID_GAP) / rows,
  };
}

/**
 * Convert grid position to pixel coordinates.
 */
export function gridToPixel(col, row, cols, rows, cellWidth, cellHeight) {
  // No +GRID_GAP on x/y: the origin is the container edge. The trailing
  // -GRID_GAP on the size is what creates the gutter, and it is the ONLY
  // place a gap is introduced.
  //   col 0,  12 cols  ->  x 0,               width 12cw - GAP = W        (full bleed)
  //   col 0,   6 cols  ->  x 0,               width  6cw - GAP
  //   col 6,   6 cols  ->  x 6cw,             gap between = GAP exactly
  return {
    x: col * cellWidth,
    y: row * cellHeight,
    width: cols * cellWidth - GRID_GAP,
    height: rows * cellHeight - GRID_GAP,
  };
}

/**
 * Snap a pixel position to the nearest grid cell.
 */
export function snapToGrid(x, y, cellWidth, cellHeight) {
  // Mirror of gridToPixel's origin — no GAP to remove any more.
  return {
    col: Math.round(x / cellWidth),
    row: Math.round(y / cellHeight),
  };
}

/**
 * Snap a pixel size to the nearest grid span.
 */
export function snapSizeToGrid(width, height, cellWidth, cellHeight) {
  // Use floor + 0.3 threshold so shrinking feels responsive (don't require dragging past halfway)
  return {
    cols: Math.max(1, Math.floor((width + GRID_GAP) / cellWidth + 0.3)),
    rows: Math.max(1, Math.floor((height + GRID_GAP) / cellHeight + 0.3)),
  };
}

/**
 * Clamp grid position so widget stays within bounds.
 */
export function clampToGrid(col, row, cols, rows, gridCols = GRID_COLS, gridRows = GRID_ROWS) {
  return {
    col: Math.max(0, Math.min(col, gridCols - cols)),
    row: Math.max(0, Math.min(row, gridRows - rows)),
  };
}

/**
 * Force a widget instance inside the grid. THE canonical clamp — every
 * surface that stores widget geometry (custom pages via the widgetLayout
 * store, the workspace canvas via useWorkspaces) funnels through this.
 *
 * Geometry outside the grid renders a window partly or wholly past the canvas
 * edge, where it can no longer be grabbed or resized back. It gets there
 * legitimately: layouts persisted before any clamp existed, template/default
 * layouts authored against a different grid, a gesture computed from a stale
 * cell width, or a minSize larger than the span remaining at the widget's
 * column. Clamping only DURING a drag never repairs a bad value at rest, so
 * this is applied on load AND on every write: a bad value can neither enter
 * nor survive.
 *
 * Invariant: 0 <= col, col + cols <= gridCols (same for row/rows), which is
 * exactly what makes the rendered gaps uniformly GRID_GAP on all four edges.
 */
export function clampInstance(w, options = {}) {
  // Bounds are an OPTIONS OBJECT, not positional numbers, specifically so that
  // `array.map(clampInstance)` is safe: map passes (element, INDEX, array), and
  // with positional params the index silently became the grid width (index 2
  // → a 2-column grid, quietly shrinking every widget). A number can never be
  // mistaken for options, so the mistake is now structurally impossible.
  const opts = options && typeof options === 'object' ? options : {};
  const { gridCols = GRID_COLS, gridRows = GRID_ROWS } = opts;
  const gc = Number.isFinite(gridCols) && gridCols >= 1 ? Math.floor(gridCols) : GRID_COLS;
  const gr = Number.isFinite(gridRows) && gridRows >= 1 ? Math.floor(gridRows) : GRID_ROWS;

  const cols = Math.max(1, Math.min(Math.round(Number(w?.cols)) || 1, gc));
  const rows = Math.max(1, Math.min(Math.round(Number(w?.rows)) || 1, gr));
  const col = Math.max(0, Math.min(Math.round(Number(w?.col)) || 0, gc - cols));
  const row = Math.max(0, Math.min(Math.round(Number(w?.row)) || 0, gr - rows));
  return { ...w, col, row, cols, rows };
}

/** True when an instance already satisfies the grid invariant. */
export function isInsideGrid(w, gridCols = GRID_COLS, gridRows = GRID_ROWS) {
  return (
    Number.isFinite(w?.col) && Number.isFinite(w?.row) &&
    Number.isFinite(w?.cols) && Number.isFinite(w?.rows) &&
    w.col >= 0 && w.row >= 0 && w.cols >= 1 && w.rows >= 1 &&
    w.col + w.cols <= gridCols && w.row + w.rows <= gridRows
  );
}

/**
 * Find the first empty slot on the grid that fits a widget of the given size.
 * Returns { col, row } or null if no space found.
 */
export function findEmptySlot(existingWidgets, spanCols, spanRows, gridCols = GRID_COLS, gridRows = GRID_ROWS) {
  // Build occupancy grid
  const occupied = Array.from({ length: gridRows }, () => new Uint8Array(gridCols));

  for (const w of existingWidgets) {
    if (!w.visible) continue;
    for (let r = w.row; r < Math.min(w.row + w.rows, gridRows); r++) {
      for (let c = w.col; c < Math.min(w.col + w.cols, gridCols); c++) {
        occupied[r][c] = 1;
      }
    }
  }

  // Scan for first fit
  for (let r = 0; r <= gridRows - spanRows; r++) {
    for (let c = 0; c <= gridCols - spanCols; c++) {
      let fits = true;
      for (let dr = 0; dr < spanRows && fits; dr++) {
        for (let dc = 0; dc < spanCols && fits; dc++) {
          if (occupied[r + dr][c + dc]) fits = false;
        }
      }
      if (fits) return { col: c, row: r };
    }
  }

  // Fallback: the canvas is too full for a clean fit, so allow overlap — but
  // only over a SMALLER probe area. The scan bounds MUST stay derived from
  // the caller's real span, not the probe size: the widget keeps spanCols x
  // spanRows, so a slot found at the far edge for a 1x1 probe would place a
  // 6-wide widget at col 11 and render it 5 columns off-canvas. (That was the
  // bug — the loops below previously bounded by fc/fr.)
  const maxCol = Math.max(0, gridCols - spanCols);
  const maxRow = Math.max(0, gridRows - spanRows);
  for (const [fc, fr] of [[2, 1], [1, 1]]) {
    if (fc >= spanCols && fr >= spanRows) continue;
    for (let r = 0; r <= maxRow; r++) {
      for (let c = 0; c <= maxCol; c++) {
        let fits = true;
        for (let dr = 0; dr < fr && fits; dr++) {
          for (let dc = 0; dc < fc && fits; dc++) {
            if (occupied[r + dr][c + dc]) fits = false;
          }
        }
        if (fits) return { col: c, row: r };
      }
    }
  }

  // Last resort: overlap at origin (always in bounds).
  return { col: 0, row: 0 };
}

/**
 * Generate a unique instance ID.
 */
export function generateInstanceId() {
  return 'w_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
