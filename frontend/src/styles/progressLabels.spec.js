/**
 * Guard: text sitting ON a progress bar uses invariant ink.
 *
 * WHY (2026-08-02)
 * ────────────────
 * A progress label is drawn over a saturated FILL. That fill is the same colour
 * in both themes, so the label must be too. Using `--text-primary` puts dark ink
 * on a dark fill in light mode — the label disappears exactly when the bar is
 * full.
 *
 * ─── WHY THIS IS STRUCTURAL AND NOT A LIST OF CLASS NAMES ──────────────────
 * This was fixed twice by hunting for class names — `progress-text`,
 * `progress-value`, `progress-label`. The first pass found 13 candidates and
 * changed 4. The second, with a real depth-tracked walk, found 29 and 11 on the
 * bar. The seven it had missed were not obscure: six of them were one rule,
 * `.bar-label`, driving every bar in the AGNT score breakdown. They were missed
 * purely because nobody had guessed that name.
 *
 * A name list can only ever encode the cases someone already thought of. The
 * real invariant is positional, so this derives it from the template:
 *
 *   NESTED   the label is a descendant of an element whose class contains the
 *            word `fill` -> it is always on the fill
 *   OVERLAID the label is positioned absolutely inside the bar container ->
 *            it crosses fill and track depending on percentage
 *
 * Either way the ink cannot follow the theme. A new component called
 * `.completion-readout` is caught on the day it is written.
 *
 * ─── WHAT COUNTS AS CORRECT ────────────────────────────────────────────────
 *   --text-on-scrim / --on-fill-*   declared invariant in _semantic.css
 *   --scrim as a background         the label brings its own backdrop, which is
 *                                   what the OVERLAID case needs: a shadow
 *                                   alone leaves white-on-near-white at 5%
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!/node_modules|dist|\.git/.test(e.name)) walk(p, out); }
    else if (/\.vue$/.test(e.name)) out.push(p);
  }
  return out;
}

const RE_ESCAPE = /[.*+?^$()|[\]\\{}]/g;
const escapeRe = (s) => s.replace(RE_ESCAPE, '\\$&');

/**
 * `fill` / `filled` as a whole hyphen-separated segment.
 * An earlier version of this matcher also accepted `inner`, which caught
 * .card-inner, .option-inner, .inner-wrapper and 30 other ordinary containers
 * and buried the three real hits. A word that appears in unrelated layout names
 * is not a signal.
 */
const FILL_WORDS = new Set(['fill', 'filled']);
const isFill = (cls) => cls.split(/\s+/).some((c) => c.split('-').some((s) => FILL_WORDS.has(s)));
/** A bar TRACK: the container a label may be absolutely positioned inside. */
const isBar = (cls) => /(^|[\s-])(bar|meter|gauge)([\s-]|$)/.test(cls) && !isFill(cls);

/** Ink that does not follow the theme. */
const INVARIANT = /--text-on-scrim|--on-fill-|--scrim\b/;

const EXEMPT = /__old-|MobileLite|Minigames|\.spec\./;

function parse(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const tplEnd = raw.search(/<script/i);
  const tpl = raw.slice(0, tplEnd === -1 ? raw.length : tplEnd);
  /* CSS comments must go before matching declarations: a `color:` preceded by
     an explanatory block comment otherwise reads as absent, which made three
     already-correct rules look unfixed. */
  const style = [...raw.replace(/<script[\s\S]*?<\/script>/gi, (m) => m.replace(/[^\n]/g, ' '))
    .matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, ' ');
  return { tpl, style };
}

const ruleBody = (style, cls) => {
  const m = style.match(new RegExp('\\.' + escapeRe(cls) + '\\s*\\{([^}]*)\\}'));
  return m ? m[1].replace(/\s+/g, ' ').trim() : null;
};

