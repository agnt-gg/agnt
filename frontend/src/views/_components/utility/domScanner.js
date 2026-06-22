// Walks the live DOM and returns a list of interactive elements the AI
// can point at via highlight_element / start_guided_tour. Each entry has
// a unique CSS selector resolvable with document.querySelector.

const INTERACTIVE_SELECTOR = [
  'button',
  'a[href]',
  '[role="button"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="link"]',
  '[role="option"]',
  '[role="checkbox"]',
  '[role="switch"]',
  '[data-tour-id]',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  '[contenteditable="true"]',
].join(', ');

const MAX_RESULTS = 200;

function isVisible(el) {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  // Only flag fully off-screen as hidden; partials count as visible.
  if (rect.right < 0 || rect.bottom < 0) return false;
  if (rect.left > window.innerWidth || rect.top > window.innerHeight) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  return true;
}

function readableText(el) {
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') {
    return (
      el.getAttribute('aria-label') ||
      el.placeholder ||
      el.value ||
      el.name ||
      ''
    );
  }
  if (tag === 'SELECT') {
    const opt = el.options?.[el.selectedIndex];
    return opt?.text || el.getAttribute('aria-label') || el.name || '';
  }
  return (
    el.innerText ||
    el.getAttribute('aria-label') ||
    el.title ||
    el.getAttribute('alt') ||
    ''
  );
}

// Build a stable, unique CSS selector for `el`. Prefers id, data-tour-id,
// then data-testid, then a structural :nth-of-type path. Verifies the
// final selector uniquely matches `el`.
export function buildSelector(el) {
  if (!el || el.nodeType !== 1) return null;

  if (el.dataset?.tourId) {
    const sel = `[data-tour-id="${el.dataset.tourId}"]`;
    if (document.querySelectorAll(sel).length === 1) return sel;
  }
  if (el.dataset?.testid) {
    const sel = `[data-testid="${el.dataset.testid}"]`;
    if (document.querySelectorAll(sel).length === 1) return sel;
  }
  if (el.id && /^[a-zA-Z][\w-]*$/.test(el.id)) {
    const sel = `#${el.id}`;
    try {
      if (document.querySelectorAll(sel).length === 1) return sel;
    } catch { /* invalid id */ }
  }

  const parts = [];
  let node = el;
  let depth = 0;
  while (node && node.nodeType === 1 && node !== document.body && depth < 6) {
    let part = node.tagName.toLowerCase();
    const parent = node.parentElement;
    if (parent) {
      const sameTag = [...parent.children].filter((c) => c.tagName === node.tagName);
      if (sameTag.length > 1) {
        part += `:nth-of-type(${sameTag.indexOf(node) + 1})`;
      }
    }
    parts.unshift(part);
    if (node.id && /^[a-zA-Z][\w-]*$/.test(node.id)) {
      parts[0] = `#${node.id}`;
      break;
    }
    node = parent;
    depth++;
  }
  const selector = parts.join(' > ');
  try {
    if (selector && document.querySelectorAll(selector).length === 1) return selector;
  } catch { /* ignore */ }
  return null;
}

export function scanInteractiveElements({ filter } = {}) {
  const filterLower = (filter || '').toLowerCase();
  const candidates = document.querySelectorAll(INTERACTIVE_SELECTOR);
  const seen = new Set();
  const results = [];

  for (const el of candidates) {
    if (!isVisible(el)) continue;
    const text = readableText(el).trim().replace(/\s+/g, ' ').slice(0, 120);
    if (!text && !el.dataset?.tourId) continue;
    if (filterLower && !text.toLowerCase().includes(filterLower)) continue;

    const selector = buildSelector(el);
    if (!selector || seen.has(selector)) continue;
    seen.add(selector);

    const rect = el.getBoundingClientRect();
    results.push({
      text,
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role') || null,
      tourId: el.dataset?.tourId || null,
      selector,
      bbox: {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      },
    });

    if (results.length >= MAX_RESULTS) break;
  }

  // Sort top-to-bottom, left-to-right so the LLM gets a reading-order list.
  results.sort((a, b) => {
    const dy = a.bbox.y - b.bbox.y;
    if (Math.abs(dy) > 8) return dy;
    return a.bbox.x - b.bbox.x;
  });

  return results;
}
