/**
 * Tooltip engine — the single implementation behind both tooltip surfaces:
 *
 *   <Tooltip text="...">   a wrapper component, for when you want a wrapper
 *   v-tooltip="'...'"      an attribute, for everywhere a wrapper would break
 *
 * Two surfaces exist because `title` is an ATTRIBUTE. A wrapper component
 * inserts a div between the element and its parent, which silently breaks
 * `.parent > el`, `el + el`, `:first-child`, percentage widths and flex/grid
 * child sizing. Real examples in this codebase: the segmented context bar
 * (`<div class="seg" :style="{width: pct+'%'}">`), the per-round strip
 * (`<button :style="{flex: ...}">`) and the volume slider. Those cannot be
 * wrapped, which is exactly why they were still using `title`.
 *
 * The engine renders the same class names the component always has
 * (.tooltip / .tooltip-content / .tooltip-title / .tooltip-text /
 * .tooltip-arrow) so styling is shared rather than duplicated.
 *
 * Only one tooltip is ever visible, matching native `title` behaviour.
 */

/** Distance from the trigger. */
const GAP_PX = 12;
/** Minimum distance from the viewport edge. */
const MARGIN_PX = 10;
/** Must match the transition duration in _tooltip.css. */
const FADE_MS = 300;
/**
 * A teleported tooltip outlives its trigger if the trigger is removed while
 * hovered (list re-render, menu close, route change) — mouseleave never fires
 * for a node that no longer exists. This sweep is the backstop.
 */
const LIVENESS_INTERVAL_MS = 500;

let tooltipEl = null;
let activeTrigger = null;
let removeTimer = null;
let livenessTimer = null;
let idCounter = 0;

/**
 * Where the tooltip goes, given the two rects and the viewport.
 *
 * Pure and exported so the geometry can be tested without a browser — jsdom
 * reports every rect as zero, so this is the only part of positioning that can
 * be verified anywhere other than a real page.
 *
 * Returns `arrowOffset`: how far the box was pushed off-centre to stay on
 * screen, so the arrow can stay pointed at the trigger.
 */
export function computeTooltipPosition({ trigger, tooltip, viewport, position = 'top', gap = GAP_PX, margin = MARGIN_PX }) {
  let top;
  let left;

  switch (position) {
    case 'bottom':
      top = trigger.bottom + gap;
      left = trigger.left + trigger.width / 2 - tooltip.width / 2;
      break;
    case 'left':
      top = trigger.top + trigger.height / 2 - tooltip.height / 2;
      left = trigger.left - tooltip.width - gap;
      break;
    case 'right':
      top = trigger.top + trigger.height / 2 - tooltip.height / 2;
      left = trigger.right + gap;
      break;
    case 'top':
    default:
      top = trigger.top - tooltip.height - gap;
      left = trigger.left + trigger.width / 2 - tooltip.width / 2;
      break;
  }

  let arrowOffset = 0;

  if (left < margin) {
    arrowOffset = left - margin;
    left = margin;
  } else if (left + tooltip.width > viewport.width - margin) {
    arrowOffset = left + tooltip.width - (viewport.width - margin);
    left = viewport.width - margin - tooltip.width;
  }

  if (top < margin) {
    top = margin;
  } else if (top + tooltip.height > viewport.height - margin) {
    top = viewport.height - margin - tooltip.height;
  }

  // Only top/bottom placements have a horizontally-sliding arrow.
  const horizontal = position === 'top' || position === 'bottom';
  return { top, left, arrowOffset: horizontal ? arrowOffset : 0 };
}

/** Trim and coerce; anything blank means "no tooltip", never an empty box. */
export function normalizeTooltipOptions(value, modifiers = {}) {
  const raw = typeof value === 'string' || typeof value === 'number' ? { text: value } : value || {};
  const text = raw.text === 0 ? '0' : String(raw.text ?? '').trim();

  const fromModifier = ['top', 'bottom', 'left', 'right'].find((p) => modifiers[p]);
  const position = raw.position || fromModifier || 'top';

  return {
    text,
    title: String(raw.title ?? '').trim(),
    position: ['top', 'bottom', 'left', 'right'].includes(position) ? position : 'top',
    width: raw.width || 'auto',
  };
}

function buildTooltipElement() {
  const el = document.createElement('div');
  el.className = 'tooltip';
  el.setAttribute('role', 'tooltip');
  el.id = `agnt-tooltip-${++idCounter}`;

  const content = document.createElement('div');
  content.className = 'tooltip-content';

  const title = document.createElement('div');
  title.className = 'tooltip-title';

  const text = document.createElement('div');
  text.className = 'tooltip-text';

  const arrow = document.createElement('div');
  arrow.className = 'tooltip-arrow';

  content.append(title, text);
  el.append(content, arrow);

  // Cached so each show is attribute writes, not queries.
  el._parts = { title, text, arrow };
  return el;
}

