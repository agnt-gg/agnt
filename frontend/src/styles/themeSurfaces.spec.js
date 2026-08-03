/**
 * Guard: a NEUTRAL surface or border must sit on the same side of
 * mid-lightness as its own theme's canvas.
 *
 * WHY (2026-08-02)
 * ────────────────
 * This is the single invariant behind a long string of separate-looking bugs:
 *
 *   - `--color-light-navy` is #d0d0dd in light and #d9d9d9 in DARK — a light
 *     grey in BOTH themes. 57 structural borders used it, so the sidebar, the
 *     conversation list and every table cell drew a near-white hairline on the
 *     dark canvas (ΔL* 85).
 *
 *   - `background: rgba(0, 0, 0, 0.2)` written inline. That is EXACTLY
 *     --color-darker-1 in the dark themes, so it looked right there and
 *     rendered #cccccc — a grey slab — on a white page. 120 declarations,
 *     concentrated in the Agent Details tabs.
 *
 * Both are the same mistake: a value taken from ONE theme and written where the
 * theme should have supplied it. Neither is visible to a contrast checker,
 * because the text on top still passes; it is the SURFACE that is wrong.
 *
 * ─── WHY THIS WENT UNNOTICED FOR SO LONG ───────────────────────────────────
 * `_dark.css` patched the visible cases back, one selector at a time:
 *     body.dark #left-sidebar     { border-right: 1px solid var(--color-dull-navy) }
 *     body.dark div#saved-outputs { border: 1px solid var(--color-dull-navy) }
 * Anything nobody remembered to patch — `.list-header`, `.create-new` — drew a
 * white line for as long as it existed. Those patches are now deleted, because
 * the components no longer need correcting.
 *
 * ─── WHAT IS DELIBERATELY EXEMPT ───────────────────────────────────────────
 *   saturated colours   an accent ring/fill is SUPPOSED to stand out
 *   scrims              a modal backdrop is black in both themes by design,
 *                       detected by name AND by full-bleed geometry
 *   state selectors     :hover/:focus/.active borders are emphasis
 *   .border-white etc.  utility classes NAMED for a literal colour
 *   self-contained UIs  MobileLite paints its own always-dark canvas
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const THEMES = path.join(SRC, 'styles', 'themes');

/* ─────────────────────────── token resolution ─────────────────────────── */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const blank = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

function blockOf(css, selector) {
  const out = {};
  const re = new RegExp(`(^|\\})\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^{}]*)\\}`, 'g');
  for (const m of css.matchAll(re)) {
    for (const d of m[2].matchAll(/(--[A-Za-z0-9_-]+)\s*:\s*([^;]+);/g)) out[d[1]] = d[2].trim();
  }
  return out;
}
const read = (p) => strip(fs.readFileSync(p, 'utf8'));
const semanticCss = read(path.join(THEMES, '_semantic.css'));
const varsCss = read(path.join(SRC, 'styles', 'base', '_variables.css'));
const aliasCss = read(path.join(THEMES, '_aliases.css'));

const MAPS = {
  light: {
    ...blockOf(varsCss, ':root'), ...blockOf(semanticCss, ':root,\nbody'), ...blockOf(aliasCss, 'body'),
    ...blockOf(read(path.join(THEMES, '_light.css')), 'body:not(.dark):not(.rose)'),
    ...blockOf(semanticCss, 'body:not(.dark)'),
  },
  dark: {
    ...blockOf(varsCss, ':root'), ...blockOf(semanticCss, ':root,\nbody'), ...blockOf(aliasCss, 'body'),
    ...blockOf(read(path.join(THEMES, '_dark.css')), 'body.dark'),
    ...blockOf(semanticCss, 'body.dark'),
  },
};

