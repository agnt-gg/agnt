/**
 * SURFACE + INK CONVENTIONS — what every component may paint with.
 *
 * WHY THIS FILE EXISTS
 * Light mode kept regressing because new screens reached for a colour instead
 * of a role. Each of these looks right in dark and breaks in light:
 *
 *   color: var(--color-green)          neon #19ef83 on white = 1.4:1
 *   color: var(--color-ultra-light-navy)  #f5f5fa on white = 1.09:1 (goal title)
 *   color: var(--color-dark-navy)      WHITE in light, so white-on-neon on fills
 *   background: rgba(255,255,255,.03)  a raised tile in dark, invisible in light
 *   background: color-mix(...) / #hex  a private palette no theme can reach
 *
 * THE RULES
 *   text in a hue        -> var(--text-green|blue|info|yellow|orange)
 *   text on an accent    -> var(--text-on-fill) / var(--on-fill-<role>)
 *   plain text           -> var(--text-primary … --text-quaternary)
 *   card / section / well-> var(--color-darker-0..3)   (house convention)
 *   hover / pressed      -> var(--surface-hover) / var(--surface-active)
 *   hue tint             -> rgba(var(--<hue>-rgb), a)
 *
 * The ink rules are absolute (zero offenders). The background rule is a
 * RATCHET: legacy files are frozen at their current count in
 * surfaceConventions.baseline.json and may only go down; any file not in the
 * baseline — i.e. every new file — must have zero. Lower a count when you fix
 * one; the stale-baseline test makes you.
 *
 * Runs before every commit that touches frontend styles (.githooks/pre-commit).
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..');
const BASELINE_PATH = path.join(HERE, 'surfaceConventions.baseline.json');
const SKIP = /styles\/themes\/|base\/js\/libs|main copy\.css|\.min\./;

// A rule scoped to dark themes only, or one whose own background is dark in
// LIGHT mode (an inverted bubble, a code block), legitimately keeps light ink.
const DARK_ONLY_SEL = /body\.dark|:global\(\.dark|\.dark\s|cyberpunk|hacker|midnight|\bnord\b|\bember\b|hljs/i;
const DARK_IN_LIGHT_BG = /background(?:-color)?\s*:\s*(?:var\(--(?:text-primary|text-secondary|color-dull-white|color-text|color-light-med-navy|scrim|color-darker-3)\)|#(?:[0-3][0-9a-f]){3}\b|#[0-3][0-9a-f]{2}\b|rgba?\(\s*[0-6]?\d\s*,\s*[0-6]?\d\s*,\s*[0-6]?\d\s*(?:,\s*(?:0?\.[5-9]|1)\d*\s*)?\))/i;

const HUE_AS_TEXT = /^var\(--(?:color-(?:green|blue|yellow|orange|secondary|success|warning|cyan|green-light|green-dark|blue-dark|yellow-dark)|green|cyan|gold)\)$/;
const PALE_AS_TEXT = /^var\(--color-(?:ultra-light|bright-light|light|dull|duller)-navy\)$/;
const CANVAS_AS_INK = /^var\(--(?:color-(?:dark|ultra-dark|black)-navy|color-navy|terminal-bg|color-background|surface-canvas)\)$/;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(vue|css)$/.test(e.name)) out.push(p);
  }
  return out;
}
const rel = (f) => path.relative(SRC, f).replace(/\\/g, '/');
const styleOf = (file) => {
  const raw = fs.readFileSync(file, 'utf8');
  const css = file.endsWith('.vue') ? [...raw.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n') : raw;
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
};
const rulesOf = (css) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim().split('\n').pop().trim(), body: m[2] }))
  .filter((r) => !r.sel.startsWith('@'));

/** Ink offenders in one stylesheet. Exported shape kept simple for the negative control. */
export function inkOffenders(css, file = '<inline>') {
  const out = [];
  for (const { sel, body } of rulesOf(css)) {
    if (DARK_ONLY_SEL.test(sel) || DARK_IN_LIGHT_BG.test(body)) continue;
    for (const m of body.matchAll(/(?:^|[;{\s])color\s*:\s*([^;}]+)/g)) {
      // A fallback does not change what the token resolves to: var(--color-yellow, #ffd700) is still neon.
      const value = m[1].replace(/!important/, '').trim().replace(/^var\(\s*(--[\w-]+)\s*,[\s\S]*\)$/, 'var($1)');
      const kind = HUE_AS_TEXT.test(value) ? 'hue-as-text -> var(--text-<hue>)'
        : PALE_AS_TEXT.test(value) ? 'pale-palette-as-text -> var(--text-primary..quaternary)'
          : CANVAS_AS_INK.test(value) ? 'canvas-as-ink -> var(--text-on-fill)' : null;
      if (kind) out.push(`${file}  ${sel.slice(0, 70)}  {color: ${value}}  ${kind}`);
    }
  }
  return out;
}

// Cards and sections take --color-darker-N. An OPAQUE surface on one is how a
// page ends up as white cards on a white canvas (AppsSection, 2026-10-05).
const CARDISH = /(card|tile|item|section|row|shelf|setup|contents|stat)\b/i;
const FLOATING = /menu|dropdown|popover|popup|modal|dialog|flyout|toast|tooltip|sheet|float|sticky|header|toolbar|overlay/i;
const OPAQUE_SURFACE = /^var\(--(?:surface-raised|surface-canvas|color-(?:navy|dark-navy|ultra-dark-navy|black-navy))\)$/;
const subjectOf = (sel) => sel.split(',').map((s) => s.trim().split(/[\s>+~]+/).pop()).join(',');