/** Every element carrying rendered text that sits on a bar. */
function labelsOnBars(file) {
  const { tpl, style } = parse(file);
  const out = [];
  const tokens = [...tpl.matchAll(/<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|([^<]+)/g)];
  const stack = [];

  for (const t of tokens) {
    const [, closing, tag, attrs, selfClose, text] = t;

    if (text !== undefined) {
      const meaningful = text.replace(/\s+/g, ' ').trim();
      if (!meaningful || meaningful.startsWith('!--') || meaningful.startsWith('--')) continue;
      const holder = stack[stack.length - 1];
      if (!holder || !holder.cls) continue;
      const cls = holder.cls.split(/\s+/)[0];
      const body = ruleBody(style, cls);
      if (body === null) continue; // no rule of its own; inherits, judged elsewhere

      const nested = stack.some((s) => isFill(s.cls));
      const overlaid = /position\s*:\s*absolute/.test(body) && stack.some((s) => isBar(s.cls));
      if (!nested && !overlaid) continue;

      out.push({
        cls,
        shape: nested ? 'nested in the fill' : 'absolute over the bar',
        color: (body.match(/(?:^|;)\s*color\s*:\s*([^;]+)/) || [])[1]?.trim() || '(none)',
        background: (body.match(/(?:^|;)\s*background(?:-color)?\s*:\s*([^;]+)/) || [])[1]?.trim() || '',
        line: tpl.slice(0, t.index).split('\n').length,
      });
      continue;
    }
    if (closing) { stack.pop(); continue; }
    const cls = (attrs.match(/\bclass="([^"]*)"/) || [])[1] || '';
    if (!selfClose && !/^(br|hr|img|input|meta|link|source)$/i.test(tag)) stack.push({ tag, cls });
  }
  return out;
}

const FILES = walk(SRC).filter((f) => !EXEMPT.test(path.relative(SRC, f).replace(/\\/g, '/')));

describe('progress labels: text on a bar does not follow the theme', () => {
  const all = [];
  for (const f of FILES) {
    for (const l of labelsOnBars(f)) {
      all.push({ ...l, file: path.relative(SRC, f).replace(/\\/g, '/') });
    }
  }
  // one row per distinct rule
  const rules = [...new Map(all.map((r) => [`${r.file}|${r.cls}`, r])).values()];

  it('finds the progress labels it claims to check (anti-vacuity)', () => {
    // 11 known on-bar labels across 6 components at the time of writing.
    expect(rules.length).toBeGreaterThanOrEqual(5);
    expect(rules.some((r) => r.shape === 'nested in the fill')).toBe(true);
    expect(rules.some((r) => r.shape === 'absolute over the bar')).toBe(true);
  });

  it('every label on a bar uses invariant ink', () => {
    const bad = rules
      .filter((r) => !INVARIANT.test(r.color))
      .map((r) => `${r.file}:${r.line}  .${r.cls}  (${r.shape})  color: ${r.color}`);
    expect(
      bad.join('\n') || 'clean',
      'A progress label sits on a saturated fill but takes a themed text colour.\n'
      + 'The fill is the same in both themes, so the ink must be too: in light mode\n'
      + '--text-primary is dark ink and the label vanishes as the bar fills.\n'
      + 'Use --text-on-scrim (or --on-fill-<role>), and give an absolutely\n'
      + 'positioned label `background: var(--scrim)` so it reads at 5% as well as\n'
      + 'at 95%.\n'
    ).toBe('clean');
  });

  it('a label overlaid across the whole bar brings its own backdrop', () => {
    /**
     * Light ink alone is not enough for the OVERLAID shape. At a low
     * percentage the label sits on the pale track, where only a text-shadow
     * would rescue it -- and a shadow doing load-bearing work reads as a
     * rendering artefact. Its own scrim gives identical contrast at 1% and 99%.
     */
    const bad = rules
      .filter((r) => r.shape === 'absolute over the bar' && !/--scrim\b/.test(r.background))
      .map((r) => `${r.file}:${r.line}  .${r.cls}  background: ${r.background || '(none)'}`);
    expect(
      bad.join('\n') || 'clean',
      'A label positioned over the whole bar has no backdrop of its own. Which\n'
      + 'surface it lands on depends on the percentage, so add\n'
      + '`background: var(--scrim)` rather than relying on a text-shadow.\n'
    ).toBe('clean');
  });
});
