/**
 * The pan/zoom that puts a graph in the middle of the canvas viewport.
 *
 * #canvas is transformed with `translate(ox, oy) scale(z)` about its default
 * transform-origin, its own centre (cx, cy), which is also the viewport centre
 * because #canvas fills its container. A canvas point p therefore lands on
 * screen at  c + o + z·(p − c).  Centring the graph's bounding-box middle m on
 * c gives  o = z·(c − m).
 *
 * @param {Array<{x:number,y:number,width:number,height:number}>} boxes node rectangles in canvas space
 * @param {{width:number,height:number}} viewport the visible canvas size in px
 * @param {{zoom?:number, fit?:boolean, minZoom?:number, maxZoom?:number, padding?:number, readableZoom?:number}} options
 *   zoom: the zoom to keep when the graph fits at it (a workflow's saved zoom).
 *   fit:  zoom to fill the viewport instead (still capped at maxZoom).
 *   readableZoom: the smallest zoom at which node labels can be read. When a
 *     graph only fits below it (a wide graph on a phone), shrinking it to fit
 *     makes every label unreadable, so instead keep this zoom and show the
 *     graph's start, top-left, where the flow begins. Ignored when `fit`.
 * @returns {{zoom:number, offsetX:number, offsetY:number} | null} null when there is nothing to centre on
 */
/**
 * The dot grid for the current pan/zoom, painted on the viewport itself.
 *
 * The dots used to be a background on a 300%-sized layer INSIDE the
 * transformed canvas. A finite layer that scales with zoom has edges: at the
 * 0.2 zoom floor it covered 60% of the viewport, and any long pan walked off
 * it. Painting on the untransformed viewport and moving the pattern instead is
 * infinite by construction.
 *
 * Dots sit on canvas points that are multiples of `base` (the 16px node snap
 * grid), using the same mapping as centeredView: canvas point p lands on
 * screen at c + o + z·(p − c). When they would crowd closer than
 * `minSpacing` screen pixels, the step doubles (16 → 32 → 64 … canvas px),
 * so zooming out never turns the grid into a grey wash.
 *
 * @returns {{ spacing:number, dot:number, x:number, y:number }} screen px:
 *   tile size, dot radius, and the background-position that puts a dot
 *   centre on every grid point.
 */
export function gridLayout({ width, height, offsetX = 0, offsetY = 0, zoom = 1, base = 16, minSpacing = 12 }) {
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  let step = base;
  while (step * z < minSpacing) step *= 2;
  const spacing = step * z;
  const mod = (n) => ((n % spacing) + spacing) % spacing;
  // Screen position of canvas point 0, then back half a tile: a radial
  // gradient's dot sits at the centre of its tile.
  const originX = (width / 2) * (1 - z) + offsetX;
  const originY = (height / 2) * (1 - z) + offsetY;
  return {
    spacing,
    // As before at 1x (1px, scaling up to 2px), but never below 1px when
    // zoomed out, where a sub-pixel dot simply vanished.
    dot: Math.max(1, Math.min(2, z)),
    x: mod(originX - spacing / 2),
    y: mod(originY - spacing / 2),
  };
}

export function centeredView(boxes, viewport, { zoom = 1, fit = false, minZoom = 0.2, maxZoom = 1, padding = 48, readableZoom = 0 } = {}) {
  if (!boxes?.length || !(viewport?.width > 0) || !(viewport?.height > 0)) return null;
  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxX = Math.max(...boxes.map((b) => b.x + b.width));
  const maxY = Math.max(...boxes.map((b) => b.y + b.height));
  const graphWidth = Math.max(1, maxX - minX);
  const graphHeight = Math.max(1, maxY - minY);

  const zoomToFit = Math.min((viewport.width - 2 * padding) / graphWidth, (viewport.height - 2 * padding) / graphHeight);
  // A saved zoom is kept unless the graph would not fit at it; fit mode always fills.
  const wanted = fit ? zoomToFit : Math.min(zoom, zoomToFit);
  const clamped = Math.max(minZoom, Math.min(maxZoom, wanted));

  const centreX = viewport.width / 2;
  const centreY = viewport.height / 2;
  if (!fit && readableZoom > 0 && clamped < readableZoom) {
    // Screen position of canvas point p is c + o + z·(p − c); put (minX, minY) at the padding.
    const readable = Math.min(maxZoom, readableZoom);
    const inset = Math.min(padding, 24);
    return {
      zoom: readable,
      offsetX: inset - centreX - readable * (minX - centreX),
      offsetY: inset - centreY - readable * (minY - centreY),
    };
  }
  return {
    zoom: clamped,
    offsetX: clamped * (centreX - (minX + maxX) / 2),
    offsetY: clamped * (centreY - (minY + maxY) / 2),
  };
}