/** Background values outside the token system. */
export function offConventionBackgrounds(css) {
  let count = 0;
  for (const { sel, body } of rulesOf(css)) {
    const cardish = CARDISH.test(subjectOf(sel)) && !FLOATING.test(subjectOf(sel)) && !DARK_ONLY_SEL.test(sel);
    for (const m of body.matchAll(/(?:^|[;{\s])background(?:-color)?\s*:\s*([^;}]+)/g)) {
      let v = m[1].replace(/!important/, '').trim();
      if (cardish && OPAQUE_SURFACE.test(v)) { count++; continue; }
      // Tokens are fine, fallbacks inside var() included; rgba(var(--hue-rgb), a) is the house tint.
      for (let i = 0; i < 4; i++) v = v.replace(/var\([^()]*(?:\([^()]*\)[^()]*)*\)/g, 'TOKEN');
      v = v.replace(/rgba?\(\s*TOKEN\s*,\s*[\d.]+\s*\)/g, 'TOKEN');
      if (/color-mix\(/.test(v) || /#[0-9a-f]{3,8}\b|rgba?\(\s*\d|hsla?\(|\b(?:white|black)\b/i.test(v)) count++;
    }
  }
  return count;
}

const FILES = walk(SRC).filter((f) => !SKIP.test(rel(f)));

describe('surface + ink conventions', () => {
  it('scans the app, not an empty folder (anti-vacuity)', () => {
    expect(FILES.length).toBeGreaterThan(300);
  });

  it('no text uses a raw hue, a pale palette name, or the canvas as ink', () => {
    const offenders = FILES.flatMap((f) => inkOffenders(styleOf(f), rel(f)));
    expect(offenders, `\nUse the role token named on each line:\n${offenders.join('\n')}\n`).toEqual([]);
  });

  it('no inline style="…" attribute paints text in a raw hue either', () => {
    const INLINE = /style=\\?"[^"]*?\bcolor:\s*var\(--(?:color-(?:green|blue|yellow|orange|secondary)|green|cyan|gold)\b/;
    const offenders = [];
    for (const f of FILES.filter((x) => x.endsWith('.vue'))) {
      fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => { if (INLINE.test(line)) offenders.push(`${rel(f)}:${i + 1}  use var(--text-<hue>)`); });
    }
    expect(offenders, `\n${offenders.join('\n')}\n`).toEqual([]);
  });

  it('no NEW off-convention background (literal colour / color-mix), and legacy only shrinks', () => {
    // UPDATE_SURFACE_BASELINE=1 rewrites the baseline from the current tree. Only
    // ever commit the result when every change in it is a DECREASE.
    if (process.env.UPDATE_SURFACE_BASELINE === '1') {
      const current = Object.fromEntries(FILES.map((f) => [rel(f), offConventionBackgrounds(styleOf(f))]).filter(([, n]) => n > 0).sort());
      fs.writeFileSync(BASELINE_PATH, JSON.stringify(current, null, 2) + '\n');
    }
    const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
    const grew = [];
    for (const f of FILES) {
      const n = offConventionBackgrounds(styleOf(f));
      const allowed = baseline[rel(f)] || 0;
      if (n > allowed) grew.push(`${rel(f)}: ${n} literal/color-mix backgrounds (allowed ${allowed}) -> use --color-darker-N, --surface-*, or rgba(var(--<hue>-rgb), a)`);
    }
    expect(grew, `\n${grew.join('\n')}\n`).toEqual([]);
  });

  it('the baseline is not stale: fixed files must lower their count', () => {
    const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
    const counts = Object.fromEntries(FILES.map((f) => [rel(f), offConventionBackgrounds(styleOf(f))]));
    const stale = Object.entries(baseline).filter(([f, n]) => (counts[f] ?? 0) < n).map(([f, n]) => `${f}: baseline ${n}, now ${counts[f] ?? 0}`);
    expect(stale, `\nLower these in surfaceConventions.baseline.json:\n${stale.join('\n')}\n`).toEqual([]);
  });

  it('catches the exact bugs it exists for (negative control)', () => {
    expect(inkOffenders('.gd-title { color: var(--color-ultra-light-navy); }')).toHaveLength(1);
    expect(inkOffenders('.status { color: var(--color-green); }')).toHaveLength(1);
    expect(inkOffenders('.warn { color: var(--color-yellow, #ffd700); }')).toHaveLength(1);
    expect(inkOffenders('.btn { background: var(--color-green); color: var(--color-dark-navy); }')).toHaveLength(1);
    expect(inkOffenders('.ok { color: var(--text-green); } .b { color: var(--text-on-fill); }')).toHaveLength(0);
    expect(inkOffenders('.bubble { background: var(--text-primary); color: var(--color-background); }')).toHaveLength(0);
    expect(offConventionBackgrounds('.c { background: rgba(255, 255, 255, 0.03); }')).toBe(1);
    expect(offConventionBackgrounds('.c { background: color-mix(in srgb, var(--color-green) 12%, transparent); }')).toBe(1);
    expect(offConventionBackgrounds('.c { background: var(--color-darker-0); } .t { background: rgba(var(--green-rgb), 0.1); } .f { background: var(--x, #fff); }')).toBe(0);
    expect(offConventionBackgrounds('.apps-card { background: var(--surface-raised); }')).toBe(1);
    expect(offConventionBackgrounds('.feature-sheet { background: var(--surface-raised); } .menu-item { background: var(--color-popup); }')).toBe(0);
  });
});
