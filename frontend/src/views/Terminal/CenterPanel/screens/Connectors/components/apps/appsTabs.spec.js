import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'apps-ui.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rule = (selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] || '';
};

// Asserted on the stylesheet because jsdom computes no layout. Measured at
// 390px before the fix: seven tabs shrank to 40-59px for labels that need
// 58-149px, and ran over one another.
describe('Apps tabs on a narrow screen', () => {
  it('scroll sideways instead of squeezing', () => {
    expect(rule('.apps-studio .ap-tabs')).toMatch(/overflow-x:\s*auto/);
    expect(rule('.apps-studio .ap-tabs')).not.toMatch(/flex-wrap:\s*wrap/);
  });

  it('every tab keeps the width of its label', () => {
    const tab = rule('.apps-studio .ap-tab');
    expect(tab).toMatch(/flex:\s*none/);
    expect(tab).toMatch(/white-space:\s*nowrap/);
  });
});