function stopLivenessSweep() {
  if (livenessTimer) {
    clearInterval(livenessTimer);
    livenessTimer = null;
  }
}

function startLivenessSweep() {
  stopLivenessSweep();
  livenessTimer = setInterval(() => {
    if (!activeTrigger) return stopLivenessSweep();

    // The trigger was removed from the document while its tooltip was up.
    if (!activeTrigger.isConnected) return hideTooltip(activeTrigger);

    // Pointer left without a mouseleave (element moved out from under it).
    try {
      if (!activeTrigger.matches(':hover') && activeTrigger !== document.activeElement) {
        hideTooltip(activeTrigger);
      }
    } catch {
      // jsdom and some engines reject :hover in matches(); the isConnected
      // check above is the part that actually prevents stranded tooltips.
    }
  }, LIVENESS_INTERVAL_MS);
}

/**
 * Show `options` anchored to `trigger`. Blank text is a no-op: a bordered box
 * with nothing in it is worse than no tooltip, and dynamic bindings go blank
 * all the time (`:title="item.reason"`).
 */
export function showTooltip(trigger, options) {
  const { text, title, position, width } = normalizeTooltipOptions(options);
  if (!trigger || !text) {
    hideTooltip(trigger);
    return null;
  }

  clearTimeout(removeTimer);
  removeTimer = null;

  if (!tooltipEl) tooltipEl = buildTooltipElement();
  const { title: titleEl, text: textEl, arrow } = tooltipEl._parts;

  // textContent, never innerHTML: these strings carry file names, publisher
  // names and error text straight from the network. `title` was inert by
  // definition and the replacement has to stay inert.
  textEl.textContent = text;
  titleEl.textContent = title;
  titleEl.style.display = title ? '' : 'none';

  tooltipEl.className = `tooltip ${position}`;
  tooltipEl.style.width = width;
  tooltipEl.style.opacity = '0';
  arrow.style.left = '';

  if (!tooltipEl.isConnected) document.body.appendChild(tooltipEl);

  activeTrigger = trigger;
  // Announce the description while it is visible; the tooltip itself is
  // aria-hidden from the tree by virtue of being referenced here.
  trigger.setAttribute('aria-describedby', tooltipEl.id);

  const triggerRect = trigger.getBoundingClientRect();
  const tooltipRect = tooltipEl.getBoundingClientRect();
  const { top, left, arrowOffset } = computeTooltipPosition({
    trigger: triggerRect,
    tooltip: tooltipRect,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    position,
  });

  tooltipEl.style.top = `${top}px`;
  tooltipEl.style.left = `${left}px`;
  if (arrowOffset !== 0) arrow.style.left = `calc(50% + ${arrowOffset}px)`;

  // Next frame so the browser has a 0-opacity paint to transition from.
  requestAnimationFrame(() => {
    if (activeTrigger === trigger && tooltipEl) tooltipEl.style.opacity = '1';
  });

  startLivenessSweep();
  return tooltipEl;
}

/**
 * Hide the tooltip if `trigger` owns it. Passing nothing hides unconditionally.
 */
export function hideTooltip(trigger) {
  if (trigger && activeTrigger && trigger !== activeTrigger) return;

  if (activeTrigger) activeTrigger.removeAttribute('aria-describedby');
  activeTrigger = null;
  stopLivenessSweep();

  if (!tooltipEl) return;
  tooltipEl.style.opacity = '0';

  clearTimeout(removeTimer);
  removeTimer = setTimeout(() => {
    // A new tooltip may have opened during the fade.
    if (!activeTrigger && tooltipEl?.isConnected) tooltipEl.remove();
    removeTimer = null;
  }, FADE_MS);
}

/** Whether `trigger` (or anything) currently owns the tooltip. */
export function isTooltipVisible(trigger) {
  return trigger ? activeTrigger === trigger : activeTrigger !== null;
}

/** Test-only reset so module state cannot leak between cases. */
export function __resetTooltipEngine() {
  clearTimeout(removeTimer);
  stopLivenessSweep();
  removeTimer = null;
  activeTrigger = null;
  tooltipEl?.remove();
  tooltipEl = null;
}

// A tooltip is anchored in viewport coordinates, so any scroll invalidates it
// instantly. Capture phase catches scrolls in nested containers too.
if (typeof window !== 'undefined') {
  window.addEventListener('scroll', () => hideTooltip(), { capture: true, passive: true });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hideTooltip();
  });
}
