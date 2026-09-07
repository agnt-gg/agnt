/**
 * Guard: every hand-maintained rgb triplet still matches the hex it mirrors.
 *
 * WHY
 * ───
 * The themes carry two spellings of the same colour. `--color-green: #22c55e`
 * for `color:` and `border:`, and `--green-rgb: 34, 197, 94` so a rule can
 * write `rgba(var(--green-rgb), 0.1)` — CSS cannot take an alpha of a hex
 * token, so the triplet is decomposed by hand, in the file, next to the hex.
 *
 * Two spellings of one value is a drift generator: change the hex, forget the
 * triplet, and every solid use of the colour moves while every translucent one
 * stays behind. Nothing in the app can notice — the page still renders.
 *
 * `themeCanvas.spec.js` already pins exactly this invariant, but only for
 * `--color-background-rgb`. Measured across the theme files at the time of
 * writing: 50 rgb/hex pairs, of which 7 were guarded. The other 43 were not,
 * and they are not obscure — `--green-rgb` is consumed in 132 files and
 * `--primary-rgb` in 74. This closes that gap for all of them.
 *
 * It also reads the file BLOCK BY BLOCK rather than taking the first or the
 * last declaration. A theme is free to carry more than one selector block —
 * a light face and a dark face in one file, say — and a whole-file regex
 * measures one of them and silently ignores the rest.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const THEMES_DIR = path.join(SRC, 'styles', 'themes');

/* Files that define no palette of their own: aliases, shared scaffolding, and
   the semantic layer that maps roles onto whatever a theme declared. */
const NOT_A_PALETTE = new Set(['_aliases.css', '_core.css', '_semantic.css']);

/** A declaration inside a comment is documentation, not a colour. */
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

const hexToRgb = (hex) => {
  const s = hex.slice(1);
  const full = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
};

/** `--x-rgb` mirrors `--x`, except the ones whose names disagree by history. */
const hexTokenFor = (rgbToken) => {
  const stem = rgbToken.replace(/-rgb$/, '');
  return stem.startsWith('--color-') ? stem : `--color-${stem.slice(2)}`;
};

/** Every `selector { ... }` block, as its own token map. */
function blocksOf(css) {
  const blocks = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const tokens = {};
    for (const [, name, value] of m[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      tokens[name] = value.trim();
    }
    if (Object.keys(tokens).length) blocks.push({ selector: m[1].trim().replace(/\s+/g, ' '), tokens });
  }
  return blocks;
}

/** Every (rgb token, hex token) pair the theme files actually declare together. */
function collectPairs(dir = THEMES_DIR) {
  const pairs = [];
  for (const file of fs.readdirSync(dir).sort()) {
    if (!file.endsWith('.css') || NOT_A_PALETTE.has(file)) continue;
    const css = stripComments(fs.readFileSync(path.join(dir, file), 'utf8'));
    for (const { selector, tokens } of blocksOf(css)) {
      for (const [rgbToken, rgbValue] of Object.entries(tokens)) {
        if (!rgbToken.endsWith('-rgb')) continue;
        const hexToken = hexTokenFor(rgbToken);
        const hexValue = tokens[hexToken];
        if (!hexValue || !/^#[0-9a-f]{3,6}$/i.test(hexValue)) continue;
        const declared = rgbValue.split(',').map((n) => n.trim());
        if (declared.length !== 3 || !declared.every((n) => /^\d+$/.test(n))) continue;
        pairs.push({
          where: `${file} ${selector}`,
          rgbToken,
          hexToken,
          declared: declared.map(Number),
          expected: hexToRgb(hexValue),
          hexValue,
        });
      }
    }
  }
  return pairs;
}

describe('theme rgb triplets', () => {
  const pairs = collectPairs();

  it('mirror the hex token they are decomposed from', () => {
    const drifted = pairs
      .filter((p) => p.declared.join() !== p.expected.join())
      .map((p) => `${p.where}: ${p.rgbToken} is ${p.declared.join(', ')} but ${p.hexToken} is ${p.hexValue} (${p.expected.join(', ')})`);
    expect(drifted, `\n${drifted.join('\n')}\n`).toEqual([]);
  });

  it('finds the pairs it claims to check, in more than one theme', () => {
    expect(pairs.length).toBeGreaterThanOrEqual(40);
    expect(new Set(pairs.map((p) => p.where.split(' ')[0])).size).toBeGreaterThanOrEqual(5);
  });

  it('covers the accent triplets, not only the canvas', () => {
    const covered = new Set(pairs.map((p) => p.rgbToken));
    for (const token of ['--color-background-rgb', '--green-rgb', '--primary-rgb', '--red-rgb']) {
      expect(covered, `${token} is consumed by rgba() rules but is not being checked`).toContain(token);
    }
  });

  it('has teeth: a drifted triplet is detected', () => {
    const blocks = blocksOf(stripComments('body.demo { --color-green: #22c55e; --green-rgb: 1, 2, 3; }'));
    const tokens = blocks[0].tokens;
    expect(hexToRgb(tokens['--color-green'])).toEqual([34, 197, 94]);
    expect(tokens['--green-rgb'].split(',').map((n) => Number(n.trim()))).not.toEqual([34, 197, 94]);
  });

  it('has teeth: a second selector block is not skipped', () => {
    const blocks = blocksOf(stripComments('body.a { --color-red: #ff0000; } body.b { --color-red: #00ff00; }'));
    expect(blocks).toHaveLength(2);
    expect(blocks[1].tokens['--color-red']).toBe('#00ff00');
  });
});
