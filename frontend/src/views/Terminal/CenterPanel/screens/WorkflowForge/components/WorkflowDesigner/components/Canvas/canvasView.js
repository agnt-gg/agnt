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