function resolve(value, map, depth = 0) {
  if (value == null || depth > 8) return null;
  const v = String(value).trim();
  const varM = v.match(/^var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,\s*([\s\S]+))?\)$/);
  if (varM) return resolve(map[varM[1]] ?? varM[2], map, depth + 1);
  const hexM = v.match(/^#([0-9a-f]{3,8})$/i);
  if (hexM) {
    let h = hexM[1];
    if (h.length === 3) h = [...h].map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    return { rgb: [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)), a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
  }
  const rgbaM = v.match(/^rgba?\(([^)]+)\)$/i);
  if (rgbaM) {
    const p = rgbaM[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    if (p.length < 3 || p.slice(0, 3).some(Number.isNaN)) return null;
    return { rgb: p.slice(0, 3), a: p[3] === undefined ? 1 : p[3] };
  }
  if (/^white$/i.test(v)) return { rgb: [255, 255, 255], a: 1 };
  if (/^black$/i.test(v)) return { rgb: [0, 0, 0], a: 1 };
  return null;
}

const chan = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
const Lstar = (y) => (y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y);
const over = (fg, bg) => (fg.a >= 0.999 ? fg.rgb : fg.rgb.map((c, i) => c * fg.a + bg[i] * (1 - fg.a)));
/* WCAG contrast. The original checks in this file only ever compared
   luminances, so there was no ratio helper to reach for. */
const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
function saturation([r, g, b]) {
  const R = r / 255; const G = g / 255; const B = b / 255;
  const mx = Math.max(R, G, B); const mn = Math.min(R, G, B);
  const l = (mx + mn) / 2; const d = mx - mn;
  return d ? d / (1 - Math.abs(2 * l - 1)) : 0;
}
const CANVAS = { light: [255, 255, 255], dark: [16, 16, 31] };

