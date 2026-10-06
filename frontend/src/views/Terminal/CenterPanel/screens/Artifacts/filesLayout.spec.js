/**
 * Files page layout: the toolbar is fixed chrome and only the file area
 * scrolls. The whole page used to scroll, and its flex sections could shrink,
 * so list view (overflow: hidden) was squeezed: header clipped, rows clipped,
 * nothing to scroll. jsdom has no layout, so this pins the structure and CSS.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'components/FilesBrowser.vue'), 'utf8');
const template = src.slice(0, src.indexOf('<script'));
const css = src.slice(src.indexOf('<style')).replace(/\/\*[\s\S]*?\*\//g, '');
const rule = (selector) => css.match(new RegExp(`(^|\\n)${selector.replace(/[.>*]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[2] ?? null;

describe('Files layout', () => {
  it('the page itself does not scroll; one inner area does', () => {
    expect(rule('.fb')).toMatch(/overflow:\s*hidden/);
    expect(rule('.fb > .fb-scroll')).toMatch(/overflow-y:\s*auto/);
    expect(rule('.fb > .fb-scroll')).toMatch(/min-height:\s*0/);
  });

  it('toolbar and breadcrumbs sit outside the scroll area; grid and list inside it', () => {
    const scrollAt = template.indexOf('class="fb-scroll"');
    expect(template.indexOf('<ScreenToolbar')).toBeLessThan(scrollAt);
    expect(template.indexOf('class="fb-crumbs"')).toBeLessThan(scrollAt);
    expect(template.indexOf('class="fb-grid"')).toBeGreaterThan(scrollAt);
    expect(template.indexOf('class="fb-list"')).toBeGreaterThan(scrollAt);
  });

  it('nothing in the page or the scroll area is allowed to shrink (that clipped the list)', () => {
    expect(rule('.fb > *')).toMatch(/flex:\s*none/);
    expect(rule('.fb-scroll > *')).toMatch(/flex:\s*none/);
  });
});
