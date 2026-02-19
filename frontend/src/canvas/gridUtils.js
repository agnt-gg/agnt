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
  return {
    cellWidth: (containerWidth - GRID_GAP) / cols,
    cellHeight: (containerHeight - GRID_GAP) / rows,
  };
}

/**
 * Convert grid position to pixel coordinates.
 */
export function gridToPixel(col, row, cols, rows, cellWidth, cellHeight) {
  return {
    x: col * cellWidth + GRID_GAP,
    y: row * cellHeight + GRID_GAP,
    width: cols * cellWidth - GRID_GAP,
    height: rows * cellHeight - GRID_GAP,
  };
}

/**
 * Snap a pixel position to the nearest grid cell.
 */
export function snapToGrid(x, y, cellWidth, cellHeight) {
  return {
    col: Math.round((x - GRID_GAP) / cellWidth),
    row: Math.round((y - GRID_GAP) / cellHeight),
  };
}

/**
 * Snap a pixel size to the nearest grid span.
 */
export function snapSizeToGrid(width, height, cellWidth, cellHeight) {
  return {
    cols: Math.max(1, Math.round((width + GRID_GAP) / cellWidth)),
    rows: Math.max(1, Math.round((height + GRID_GAP) / cellHeight)),
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

  // Fallback: try smaller sizes
  for (const [fc, fr] of [[2, 1], [1, 1]]) {
    if (fc >= spanCols && fr >= spanRows) continue;
    for (let r = 0; r <= gridRows - fr; r++) {
      for (let c = 0; c <= gridCols - fc; c++) {
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

  // Last resort: overlap at origin
  return { col: 0, row: 0 };
}

/**
 * Generate a unique instance ID.
 */
export function generateInstanceId() {
  return 'w_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
