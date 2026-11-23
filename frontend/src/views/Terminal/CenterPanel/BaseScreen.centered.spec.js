// The page column never centres down: a tall page would start above the top of its scroll
// area (out of reach) and a short one would float in the middle (Settings sections in One).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'BaseScreen.vue'), 'utf8');
const style = SRC.slice(SRC.indexOf('<style'));
const rules = [...style.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => [selector.trim(), body]);

describe('the page column with both side panels hidden', () => {
  it('is one rule, top-aligned and centred across', () => {
    const centered = rules.filter(([selector]) => selector.endsWith('.main-panel.centered-content .scrollable-content'));
    expect(centered).toHaveLength(1);
    expect(centered[0][1]).toMatch(/justify-content:\s*flex-start/);
    expect(centered[0][1]).toMatch(/align-items:\s*center/);
  });

  it('no rule centres the scroll area down', () => {
    const down = rules.filter(([selector, body]) => /\.scrollable-content$/.test(selector) && /justify-content:\s*(center|space-around|space-evenly)/.test(body));
    expect(down.map(([selector]) => selector)).toEqual([]);
  });
});
