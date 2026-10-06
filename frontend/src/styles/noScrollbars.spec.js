/**
 * AGNT draws no scrollbars. Everything still scrolls; only the bar is hidden.
 *
 * The global default used to be a thin visible bar, so every new scrolling
 * area (an inspector, a picker, a nested pane) showed one unless it
 * remembered to opt out, and new pages kept forgetting. The rule is now one
 * global !important declaration in base/_layout.css. The only thing that can
 * beat it is another !important scrollbar-width with a real selector, so
 * none may exist.
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

describe('no visible scrollbars', () => {
  it('hides every scrollbar globally, with !important', () => {
    const layout = stripComments(readFileSync(join(SRC, 'styles/base/_layout.css'), 'utf8'));
    expect(layout).toMatch(/\*\s*\{\s*scrollbar-width:\s*none\s*!important;?\s*\}/);
    expect(layout).toMatch(/\*::-webkit-scrollbar\s*\{[^}]*display:\s*none\s*!important/);
  });

  it('nothing forces a bar back on', () => {
    const offenders = [];
    for (const file of styleFiles(SRC)) {
      const text = stripComments(readFileSync(file, 'utf8'));
      if (/scrollbar-width:\s*(thin|auto)\s*!important/.test(text)) offenders.push(relative(SRC, file));
    }
    expect(offenders).toEqual([]);
  });
});
