/**
 * Dev-only runtime contrast auditor.
 *
 * WHY THIS EXISTS ALONGSIDE themeTokens.spec.js
 * ─────────────────────────────────────────────
 * Static analysis can only compare a foreground and a background that appear in
 * the SAME rule. The failures that actually shipped were compositional:
 *
 *   - Workspace's palette painted its panel from --color-background but styled
 *     every row with rgba(255,255,255,a). Two files, two rules, both individually
 *     defensible; the text was invisible in light mode.
 *   - `body:not(.dark) button { color: … }` is (0,2,1) and silently outranked
 *     every component's own button colour. The component's declaration was
 *     present and looked correct. It just never won.
 *
 * Neither is visible without resolving the real cascade against the real DOM.
 * This walks the rendered tree, reads getComputedStyle, climbs for the first
 * genuinely opaque ancestor background, and reports anything unreadable.
 *
 * Cost in production: zero. The whole module is behind `import.meta.env.DEV`
 * at the call site, so it is tree-shaken out of the bundle.
 *
 * Usage (already wired in main.js):
 *   auditContrast()            // audit what is on screen now
 *   auditContrast({ min: 4.5 }) // stricter than the default 3.0
 * Or from the console: `__auditContrast()`
 */

const channel = (c) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

/**
 * Browsers normalise computed `color` to rgb()/rgba(), but not every host does
 * — jsdom hands back whatever the author wrote. Scraping digits out of a hex
 * string is silently WRONG rather than merely unsupported: `#8b93a7` yields
 * [8, 93, 7], a plausible-looking near-black that would be reported as a
 * contrast failure it is not. Handle both forms explicitly.
 */
function parseRgb(str) {
  const s = String(str).trim();
  const hex = s.match(/^#([0-9a-f]{3,8})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    return {
      rgb: [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)),
      a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
    };
  }
  if (!/^rgba?\(/i.test(s)) {
    // Named colours and keywords: leave them to the caller rather than guess.
    if (s === 'transparent') return { rgb: [0, 0, 0], a: 0 };
    return null;
  }
  const m = s.match(/[\d.]+/g);
  if (!m || m.length < 3) return null;
  return { rgb: m.slice(0, 3).map(Number), a: m.length > 3 ? parseFloat(m[3]) : 1 };
}

const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

function contrast(fg, bg) {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

/** Composite a translucent colour over an opaque backdrop. */
const over = (fg, bg) => (fg.a >= 0.999 ? fg.rgb : fg.rgb.map((c, i) => c * fg.a + bg[i] * (1 - fg.a)));

/**
 * The effective backdrop behind an element: the first ancestor with a
 * meaningfully opaque background, compositing any translucent layers on the way.
 * This is the part a stylesheet parser cannot do.
 */
function effectiveBackdrop(el) {
  const stack = [];
  let node = el;
  while (node && node.nodeType === 1) {
    const cs = getComputedStyle(node);
    // A background-image (gradient, photo) is an unknown; treat it as a stop
    // and bail out rather than reporting a number we cannot justify.
    if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
    const bg = parseRgb(cs.backgroundColor);
    if (bg && bg.a > 0.001) {
      if (bg.a >= 0.999) {
        return stack.reduceRight((acc, layer) => over(layer, acc), bg.rgb);
      }
      stack.push(bg);
    }
    node = node.parentElement;
  }
  const root = parseRgb(getComputedStyle(document.body).backgroundColor);
  const base = root && root.a >= 0.999 ? root.rgb : [255, 255, 255];
  return stack.reduceRight((acc, layer) => over(layer, acc), base);
}

const hasOwnText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);

function isVisible(el, cs) {
  if (cs.visibility === 'hidden' || cs.display === 'none') return false;
  if (parseFloat(cs.opacity) < 0.15) return false;
  const r = el.getBoundingClientRect();
  return r.width > 2 && r.height > 2;
}

/** A short, clickable-ish path so the report points somewhere real. */
function describe(el) {
  const bits = [];
  let node = el;
  for (let i = 0; node && node.nodeType === 1 && i < 4; i += 1) {
    let s = node.tagName.toLowerCase();
    if (node.id) { bits.unshift(`${s}#${node.id}`); break; }
    const cls = (node.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
    if (cls.length) s += `.${cls.join('.')}`;
    bits.unshift(s);
    node = node.parentElement;
  }
  return bits.join(' > ');
}

/**
 * @param {object}  [opts]
 * @param {number}  [opts.min=3.0]   ratio below which an element is reported
 * @param {Element} [opts.root=document.body]
 * @param {boolean} [opts.quiet=false] return results without logging
 */
export function auditContrast(opts = {}) {
  const { min = 3.0, root = document.body, quiet = false } = opts;
  const findings = [];
  const seen = new Set();

  for (const el of root.querySelectorAll('*')) {
    if (!hasOwnText(el)) continue;
    const cs = getComputedStyle(el);
    if (!isVisible(el, cs)) continue;

    const fg = parseRgb(cs.color);
    if (!fg || fg.a < 0.05) continue;
    const backdrop = effectiveBackdrop(el);
    if (!backdrop) continue; // sits on an image/gradient — not ours to judge

    const ratio = contrast(over(fg, backdrop), backdrop);
    if (ratio >= min) continue;

    const key = describe(el);
    if (seen.has(key)) continue; // one report per distinct selector path
    seen.add(key);

    findings.push({
      ratio: Number(ratio.toFixed(2)),
      path: key,
      color: cs.color,
      backdrop: `rgb(${backdrop.map(Math.round).join(', ')})`,
      text: el.textContent.trim().slice(0, 48),
      element: el,
    });
  }

  findings.sort((a, b) => a.ratio - b.ratio);

  if (!quiet) {
    const theme = document.body.className || '(light)';
    if (!findings.length) {
      // eslint-disable-next-line no-console
      console.info(`[contrast] ${theme}: no text below ${min}:1 on screen.`);
    } else {
      // eslint-disable-next-line no-console
      console.groupCollapsed(`[contrast] ${theme}: ${findings.length} element(s) below ${min}:1 — click to expand`);
      // eslint-disable-next-line no-console
      console.table(findings.map(({ element, ...row }) => row));
      // eslint-disable-next-line no-console
      console.info('Fix with --text-primary/secondary/tertiary/quaternary, or --on-fill-<role> '
        + 'when the text sits on an accent fill. See styles/themes/_semantic.css.');
      // eslint-disable-next-line no-console
      console.groupEnd();
    }
  }
  return findings;
}

export default auditContrast;
