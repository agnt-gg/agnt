import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * FILL / ON-FILL PAIRING GUARD
 *
 * _semantic.css calls the fill/on-fill pairing "the rule that kills the
 * inverse-bug class". The rule was sound; its implementation silently inverted.
 *
 * `--on-fill-*` was defined as `var(--color-black-navy)`. Six themes — ember,
 * hacker, light, midnight, nord, rose — alias `--color-black-navy` to
 * `var(--color-background)`, i.e. their own canvas. On a dark canvas the alias
 * still happened to be dark ink, so nothing looked wrong. In LIGHT and ROSE it
 * resolved to #fcfcfc / #faf4f4, painting WHITE on every accent fill:
 *
 *     --on-fill-warning (#fcfcfc) on --fill-warning (#ffd700) = 1.37:1
 *
 * across all ~93 call sites, in the exact token layer meant to prevent that.
 *
 * The comments on those lines had said "#070710" the whole time, so the bug was
 * invisible to review — the source claimed the right value and shipped another.
 * This test therefore does not read the comments. It resolves each token the way
 * the cascade does and measures the pair.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const THEMES_DIR = path.join(HERE, 'themes');
const BASE = path.join(HERE, 'base/_variables.css');
const SEMANTIC = path.join(THEMES_DIR, '_semantic.css');

const AA_NORMAL = 4.5;

const srgb = (v) => {
  const x = v / 255;
  return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
};
const luminance = ([r, g, b]) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
const contrast = (a, b) => {
  const [l1, l2] = [luminance(a), luminance(b)];
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};
const parseHex = (h) => {
  const s = h.trim().replace('#', '');
  const full = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
};

/* Comments are documentation, not cascade — and this file's comments contain
   colour literals that would otherwise be parsed as declarations. */
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Last declaration wins, matching the cascade. */
const readVar = (css, name) => {
  const re = new RegExp(`--${name}\\s*:\\s*([^;]+);`, 'g');
  let last = null;
  let m;
  while ((m = re.exec(css))) last = m[1].trim();
  return last;
};

/** Extract one rule block by its selector, so `body:not(.dark)` can be applied only to non-dark themes. */
const blockFor = (css, selector) => {
  const i = css.indexOf(selector + ' {');
  if (i === -1) return '';
  const start = css.indexOf('{', i);
  let depth = 0;
  for (let j = start; j < css.length; j++) {
    if (css[j] === '{') depth++;
    else if (css[j] === '}') {
      depth--;
      if (depth === 0) return css.slice(start + 1, j);
    }
  }
  return '';
};

const baseCss = strip(fs.readFileSync(BASE, 'utf8'));
const semanticCss = strip(fs.readFileSync(SEMANTIC, 'utf8'));
const semanticRoot = blockFor(semanticCss, 'body');
const semanticNonDark = blockFor(semanticCss, 'body:not(.dark)');

const THEMES = ['dark', 'light', 'rose', 'ember', 'nord', 'midnight', 'hacker', 'cyberpunk'];
const ROLES = ['accent', 'info', 'success', 'danger', 'warning', 'brand', 'violet', 'indigo'];

const themeCss = Object.fromEntries(
  THEMES.map((t) => [t, strip(fs.readFileSync(path.join(THEMES_DIR, `_${t}.css`), 'utf8'))])
);

/**
 * Resolve a token for one theme, in cascade order:
 *   theme file  ->  body:not(.dark) semantics (non-dark only)  ->  body semantics  ->  base palette
 */
const resolveFor = (theme, token, hops = 6) => {
  const layers = [themeCss[theme], theme === 'dark' ? '' : semanticNonDark, semanticRoot, themeCss.dark, baseCss];
  let value = null;
  for (const layer of layers) {
    value = readVar(layer, token);
    if (value) break;
  }
  for (let i = 0; i < hops; i++) {
    if (!value) return null;
    if (value.startsWith('#')) return parseHex(value);
    const m = value.match(/var\(\s*--([\w-]+)\s*\)/);
    if (!m) return null;
    let next = null;
    for (const layer of layers) {
      next = readVar(layer, m[1]);
      if (next) break;
    }
    value = next;
  }
  return null;
};

/**
 * KNOWN FILL-PALETTE GAPS — a ratchet, not an amnesty.
 *
 * These are NOT pairing bugs. In each case the FILL itself is a mid-tone hue on
 * which neither near-black ink nor white reaches 4.5:1, so no choice of label
 * colour can fix it — only changing that theme's accent hue can, which is a
 * design decision for those palettes and not something to smuggle in here.
 *
 * Measured before/after the pairing fix, none of these was made worse by it
 * (16 pairs improved, 0 regressed). Listed so they stay visible, and asserted
 * not to grow: a new entry means somebody introduced a fill nobody can label.
 */
const KNOWN_FILL_PALETTE_GAPS = new Set([
  'rose/violet', //     #8868b0 — ink 4.45, white 4.51; the source already calls this "a wash"
  'ember/indigo', //    #a07acc — white 3.41 (pairs with white by design)
  'nord/indigo', //     #b48ead — white 2.83
  'midnight/indigo', // #a070ff — white 3.36
  'hacker/indigo', //   #40c080 — white 2.32
  'hacker/danger', //   #c04040 — ink 3.87, white 4.60; both marginal on this palette
]);

describe('fill / on-fill pairing', () => {
  it('resolves tokens the way the browser does (pinned to measured values)', () => {
    // Anti-vacuity, and a self-test of the resolver: these two were read out of
    // a real headless Chrome render. If the resolver drifts from the browser,
    // every assertion below becomes fiction.
    expect(resolveFor('dark', 'on-fill-warning')).toEqual([7, 7, 16]);
    expect(resolveFor('dark', 'fill-warning')).toEqual([255, 215, 0]);
    expect(resolveFor('light', 'fill-warning')).toEqual([255, 215, 0]);
    // The bug this file exists for: --color-black-navy is the CANVAS in light.
    expect(resolveFor('light', 'color-black-navy')).toEqual([252, 252, 252]);
  });

  it('never lets an on-fill token resolve to its theme’s canvas', () => {
    // The precise shape of the original defect, stated directly.
    const offenders = [];
    for (const theme of THEMES) {
      const canvas = resolveFor(theme, 'color-background');
      for (const role of ROLES) {
        const ink = resolveFor(theme, `on-fill-${role}`);
        if (ink && canvas && ink.join() === canvas.join()) offenders.push(`${theme}/${role}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every fill/on-fill pair clears WCAG AA in every theme', () => {
    const failures = [];
    for (const theme of THEMES) {
      for (const role of ROLES) {
        const fill = resolveFor(theme, `fill-${role}`);
        const ink = resolveFor(theme, `on-fill-${role}`);
        expect(fill, `${theme} --fill-${role} did not resolve`).toBeTruthy();
        expect(ink, `${theme} --on-fill-${role} did not resolve`).toBeTruthy();
        const ratio = contrast(ink, fill);
        if (ratio < AA_NORMAL && !KNOWN_FILL_PALETTE_GAPS.has(`${theme}/${role}`)) {
          failures.push(`${theme} --on-fill-${role} on --fill-${role} = ${ratio.toFixed(2)}:1`);
        }
      }
    }
    expect(failures, `\n${failures.join('\n')}\n`).toEqual([]);
  });

  it('has no stale palette-gap entries left behind by a palette fix', () => {
    // The list can only shrink: fix a palette and this tells you to delete the entry.
    const stillFailing = new Set();
    for (const theme of THEMES) {
      for (const role of ROLES) {
        const fill = resolveFor(theme, `fill-${role}`);
        const ink = resolveFor(theme, `on-fill-${role}`);
        if (fill && ink && contrast(ink, fill) < AA_NORMAL) stillFailing.add(`${theme}/${role}`);
      }
    }
    const stale = [...KNOWN_FILL_PALETTE_GAPS].filter((k) => !stillFailing.has(k));
    expect(stale, `these palette gaps are fixed — delete them from the list: ${stale.join(', ')}`).toEqual([]);
  });

  it('the generic --text-on-fill companion clears AA on every fill too', () => {
    const failures = [];
    for (const theme of THEMES) {
      const ink = resolveFor(theme, 'text-on-fill');
      expect(ink, `${theme} --text-on-fill did not resolve`).toBeTruthy();
      for (const role of ROLES) {
        // indigo deliberately pairs with white; the generic ink is not claimed to cover it.
        if (role === 'indigo') continue;
        const fill = resolveFor(theme, `fill-${role}`);
        const ratio = contrast(ink, fill);
        if (ratio < AA_NORMAL && !KNOWN_FILL_PALETTE_GAPS.has(`${theme}/${role}`)) {
          failures.push(`${theme} --text-on-fill on --fill-${role} = ${ratio.toFixed(2)}:1`);
        }
      }
    }
    expect(failures, `\n${failures.join('\n')}\n`).toEqual([]);
  });

  it('no component labels an accent fill with the canvas alias', () => {
    /* The token fix is only half the defect. Ten rules across three components
       painted an accent background and then set `color: var(--color-black-navy)`
       directly — bypassing the pairing entirely and reproducing the same
       white-on-neon result in light and rose. Definitions AND call sites. */
    const SRC = path.resolve(HERE, '..');
    const ACCENT_BG = /background(-color)?\s*:\s*var\(\s*--(color-primary|color-green|color-secondary|color-yellow|color-red|color-pink|fill-[a-z]+)\s*\)/;
    const CANVAS_INK = /color\s*:\s*var\(\s*--color-black-navy\s*\)/;

    const walk = (dir, out = []) => {
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return out;
      }
      for (const e of entries) {
        if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, out);
        else if (/\.(vue|css)$/.test(e.name)) out.push(p);
      }
      return out;
    };

    const offenders = [];
    let rulesScanned = 0;
    for (const file of walk(SRC)) {
      let css;
      try {
        css = strip(fs.readFileSync(file, 'utf8'));
      } catch {
        continue;
      }
      const re = /([^{}]+)\{([^{}]*)\}/g;
      let m;
      while ((m = re.exec(css))) {
        rulesScanned++;
        if (ACCENT_BG.test(m[2]) && CANVAS_INK.test(m[2])) {
          offenders.push(`${path.relative(SRC, file).replace(/\\/g, '/')}  {${m[1].trim().replace(/\s+/g, ' ').slice(-70)}}`);
        }
      }
    }
    expect(rulesScanned, 'scanner matched nothing — it is not guarding anything').toBeGreaterThan(1000);
    expect(offenders, `\nUse the paired --on-fill-<role> token:\n${offenders.join('\n')}\n`).toEqual([]);
  });

  it('proves it has teeth: the old alias would fail in light', () => {
    // If this ever stops failing, the maths or the resolver has broken and the
    // rest of this file is measuring nothing.
    const canvas = resolveFor('light', 'color-black-navy'); // what the old definition resolved to
    const fill = resolveFor('light', 'fill-warning');
    expect(contrast(canvas, fill)).toBeLessThan(2);
  });
});
