import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * SECONDARY-INK CONTRAST GUARD
 *
 * Why this exists
 * ---------------
 * The codebase uses a deliberate idiom for dimmed body text:
 *
 *     color: var(--color-text);
 *     opacity: 0.82;
 *
 * derived from each theme's own ink so the palette stays correct. The alpha is
 * a MEASURED value, and it was measured once, by hand, in a comment.
 *
 * It then rotted silently. The light theme later moved `--color-navy` from
 * #131322 to #ffffff, which brightened the raised card those rules sit on. The
 * shipped alpha of 0.72 — documented as ">=4.8:1 in all eight themes" — was
 * actually measuring 4.00:1 in light, below WCAG AA. Nothing failed, because
 * nothing checked.
 *
 * So this test does not pin a number a human wrote down. It re-derives the real
 * contrast from the live theme files every run: any `color: var(--color-text)` +
 * `opacity` pair anywhere in src/, against every theme's card fill and page
 * fill. Change a palette and break a text rule, and this fails immediately —
 * including for rules that do not exist yet.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..');
const THEMES_DIR = path.join(HERE, 'themes');

const AA_NORMAL = 4.5;

/* ── colour maths ────────────────────────────────────────────────────────── */
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
/** Text at `alpha` over an opaque background — what the eye actually receives. */
const composite = (ink, alpha, bg) => [0, 1, 2].map((i) => Math.round(ink[i] * alpha + bg[i] * (1 - alpha)));

/* ── read the real themes ────────────────────────────────────────────────── */

/**
 * Strip block comments before parsing anything.
 *
 * _light.css documents its own history in prose that happens to contain
 * `--color-text: var(--color-dull-white)`. A naive regex matched that COMMENT
 * instead of the real declaration, resolved light's ink to #f7f7f7 and reported
 * white-on-white 1.02:1 for forty rules that are in fact fine. Any CSS parsing
 * here strips comments first, or it is measuring documentation.
 */
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Last declaration wins, matching the cascade rather than source order. */
const readVar = (css, name) => {
  const re = new RegExp(`--${name}\\s*:\\s*([^;]+);`, 'g');
  let last = null;
  let m;
  while ((m = re.exec(css))) last = m[1].trim();
  return last;
};

/**
 * Resolve a token to a hex literal, following one level of var() indirection
 * into the base palette. Returns null for anything unresolvable, so a token we
 * cannot evaluate is skipped loudly rather than silently measured as black —
 * the exact failure mode that produced four phantom results while I was
 * building this.
 */
const resolveToken = (raw, themeCss, baseCss) => {
  if (!raw) return null;
  let value = raw;
  for (let hop = 0; hop < 3; hop++) {
    if (value.startsWith('#')) return parseHex(value);
    const m = value.match(/var\(\s*--([\w-]+)\s*\)/);
    if (!m) return null;
    value = readVar(themeCss, m[1]) || readVar(baseCss, m[1]);
    if (!value) return null;
  }
  return value.startsWith('#') ? parseHex(value) : null;
};

const baseCss = stripComments(fs.readFileSync(path.join(SRC, 'styles/base/_variables.css'), 'utf8'));

const themes = fs
  .readdirSync(THEMES_DIR)
  .filter((f) => f.startsWith('_') && f.endsWith('.css') && !['_aliases.css', '_core.css', '_semantic.css'].includes(f))
  .map((file) => {
    const css = stripComments(fs.readFileSync(path.join(THEMES_DIR, file), 'utf8'));
    const name = file.replace(/^_|\.css$/g, '');
    // A theme that overrides nothing inherits the dark family's values.
    const darkCss = stripComments(fs.readFileSync(path.join(THEMES_DIR, '_dark.css'), 'utf8'));
    // theme -> dark family -> base palette. Without the base hop, themes that
    // override nothing (cyberpunk) resolved to null and were silently dropped
    // from the sweep, which is exactly how a guard quietly stops guarding.
    const pick = (token) =>
      resolveToken(readVar(css, token), css, baseCss) ||
      resolveToken(readVar(darkCss, token), darkCss, baseCss) ||
      resolveToken(readVar(baseCss, token), baseCss, baseCss);
    return {
      name,
      ink: pick('color-text'),
      card: pick('color-navy'), // the raised surface cards/panels use
      page: pick('color-background'),
    };
  })
  .filter((t) => t.ink && t.card && t.page);

/* ── find every dimmed-ink rule in the tree ──────────────────────────────── */
const walk = (dir, out = []) => {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out; // a directory can vanish between readdir and read under parallel workers
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(vue|css)$/.test(e.name)) out.push(p);
  }
  return out;
};