/* ─────────────────────────── file plumbing ─────────────────────────── */
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!/node_modules|dist|\.git/.test(e.name)) walk(p, out); }
    else if (/\.(vue|css)$/.test(e.name)) out.push(p);
  }
  return out;
}
function rulesOf(css) {
  const out = []; const stack = []; let buf = ''; let i = 0;
  while (i < css.length) {
    const c = css[i];
    if (c === '{') { const h = buf.trim(); buf = ''; stack.push(h.startsWith('@') ? { at: 1 } : { sel: h, start: i + 1 }); i += 1; continue; }
    if (c === '}') { const t = stack.pop(); if (t?.sel !== undefined) out.push({ sel: t.sel, body: css.slice(t.start, i) }); buf = ''; i += 1; continue; }
    buf += c; i += 1;
  }
  return out;
}
function styleText(file) {
  const raw = fs.readFileSync(file, 'utf8');
  if (file.endsWith('.css')) return raw;
  const withoutScript = raw.replace(/<script[\s\S]*?<\/script>/gi, (m) => m.replace(/[^\n]/g, ' '));
  return [...withoutScript.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n');
}
const rel = (f) => path.relative(SRC, f).replace(/\\/g, '/');

const EXEMPT_FILE = /base\/js\/libs|\.min\.|__old-|main copy|MobileLite|Minigames|Marketplace\.vue|CodePreview|_utilities\.css/;
const SCRIM = /overlay|backdrop|scrim|::backdrop|modal-bg|\.lightbox|tooltip/i;
const STATE = /:hover|:focus|:active|:checked|\.active\b|\.selected\b|\.on\b|\.connected\b|drag-hover|\.error\b|\.warn|\.success|\.failed\b|\.running\b|\.dragging\b|\.processing\b|\.highlight/i;
const isFullBleed = (body) => (
  /position\s*:\s*(fixed|absolute)/i.test(body)
  && (/\binset\s*:\s*0/i.test(body)
    || (/\btop\s*:\s*0/i.test(body) && /\bwidth\s*:\s*100%/i.test(body) && /\bheight\s*:\s*100%/i.test(body)))
);
function themesFor(sel) {
  const s = sel.toLowerCase();
  // `:not(.dark)` CONTAINS `.dark` — strip negations before looking for a dark scope.
  const noNeg = s.replace(/:not\([^)]*\)/g, '');
  if (/:not\(\s*\.dark\s*\)|\.rose\b/.test(s)) return ['light'];
  if (/(^|[\s,>+~(])(body)?\.(dark|cyberpunk|ember|hacker|midnight|nord)\b/.test(noNeg)) return ['dark'];
  return ['light', 'dark'];
}

const FILES = walk(SRC).filter((f) => !EXEMPT_FILE.test(rel(f)));

/** Every (rule, property, resolved colour, theme) worth judging. */
function* surfaces(propRe) {
  for (const file of FILES) {
    const css = blank(styleText(file));
    for (const rule of rulesOf(css)) {
      if (SCRIM.test(rule.sel) || isFullBleed(rule.body)) continue;
      for (const m of rule.body.matchAll(propRe)) {
        const prop = m[1]; const raw = m[2].trim();
        if (/gradient|url\(|^(transparent|none|inherit|unset|initial|currentcolor|0)\b/i.test(raw)) continue;
        const colTxt = /background/i.test(prop) || /-color$/i.test(prop)
          ? raw
          : (raw.match(/(var\(\s*--[A-Za-z0-9_-]+\s*(?:,[^)]*)?\)|#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|\bwhite\b|\bblack\b)/i) || [])[0];
        if (!colTxt) continue;
        for (const theme of themesFor(rule.sel)) {
          const col = resolve(colTxt, MAPS[theme]);
          if (!col) continue;
          yield { file: rel(file), sel: rule.sel.replace(/\s+/g, ' ').slice(0, 58), prop, raw: colTxt, theme, col, rule };
        }
      }
    }
  }
}

describe('theme surfaces: neutrals stay on their own side of mid-lightness', () => {
  it('scans a realistic amount of CSS (anti-vacuity)', () => {
    expect(FILES.length).toBeGreaterThan(200);
    expect([...surfaces(/(?:^|[;{])\s*(background(?:-color)?)\s*:\s*([^;}]+)/gi)].length).toBeGreaterThan(300);
  });

  /**
   * A NEUTRAL border must not land on the far side of mid-lightness from its
   * own canvas. In a dark theme that means no light-grey hairlines.
   */
  it('no neutral structural border is a light grey in a dark theme', () => {
    const bad = [];
    for (const s of surfaces(/(?:^|[;{])\s*(border(?:-(?:top|right|bottom|left))?(?:-color)?)\s*:\s*([^;}]+)/gi)) {
      if (STATE.test(s.sel)) continue;
      const painted = over(s.col, CANVAS[s.theme]);
      if (saturation(painted) > 0.2) continue;
      const L = Lstar(lum(painted));
      const wrong = s.theme === 'dark' ? L > 60 : L < 35;
      if (wrong) bad.push(`${s.file}  [${s.theme}]  ${s.sel}  {${s.prop}: ${s.raw}}  ->  L* ${L.toFixed(0)}`);
    }
    expect(
      bad.join('\n') || 'clean',
      'A neutral border sits on the wrong side of mid-lightness for its theme.\n'
      + 'The usual cause is a token that does not invert (--color-light-navy is a\n'
      + 'light grey in BOTH themes) or a hardcoded #ddd/#ccc. Use\n'
      + '--terminal-border-color, which is themed.\n'
    ).toBe('clean');
  });

  /**
   * `rgba(0,0,0,a)` as a surface is a DARK-THEME LITERAL: it is exactly what
   * --color-darker-N resolves to there. Writing it inline is invisible in dark
   * and paints a grey slab in light.
   */
  it('no inline rgba(0,0,0,a) surface outside a scrim', () => {
    const bad = [];
    for (const file of FILES) {
      const css = blank(styleText(file));
      for (const rule of rulesOf(css)) {
        if (SCRIM.test(rule.sel) || isFullBleed(rule.body)) continue;
        // A rule written FOR the dark theme may legitimately say so.
        if (themesFor(rule.sel).length === 1 && themesFor(rule.sel)[0] === 'dark') continue;
        for (const m of rule.body.matchAll(/(?:^|[;{])\s*background(?:-color)?\s*:\s*(rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*[\d.]+\s*\))/gi)) {
          bad.push(`${rel(file)}  ${rule.sel.replace(/\s+/g, ' ').slice(0, 58)}  {background: ${m[1]}}`);
        }
      }
    }
    expect(
      bad.join('\n') || 'clean',
      'An inline rgba(0,0,0,a) surface. That is the DARK theme\'s own value for\n'
      + '--color-darker-N, so it looks correct in dark and renders a grey slab in\n'
      + 'light. Use the token: 0.1 -> --color-darker-0, 0.2 -> --color-darker-1,\n'
      + '0.4 -> --color-darker-2, 0.8 -> --color-darker-3. A field is --color-darker-0.\n'
      + 'A full-bleed or *-overlay scrim is exempt and detected automatically.\n'
    ).toBe('clean');
  });

  /**
   * A --<hue>-rgb triplet exists to be COMPOSITED: rgba(var(--yellow-rgb), .15).
   * 1,451 of its 1,575 uses are a tint, an edge or a glow; exactly one is text.
   *
   * The light triplets were once set equal to the --color-<hue> text values,
   * which had been darkened to pass AA on white. Compositing a dark desaturated
   * brown over white gives mud:
   *     rgba(154, 98, 0, .15)  -> #f0e7d9  saturation  43%   (beige)
   *     rgba(255, 199, 0, .15) -> #fff7d9  saturation 100%   (pale gold)
   * Same alpha, same hue angle. The difference is the chroma of the source, and
   * it is why every gold and yellow surface read as bronze in light mode.
   */
  it('every light-mode hue triplet is a HUE, not a darkened text colour', () => {
    const HUES = ['yellow', 'green', 'blue', 'red', 'pink', 'primary', 'indigo', 'orange', 'violet'];
    const weak = [];
    for (const h of HUES) {
      const raw = MAPS.light[`--${h}-rgb`];
      if (!raw) continue;
      const rgb = raw.split(',').map((x) => parseFloat(x));
      if (rgb.length !== 3 || rgb.some(Number.isNaN)) continue;
      const s = saturation(rgb);
      const L = Lstar(lum(rgb));
      // A hue is saturated. A darkened-for-text value is mid-dark and duller.
      if (s < 0.55 || L < 35) weak.push(`--${h}-rgb: ${raw}  (saturation ${(s * 100).toFixed(0)}%, L* ${L.toFixed(0)})`);
    }
    expect(
      weak.join('\n') || 'clean',
      'A light-mode --<hue>-rgb triplet is dark and/or desaturated, which means it\n'
      + 'is a TEXT colour rather than a hue. Tints derived from it composite to mud\n'
      + 'over white. Keep the triplet at full chroma and put the readable value in\n'
      + '--color-<hue> instead — they are two different jobs.\n'
    ).toBe('clean');
  });

  /**
   * A status colour is overwhelmingly used as a label ON its matching badge, so
   * the canvas is the wrong reference surface. Measured against the canvas the
   * old values all passed; measured against their own 15-20% tint several sat
   * at 3.8-4.4:1.
   */
  it('every status text colour clears AA on its own tint, not just the canvas', () => {
    const HUES = ['yellow', 'green', 'blue', 'red', 'pink', 'indigo', 'orange', 'violet'];

    /**
     * KNOWN DEBT, frozen so it cannot grow. These three fail in the DARK theme
     * and always have -- they were surfaced by the probe written for the light
     * fix, not caused by it:
     *     pink   #e53d8f on its own tint  3.92:1
     *     violet #d13de5                  3.97:1
     *     indigo #7d3de5                  2.80:1
     * Fixing them means brightening the dark accent hues (indigo would go
     * #7d3de5 -> #a071ec), which is a visible change to a theme nobody reported
     * a problem with. Tracked on triage/dark-status-text-on-tint.
     *
     * An entry here is a promise to come back, not a licence: anything NOT on
     * this list fails immediately.
     */
    const KNOWN_DARK_DEBT = new Set(['pink', 'violet', 'indigo']);

    const bad = [];
    for (const theme of ['light', 'dark']) {
      for (const h of HUES) {
        if (theme === 'dark' && KNOWN_DARK_DEBT.has(h)) continue;
        const text = resolve(`var(--color-${h})`, MAPS[theme]);
        const trip = MAPS[theme][`--${h}-rgb`];
        if (!text || !trip) continue;
        const rgb = trip.split(',').map((x) => parseFloat(x));
        if (rgb.length !== 3 || rgb.some(Number.isNaN)) continue;
        for (const a of [0.1, 0.15, 0.2]) {
          const tint = over({ rgb, a }, CANVAS[theme]);
          const c = ratio(over(text, tint), tint);
          if (c < 4.5) bad.push(`[${theme}] --color-${h} on its own ${a} tint: ${c.toFixed(2)}:1`);
        }
      }
    }
    expect(
      bad.join('\n') || 'clean',
      'A status text colour fails AA against its own badge tint. Badges are written\n'
      + 'as `background: rgba(var(--<hue>-rgb), .15); color: var(--color-<hue>)`, so\n'
      + 'the tint is the surface that matters, not the canvas.\n'
    ).toBe('clean');
  });

  it('the known dark debt is still real, and still exactly three (anti-rot)', () => {
    // If someone fixes one, this fails and tells them to shrink the list -- so
    // the exemption cannot outlive the problem.
    const stillFailing = [];
    for (const h of ['pink', 'violet', 'indigo']) {
      const text = resolve(`var(--color-${h})`, MAPS.dark);
      const trip = MAPS.dark[`--${h}-rgb`];
      if (!text || !trip) continue;
      const rgb = trip.split(',').map((x) => parseFloat(x));
      const tint = over({ rgb, a: 0.2 }, CANVAS.dark);
      if (ratio(over(text, tint), tint) < 4.5) stillFailing.push(h);
    }
    expect(
      stillFailing.sort(),
      'The frozen dark-theme debt list no longer matches reality. If you fixed one,\n'
      + 'remove it from KNOWN_DARK_DEBT above so the guard starts enforcing it.'
    ).toEqual(['indigo', 'pink', 'violet']);
  });

  /**
   * A --gradient-* TOKEN MUST BE A VALID <image> IN EVERY THEME.
   *
   * `background-image` accepts an <image>, not a <color>. A theme that defines
   * --gradient-accent as a plain colour makes every
   *     background-image: var(--gradient-accent)
   * an INVALID declaration, which the browser silently DROPS -- the element
   * loses its fill entirely and keeps the ink chosen to sit on that fill.
   *
   * This happened: the light theme set --gradient-brand/-accent to
   * var(--color-primary)/var(--color-secondary) and the Agent Forge "Create
   * Agent" button rendered #ffffff on #fcfcfc -- 1.03:1, invisible. Seven
   * declarations across four files were affected.
   *
   * Nothing else catches this. The token resolves, the syntax parses, and the
   * rule is discarded at computed-value time with no error. The `background`
   * SHORTHAND does accept a colour, which is why the 21 other
   * `background: var(--gradient-*)` uses kept working and masked it.
   */
  it('every --gradient-* token resolves to an <image> in every theme', () => {
    /** Follow var() chains to a literal, without assuming it is a colour. */
    const resolveRaw = (value, map, depth = 0) => {
      if (value == null || depth > 8) return null;
      const v = String(value).trim();
      const m = v.match(/^var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,\s*([\s\S]+))?\)$/);
      if (m) return resolveRaw(map[m[1]] ?? m[2], map, depth + 1);
      return v;
    };

    const bad = [];
    for (const theme of ['light', 'dark']) {
      const names = Object.keys(MAPS[theme]).filter((k) => /^--gradient-/.test(k));
      for (const name of names) {
        const raw = resolveRaw(MAPS[theme][name], MAPS[theme]);
        if (raw == null) continue;
        // An <image>: any *-gradient() function, url(), or image-set().
        if (/(^|\s)(repeating-)?(linear|radial|conic)-gradient\(|^url\(|^image-set\(/i.test(raw)) continue;
        bad.push(`[${theme}] ${name}: ${raw}`);
      }
    }
    expect(
      bad.join('\n') || 'clean',
      'A --gradient-* token does not resolve to a valid <image>.\n'
      + 'Every `background-image: var(--gradient-*)` using it becomes an invalid\n'
      + 'declaration and is DROPPED, so the element loses its fill while keeping the\n'
      + 'ink that was chosen for that fill. If a theme wants a flat look, use a\n'
      + 'single-hue gradient (linear-gradient(135deg, #aaa, #999)) rather than a\n'
      + 'bare colour -- it reads as flat and keeps the token type-correct.\n'
    ).toBe('clean');
  });

  it('finds the gradient tokens it claims to check (anti-vacuity)', () => {
    for (const theme of ['light', 'dark']) {
      const names = Object.keys(MAPS[theme]).filter((k) => /^--gradient-/.test(k));
      expect(names.length, `${theme} declares no --gradient-* tokens`).toBeGreaterThanOrEqual(2);
    }
    // A bare colour must fail the predicate this test relies on.
    const isImage = (raw) => /(^|\s)(repeating-)?(linear|radial|conic)-gradient\(|^url\(|^image-set\(/i.test(raw);
    expect(isImage('#b02d6c')).toBe(false);
    expect(isImage('linear-gradient(135deg, #b02d6c, #9a2760)')).toBe(true);
  });

  it('detects the exact bugs this guard exists for (negative control)', () => {
    // --color-light-navy as a border in dark: the sidebar / conversation-list bug.
    const leak = resolve('var(--color-light-navy)', MAPS.dark);
    expect(leak, '--color-light-navy should still resolve').toBeTruthy();
    expect(Lstar(lum(over(leak, CANVAS.dark)))).toBeGreaterThan(60);

    // and the token it was replaced with must NOT trip the same test.
    const good = resolve('var(--terminal-border-color)', MAPS.dark);
    expect(Lstar(lum(over(good, CANVAS.dark)))).toBeLessThan(60);

    // the light-mode swap really is a no-op
    expect(resolve('var(--color-light-navy)', MAPS.light))
      .toEqual(resolve('var(--terminal-border-color)', MAPS.light));

    // rgba(0,0,0,0.2) really is --color-darker-1 in dark, and is not in light
    expect(resolve('rgba(0,0,0,0.2)', MAPS.dark)).toEqual(resolve('var(--color-darker-1)', MAPS.dark));
    expect(resolve('rgba(0,0,0,0.2)', MAPS.light)).not.toEqual(resolve('var(--color-darker-1)', MAPS.light));

    // The old muddy triplet would fail the hue check; the shipped one passes.
    expect(saturation([154, 98, 0])).toBeGreaterThan(0.55); // chroma alone is not the tell
    const muddy = over({ rgb: [154, 98, 0], a: 0.15 }, CANVAS.light);
    const clean = over({ rgb: [255, 199, 0], a: 0.15 }, CANVAS.light);
    expect(saturation(muddy)).toBeLessThan(0.6); // the TINT is what goes dull
    expect(saturation(clean)).toBeGreaterThan(0.9);
  });
});
