/**
 * Guard AGNT's base palette and theme RGB triplets against their matching colours.
 *
 * WHY
 * ───
 * AGNT carries two spellings of the same colour: `--color-green: #19ef83`
 * for solid use and `--green-rgb: 25, 239, 131` for existing
 * `rgba(var(--green-rgb), 0.1)` consumers. This guard checks that contract;
 * it does not change the palette or migrate consumers to newer CSS syntax.
 *
 * Two spellings of one value is a drift generator: change the hex, forget the
 * triplet, and every solid use of the colour moves while every translucent one
 * stays behind. Nothing in the app can notice — the page still renders.
 *
 * `themeCanvas.spec.js` already guards literal canvas pairs. Accents also
 * need protection, including root brand colours and light/dark aliases.
 * The bounded resolver below follows plain var(--token) chains in palette
 * maps, not arbitrary CSS expressions or the complete browser cascade.
 * Custom themes are checked for their own RGB declarations, not for missing
 * overrides of inherited RGB channels; default light/dark maps are checked in full.
 *
 * It also reads the file BLOCK BY BLOCK rather than taking the first or the
 * last declaration. A theme is free to carry more than one selector block —
 * a light face and a dark face in one file, say — and a whole-file regex
 * measures one of them and silently ignores the rest.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

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

/** Resolve only the plain token aliases used by these palette definitions. */
function resolveToken(name, tokens, seen = new Set()) {
  if (seen.has(name) || !Object.hasOwn(tokens, name)) throw new Error(`Unresolved palette token: ${name}`);
  seen.add(name);
  const value = tokens[name];
  const alias = value.match(/^var\(\s*(--[\w-]+)\s*\)$/);
  return alias ? resolveToken(alias[1], tokens, seen) : value;
}

function collectPairs() {
  const readBlocks = (file) => blocksOf(stripComments(fs.readFileSync(file, 'utf8')));
  const root = Object.assign({}, ...readBlocks(path.join(SRC, 'styles/base/_variables.css'))
    .filter((block) => block.selector === ':root').map((block) => block.tokens));
  const files = fs.readdirSync(THEMES_DIR).sort().filter((file) => file.endsWith('.css') && !NOT_A_PALETTE.has(file));
  const palettes = Object.fromEntries(files.map((file) => [file, readBlocks(path.join(THEMES_DIR, file))]));
  const defaults = (file, selector) => Object.assign({}, ...palettes[file]
    .filter((block) => block.selector === selector).map((block) => block.tokens));
  const dark = defaults('_dark.css', 'body.dark');
  const light = defaults('_light.css', 'body:not(.dark):not(.rose)');
  const contexts = [{ where: '_variables.css :root', tokens: root, declared: root }];
  for (const [file, blocks] of Object.entries(palettes)) {
    for (const { selector, tokens } of blocks) {
      // Only palette-bearing body blocks; do not pretend to evaluate descendant CSS.
      if (!Object.keys(tokens).some((name) => name.endsWith('-rgb'))) continue;
      if (!/^body(?:[.#:][\w().:-]+)*$/.test(selector)) throw new Error(`Unsupported palette selector: ${selector}`);
      const inherited = selector.includes(':not(.dark)') ? light : selector.includes('.dark') ? dark : {};
      const resolved = { ...root, ...inherited, ...tokens };
      contexts.push({ where: `${file} ${selector}`, tokens: resolved,
        declared: file === '_dark.css' || file === '_light.css' ? resolved : tokens });
    }
  }
  return contexts.flatMap(({ where, tokens, declared: declarations }) => Object.keys(declarations).filter((name) => name.endsWith('-rgb')).map((rgbToken) => {
    const hexToken = hexTokenFor(rgbToken);
    const rgbValue = resolveToken(rgbToken, tokens);
    const hexValue = resolveToken(hexToken, tokens);
    if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(hexValue)) throw new Error(`${where}: unsupported ${hexToken}: ${hexValue}`);
    const declared = rgbValue.split(',').map((channel) => channel.trim());
    if (declared.length !== 3 || !declared.every((channel) => /^\d+$/.test(channel) && Number(channel) <= 255)) {
      throw new Error(`${where}: invalid ${rgbToken}: ${rgbValue}`);
    }
    return { where, rgbToken, hexToken, declared: declared.map(Number), expected: hexToRgb(hexValue), hexValue };
  }));
}

const driftedPairs = (pairs) => pairs.filter((pair) => pair.declared.join() !== pair.expected.join());

/** Exercise the real collector without changing any stylesheet on disk. */
function withCssChange(relativePath, from, to, check) {
  const target = path.join(SRC, 'styles', relativePath);
  const read = fs.readFileSync.bind(fs);
  let applied = false;
  const spy = vi.spyOn(fs, 'readFileSync').mockImplementation((file, ...args) => {
    const css = read(file, ...args);
    if (path.resolve(String(file)) !== target) return css;
    if (!css.includes(from)) throw new Error(`Fixture no longer matches ${relativePath}`);
    applied = true;
    return css.replace(from, to);
  });
  try { check(); expect(applied).toBe(true); } finally { spy.mockRestore(); }
}

describe('theme rgb triplets', () => {
  const pairs = collectPairs();

  it('mirror the hex token they are decomposed from', () => {
    const drifted = driftedPairs(pairs)
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

  it('covers root brand colours and the default light/dark primary aliases', () => {
    for (const where of ['_variables.css :root', '_dark.css body.dark', '_light.css body:not(.dark):not(.rose)']) {
      for (const token of ['--green-rgb', '--primary-rgb']) {
        expect(pairs.some((pair) => pair.where === where && pair.rgbToken === token), `${where} ${token}`).toBe(true);
      }
    }
  });

  it.each(['base/_variables.css', 'themes/_dark.css', 'themes/_hacker.css'])('detects real collector drift in %s', (file) => {
    withCssChange(file, '--green-rgb: 25, 239, 131;', '--green-rgb: 1, 2, 3;', () => {
      expect(driftedPairs(collectPairs()).some((pair) => pair.where.startsWith(path.basename(file)) && pair.rgbToken === '--green-rgb')).toBe(true);
    });
  });

  it('detects a light primary alias pointing at the wrong hue', () => {
    withCssChange('themes/_light.css', '--primary-rgb: var(--pink-rgb);', '--primary-rgb: var(--green-rgb);', () => {
      expect(driftedPairs(collectPairs()).some((pair) => pair.where.startsWith('_light.css') && pair.rgbToken === '--primary-rgb')).toBe(true);
    });
  });

  it.each(['nope', '256, 239, 131', '25, 239', '-1, 239, 131'])('rejects malformed RGB: %s', (value) => {
    withCssChange('themes/_hacker.css', '--green-rgb: 25, 239, 131;', `--green-rgb: ${value};`, () => {
      expect(() => collectPairs()).toThrow('invalid --green-rgb');
    });
  });

  it.each(['var(--missing)', 'var(--color-green)', '#12345'])('rejects unresolved or malformed colour: %s', (value) => {
    withCssChange('base/_variables.css', '--color-green: #19ef83;', `--color-green: ${value};`, () => {
      expect(() => collectPairs()).toThrow();
    });
  });

  it('has teeth: a second selector block is not skipped', () => {
    withCssChange('themes/_hacker.css', 'body.dark.hacker {',
      'body.first { --color-green: #19ef83; --green-rgb: 25, 239, 131; } body.second { --color-green: #19ef83; --green-rgb: 1, 2, 3; } body.dark.hacker {', () => {
        expect(driftedPairs(collectPairs()).map((pair) => pair.where)).toContain('_hacker.css body.second');
      });
  });
});