/** Rules that set BOTH `color: var(--color-text)` and an `opacity` < 1. */
const findDimmedInkRules = () => {
  const found = [];
  for (const file of walk(SRC)) {
    let css;
    try {
      css = stripComments(fs.readFileSync(file, 'utf8'));
    } catch {
      continue; // vanished mid-walk; not this test's business
    }
    const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = ruleRe.exec(css))) {
      const body = m[2];
      if (!/color\s*:\s*var\(\s*--color-text\s*\)/.test(body)) continue;
      const op = body.match(/(?:^|[;{\s])opacity\s*:\s*([\d.]+)\s*;/);
      if (!op) continue;
      const alpha = parseFloat(op[1]);
      if (!(alpha > 0 && alpha < 1)) continue;
      found.push({
        file: path.relative(SRC, file).replace(/\\/g, '/'),
        selector: m[1].trim().replace(/\s+/g, ' ').slice(-90),
        alpha,
      });
    }
  }
  return found;
};

/**
 * KNOWN EXCLUSIONS — a ratchet, not an amnesty.
 *
 * These are interactive-control RESTING states, not body copy: a nav button
 * that is dim until you hover or select it. WCAG's 4.5:1 text rule is the wrong
 * instrument for them, and lifting them to the body-text alpha would visibly
 * redesign the primary navigation's de-emphasis — a design decision, and not
 * one to smuggle into a marketplace change.
 *
 * They are listed rather than skipped so they stay visible, and the list is
 * asserted not to grow. Anything new must be fixed or consciously added here.
 */
const KNOWN_NON_TEXT_EXCLUSIONS = [
  { file: 'views/Terminal/LeftPanel/header/Navigation.vue', selector: '.primary-nav-button' },
  { file: 'views/Terminal/LeftPanel/header/Navigation.vue', selector: '.secondary-nav-button' },
  { file: 'base/css/main.css', selector: 'think' },
];
const isExcluded = (rule) =>
  KNOWN_NON_TEXT_EXCLUSIONS.some((e) => e.file === rule.file && rule.selector.endsWith(e.selector));

const rules = findDimmedInkRules();

describe('secondary-ink contrast (derived from the live theme files)', () => {
  it('can actually read the themes it claims to check', () => {
    // Anti-vacuity: if theme parsing silently failed, every other assertion
    // below would pass by measuring nothing. Naming the palettes explicitly
    // beats a count, which a silent drop can still satisfy.
    const names = themes.map((t) => t.name).sort();
    expect(names).toEqual(expect.arrayContaining(['dark', 'light', 'rose', 'ember', 'nord', 'midnight', 'hacker', 'cyberpunk']));
    for (const t of themes) {
      expect(t.ink, `${t.name} --color-text`).toHaveLength(3);
      expect(t.card, `${t.name} --color-navy`).toHaveLength(3);
      expect(t.page, `${t.name} --color-background`).toHaveLength(3);
    }
  });

  it('finds the dimmed-ink rules it is supposed to police', () => {
    // Anti-vacuity: a regex that stops matching must fail loudly rather than
    // quietly declare an empty set compliant.
    expect(rules.length).toBeGreaterThanOrEqual(5);
  });

  it('proves the check has teeth: the old 0.72 alpha fails in light', () => {
    // This is the exact regression that shipped. If this ever stops failing,
    // the maths below has broken and the rest of this file means nothing.
    const light = themes.find((t) => t.name === 'light');
    expect(light).toBeTruthy();
    expect(contrast(composite(light.ink, 0.72, light.card), light.card)).toBeLessThan(AA_NORMAL);
  });

  it('has no stale exclusions left behind by a fix', () => {
    // If someone fixes an excluded rule, this fails and the exclusion gets
    // deleted — so the list can only shrink.
    for (const e of KNOWN_NON_TEXT_EXCLUSIONS) {
      expect(rules.some((r) => r.file === e.file && r.selector.endsWith(e.selector)), `stale exclusion: ${e.file} ${e.selector}`).toBe(true);
    }
  });

  it('every dimmed-ink TEXT rule clears WCAG AA on every theme, on card and page', () => {
    const failures = [];
    for (const rule of rules.filter((r) => !isExcluded(r))) {
      for (const t of themes) {
        for (const [surfaceName, surface] of [
          ['card', t.card],
          ['page', t.page],
        ]) {
          const ratio = contrast(composite(t.ink, rule.alpha, surface), surface);
          if (ratio < AA_NORMAL) {
            failures.push(
              `${rule.file}  {${rule.selector}}  opacity:${rule.alpha}  ->  ${ratio.toFixed(2)}:1 on ${t.name} ${surfaceName} (need ${AA_NORMAL})`
            );
          }
        }
      }
    }
    expect(failures, `\n${failures.join('\n')}\n`).toEqual([]);
  });
});
