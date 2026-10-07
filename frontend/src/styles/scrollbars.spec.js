/**
 * AGNT hides vertical scrollbars and shows horizontal ones.
 *
 * Everything scrolls by wheel, trackpad, touch and keyboard, but most mice
 * have no sideways wheel: a wide table or code block is only reachable by its
 * horizontal bar. The previous rule, scrollbar-width: none !important, hid
 * both axes and stranded every wide table.
 *
 * Chromium ignores ::-webkit-scrollbar on any element whose scrollbar-width or
 * scrollbar-color is not auto, so the global rule pins both to auto and draws
 * the bar with ::-webkit-scrollbar: zero width (vertical hidden, !important so
 * no page brings a vertical bar back), a thin height (horizontal shown, not
 * !important so a fading strip can opt out with display: none).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

function* styleFiles(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* styleFiles(path);
    else if (/\.(css|vue)$/.test(name)) yield path;
  }
}
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '');
const layout = stripComments(readFileSync(join(SRC, 'styles/base/_layout.css'), 'utf8'));
const globalRule = (selector) => {
  const match = new RegExp(`(?:^|\\})\\s*${selector.replace(/[*:-]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(layout);
  return match ? match[1] : '';
};

describe('scrollbars: vertical hidden, horizontal shown', () => {
  it('pins the standard properties to auto, so ::-webkit-scrollbar is honoured', () => {
    const all = globalRule('*');
    expect(all).toMatch(/scrollbar-width:\s*auto\s*!important/);
    expect(all).toMatch(/scrollbar-color:\s*auto\s*!important/);
  });

  it('hides the vertical bar for good and draws the horizontal one', () => {
    const bar = globalRule('*::-webkit-scrollbar');
    expect(bar).toMatch(/width:\s*0\s*!important/);
    const height = /(?:^|[;\s])height:\s*([^;]+);/.exec(bar);
    expect(height, 'global ::-webkit-scrollbar must set a height').not.toBeNull();
    expect(height[1].trim()).not.toMatch(/^0(px)?$/);
    // Not !important, and no global display: none — a fading strip must be able to opt out.
    expect(height[1]).not.toMatch(/!important/);
    expect(bar).not.toMatch(/display:\s*none/);
  });

  it('no element uses overflow: scroll, which draws an empty horizontal track', () => {
    const offenders = [];
    for (const file of styleFiles(SRC)) {
      const rel = relative(SRC, file).replace(/\\/g, '/');
      // The named .overflow-scroll utility is the one deliberate exception.
      if (rel === 'styles/utilities/_utilities.css') continue;
      const text = stripComments(readFileSync(file, 'utf8'));
      if (/overflow(?:-x)?:\s*scroll\b/.test(text)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});
