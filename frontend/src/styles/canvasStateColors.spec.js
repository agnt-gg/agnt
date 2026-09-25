import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * CANVAS SELECTION vs SUCCESS
 *
 * A selected workflow node was bordered in --color-primary and a node that had
 * run successfully in --color-green. Five themes (dark, cyberpunk, hacker and
 * both everforest variants) define primary AS that green, so "I clicked this"
 * and "this ran" were the same pixel. Now both are semantic tokens and every
 * theme is measured: the two must be perceptibly different (CIE76 ΔE ≥ 30;
 * nord, which looked fine, sits at 36).
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(HERE, p), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const readVar = (css, name) => {
  const re = new RegExp(`--${name}\\s*:\\s*([^;]+);`, 'g');
  let last = null;
  let m;
  while ((m = re.exec(css))) last = m[1].trim();
  return last;
};
const blockFor = (css, selector) => {
  const i = css.indexOf(selector + ' {');
  if (i === -1) return '';
  const start = css.indexOf('{', i);
  for (let depth = 0, j = start; j < css.length; j++) {
    if (css[j] === '{') depth++;
    else if (css[j] === '}' && --depth === 0) return css.slice(start + 1, j);
  }
  return '';
};

const base = read('base/_variables.css');
const semantic = read('themes/_semantic.css');
const semanticBody = blockFor(semantic, 'body');
const dark = read('themes/_dark.css');

// [theme, own layer, dark-based?] — own layer first, as its selector is the most specific.
const THEMES = [
  ['dark', dark, true],
  ['light', read('themes/_light.css'), false],
  ['rose', read('themes/_rose.css'), false],
  ['ember', read('themes/_ember.css'), true],
  ['nord', read('themes/_nord.css'), true],
  ['midnight', read('themes/_midnight.css'), true],
  ['hacker', read('themes/_hacker.css'), true],
  ['cyberpunk', read('themes/_cyberpunk.css'), true],
  ['everforest-dark', blockFor(read('themes/_everforest.css'), 'body.dark.everforest'), true],
  ['everforest-light', blockFor(read('themes/_everforest.css'), 'body.everforest:not(.dark)'), false],
];

function resolve(own, isDark, token) {
  const layers = [own, isDark ? dark : '', semanticBody, base];
  const lookup = (name) => layers.map((layer) => readVar(layer, name)).find(Boolean) || null;
  let value = lookup(token);
  for (let hop = 0; hop < 8 && value; hop++) {
    if (value.startsWith('#')) {
      const h = value.slice(1);
      const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
      return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
    }
    const ref = value.match(/var\(\s*--([\w-]+)/);
    value = ref ? lookup(ref[1]) : null;
  }
  return null;
}

function deltaE(a, b) {
  const lab = (rgb) => {
    const lin = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    const [r, g, bl] = rgb.map(lin);
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const x = f((r * 0.4124 + g * 0.3576 + bl * 0.1805) / 0.95047);
    const y = f(r * 0.2126 + g * 0.7152 + bl * 0.0722);
    const z = f((r * 0.0193 + g * 0.1192 + bl * 0.9505) / 1.08883);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  };
  const [p, q] = [lab(a), lab(b)];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

const MIN_DELTA_E = 30;

describe('workflow canvas: selected vs succeeded', () => {
  it('resolves both tokens in every theme', () => {
    for (const [name, own, isDark] of THEMES) {
      expect(resolve(own, isDark, 'canvas-selected'), `${name} --canvas-selected`).toBeTruthy();
      expect(resolve(own, isDark, 'canvas-success'), `${name} --canvas-success`).toBeTruthy();
    }
  });

  it('keeps selection visibly different from success in every theme', () => {
    const tooClose = THEMES.map(([name, own, isDark]) => [name, deltaE(resolve(own, isDark, 'canvas-selected'), resolve(own, isDark, 'canvas-success'))])
      .filter(([, d]) => d < MIN_DELTA_E)
      .map(([name, d]) => `${name}: ΔE ${d.toFixed(1)}`);
    expect(tooClose).toEqual([]);
  });

  it('has teeth: primary-as-selection would fail on the dark theme', () => {
    expect(deltaE(resolve(dark, true, 'color-primary'), resolve(dark, true, 'canvas-success'))).toBeLessThan(1);
  });

  it('leaves themes whose primary was already distinct on their primary', () => {
    for (const [name, own, isDark] of THEMES.filter(([n]) => ['light', 'rose', 'midnight', 'ember', 'nord'].includes(n))) {
      expect(resolve(own, isDark, 'canvas-selected'), name).toEqual(resolve(own, isDark, 'color-primary'));
    }
  });

  it('the node component paints with the tokens, not the raw palette', () => {
    const node = fs.readFileSync(
      path.join(HERE, '../views/Terminal/CenterPanel/screens/WorkflowForge/components/WorkflowDesigner/components/Canvas/components/Node/Node.vue'),
      'utf8'
    );
    expect(node).toMatch(/\.node\.selected \{\s*border: 3px solid var\(--canvas-selected\)/);
    expect(node).toMatch(/\.node\.has-output \{\s*border: 3px solid var\(--canvas-success\)/);
    expect(node).not.toMatch(/isSelected \? '[^']*--color-primary/);
  });
});
