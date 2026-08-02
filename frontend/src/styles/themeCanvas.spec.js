/**
 * Guard: one canvas colour per theme, declared once.
 *
 * WHY (2026-08-02)
 * ────────────────
 * The light theme's page background was written down in THREE places:
 *
 *   1. `--color-background: #f1f0f5`            (styles/themes/_light.css)
 *   2. `body:not(.dark) main-area { #f5f5fa }`  (same file, 180 lines later)
 *   3. `.swatch-light { #f1f0f5 }`              (components/OnboardingModal.vue)
 *
 * #2 is the element that actually paints the app backdrop, and it was a
 * near-duplicate rather than the token — so the two disagreed by 2 L*, and
 * changing the token moved only part of the screen. #3 is the theme picker
 * preview, which advertises a colour the app then does not use.
 *
 * Three copies of one value is not a typo, it is a drift generator: every
 * future colour change silently fixes one third of the app. These tests make
 * the token the single source of truth and fail the build the moment a fourth
 * copy appears.
 *
 * The rgb-triplet check exists for the same reason: `--color-background-rgb`
 * is consumed by every `rgba(var(--color-background-rgb), a)` overlay in the
 * app, and nothing but a test can notice when it stops matching the hex it is
 * supposed to mirror.
 *
 * UPDATE (2026-08-02): `--color-text` turned out to have the identical shape —
 * three copies of #2a2a3a in _light.css (the token, `--color-dull-white`,
 * `--color-light-green`) plus a fourth as the body `color:` that actually
 * paints inherited text. So the guard covers both tokens, and additionally
 * pins the two invariants a colour change can silently break: WCAG AA against
 * the canvas, and the ORDERING of the four-step text hierarchy.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const THEMES_DIR = path.join(SRC, 'styles', 'themes');
const ONBOARDING = path.join(SRC, 'components', 'OnboardingModal.vue');

const read = (p) => fs.readFileSync(p, 'utf8');

/** All theme stylesheets that declare their own canvas colour. */
function themeFiles() {
  return fs
    .readdirSync(THEMES_DIR)
    .filter((f) => f.endsWith('.css'))
    .map((f) => ({ name: f.replace(/^_|\.css$/g, ''), file: path.join(THEMES_DIR, f) }))
    .map((t) => ({ ...t, css: read(t.file) }))
    .filter((t) => /--color-background:\s*#[0-9a-f]{6}/i.test(t.css));
}

const hexToRgb = (hex) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

const declaredBackground = (css) => css.match(/--color-background:\s*(#[0-9a-f]{6})/i)?.[1].toLowerCase();
const declaredRgb = (css) => css.match(/--color-background-rgb:\s*(\d+),\s*(\d+),\s*(\d+)/)?.slice(1).map(Number);
const declaredToken = (css, name) => css.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i'))?.[1].toLowerCase();

/* WCAG 2.1 relative luminance + contrast ratio. */
const channel = (c) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex) => {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('theme canvas colour', () => {
  it('light theme canvas is #fcfcfc', () => {
    // Pinned by product decision (2026-08-02). If this changes, the swatch and
    // the rgb triplet must move with it — the tests below enforce that.
    expect(declaredBackground(read(path.join(THEMES_DIR, '_light.css')))).toBe('#fcfcfc');
  });

  it('every theme keeps --color-background-rgb equal to its hex canvas', () => {
    const themes = themeFiles();
    expect(themes.length).toBeGreaterThan(3); // negative control: we found real files

    for (const { name, css } of themes) {
      const hex = declaredBackground(css);
      const rgb = declaredRgb(css);
      expect(rgb, `${name}: declares --color-background but no --color-background-rgb`).toBeDefined();
      expect(rgb, `${name}: --color-background-rgb drifted from ${hex}`).toEqual(hexToRgb(hex));
    }
  });

  it('no theme re-hardcodes its own canvas colour elsewhere in the sheet', () => {
    for (const { name, css } of themeFiles()) {
      const hex = declaredBackground(css);
      // Count occurrences outside comments. One = the declaration itself.
      const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
      const uses = withoutComments.match(new RegExp(hex, 'gi')) || [];
      expect(
        uses.length,
        `${name}: canvas ${hex} is written ${uses.length}x — use var(--color-background) instead of repeating it`
      ).toBe(1);
    }
  });

  it('light theme paints the app backdrop with the token, not a copy', () => {
    const css = read(path.join(THEMES_DIR, '_light.css'));
    const rule = css.match(/body:not\(\.dark\)\s+main-area\s*\{[^}]*\}/)?.[0];
    expect(rule, 'expected a light-mode main-area rule to exist').toBeDefined();
    expect(rule).toMatch(/background:\s*var\(--color-background\)/);
    expect(rule, 'main-area must not hardcode a colour').not.toMatch(/background:\s*#[0-9a-f]{3,8}/i);
  });

  it('theme picker swatches match the canvas each theme actually renders', () => {
    const onboarding = read(ONBOARDING);

    for (const { name, css } of themeFiles()) {
      const swatch = onboarding.match(new RegExp(`\\.swatch-${name}\\s*\\{[^}]*background:\\s*(#[0-9a-f]{6})`, 'i'));
      if (!swatch) continue; // not every theme is offered in onboarding
      expect(
        swatch[1].toLowerCase(),
        `.swatch-${name} previews ${swatch[1]} but the ${name} theme renders ${declaredBackground(css)}`
      ).toBe(declaredBackground(css));
    }
  });

  it('light body text is painted by the token, not a fourth copy of it', () => {
    const css = read(path.join(THEMES_DIR, '_light.css'));

    // The `color:` inside the light variable block is what every unstyled
    // element inherits. A literal here outranks --color-text by being the
    // thing that actually paints.
    const block = css.match(/body:not\(\.dark\):not\(\.rose\)\s*\{[\s\S]*?\n\}/)?.[0];
    expect(block, 'expected the light theme variable block to exist').toBeDefined();

    const bodyColor = block.match(/\n\s{2}color:\s*([^;]+);/)?.[1].trim();
    expect(bodyColor, 'light block should set an inherited text colour').toBeDefined();
    expect(bodyColor).toBe('var(--color-text)');
  });

  it('light theme declares its text colour exactly once', () => {
    const css = read(path.join(THEMES_DIR, '_light.css')).replace(/\/\*[\s\S]*?\*\//g, '');
    const text = declaredToken(css, '--color-text');
    expect(text, '_light.css must declare --color-text').toBeDefined();

    const uses = css.match(new RegExp(text, 'gi')) || [];
    expect(
      uses.length,
      `--color-text ${text} is written ${uses.length}x — alias it with var(--color-text) instead of repeating the literal`
    ).toBe(1);
  });

  it('light theme text is #4a4a60', () => {
    // Pinned by product decision (2026-08-02).
    expect(declaredToken(read(path.join(THEMES_DIR, '_light.css')), '--color-text')).toBe('#4a4a60');
  });

  it('every light-mode text tier clears WCAG AA against its own canvas', () => {
    for (const file of ['_light.css', '_rose.css']) {
      const css = read(path.join(THEMES_DIR, file));
      const bg = declaredBackground(css);
      if (!bg) continue;

      for (const tier of ['--color-text', '--color-text-muted', '--color-text-secondary']) {
        const fg = declaredToken(css, tier);
        if (!fg) continue;
        const ratio = contrast(fg, bg);
        expect(
          ratio,
          `${file} ${tier} ${fg} on ${bg} is ${ratio.toFixed(2)}:1 — below the 4.5:1 AA floor`
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('light text hierarchy keeps its ordering (primary darkest)', () => {
    // A lighter primary than its own muted tier inverts the hierarchy — the
    // page still "passes contrast" while reading as though everything is
    // de-emphasised. Ordering is the invariant, not any single ratio.
    const css = read(path.join(THEMES_DIR, '_light.css'));
    const tiers = ['--color-text', '--color-text-muted', '--color-text-secondary', '--color-text-dull']
      .map((t) => ({ t, hex: declaredToken(css, t) }))
      .filter((x) => x.hex);
    expect(tiers.length).toBe(4);

    for (let i = 1; i < tiers.length; i += 1) {
      expect(
        luminance(tiers[i].hex),
        `${tiers[i].t} (${tiers[i].hex}) must be lighter than ${tiers[i - 1].t} (${tiers[i - 1].hex})`
      ).toBeGreaterThan(luminance(tiers[i - 1].hex));
    }
  });

  it('finds the swatches it claims to check (anti-vacuity)', () => {
    const onboarding = read(ONBOARDING);
    const checked = themeFiles().filter((t) => new RegExp(`\\.swatch-${t.name}\\s*\\{`, 'i').test(onboarding));
    expect(checked.length).toBeGreaterThanOrEqual(4);
    expect(checked.map((t) => t.name)).toContain('light');
  });
});
