/**
 * Where a pointer event lands ON THE PAGE the canvas is showing.
 *
 * WHY THIS IS NOT JUST A RATIO
 * ----------------------------
 * The stream canvas is sized to its container by CSS but keeps the frame's
 * aspect ratio through object-fit: contain — so unless the two happen to
 * match, the page is painted into a LETTERBOXED sub-rectangle with empty bars
 * around it. Scaling by rect.width / canvas.width assumes the paint fills the
 * element, and every click lands offset by half a bar.
 *
 * The narrow card hid this: at 320px tall and roughly 500 wide it was already
 * close to the frame's 1.6:1, so the bars were a few pixels and clicks landed
 * near enough to look right. Widening the card to the full message width makes
 * the bars hundreds of pixels wide, which turns a subtle inaccuracy into
 * clicking the wrong thing entirely.
 *
 * Returns null for a point on the bars: that is not part of the page, and
 * forwarding it would click whatever happens to sit at the clamped edge.
 */
export function viewportToPage({
  clientX, clientY, rect, frameWidth, frameHeight,
}) {
  if (!rect || !frameWidth || !frameHeight) return null;
  if (!rect.width || !rect.height) return null;

  // object-fit: contain — the single scale that fits BOTH axes.
  const scale = Math.min(rect.width / frameWidth, rect.height / frameHeight);
  if (!Number.isFinite(scale) || scale <= 0) return null;

  const paintedWidth = frameWidth * scale;
  const paintedHeight = frameHeight * scale;

  // The paint is centred, so each bar is half the leftover.
  const originX = rect.left + (rect.width - paintedWidth) / 2;
  const originY = rect.top + (rect.height - paintedHeight) / 2;

  const x = (clientX - originX) / scale;
  const y = (clientY - originY) / scale;

  // A tiny tolerance, because a click exactly on the last pixel row is a click
  // on the page as far as the person doing it is concerned.
  const EDGE_TOLERANCE = 1;
  if (x < -EDGE_TOLERANCE || y < -EDGE_TOLERANCE) return null;
  if (x > frameWidth + EDGE_TOLERANCE || y > frameHeight + EDGE_TOLERANCE) return null;

  return {
    x: Math.round(Math.min(Math.max(x, 0), frameWidth)),
    y: Math.round(Math.min(Math.max(y, 0), frameHeight)),
  };
}
