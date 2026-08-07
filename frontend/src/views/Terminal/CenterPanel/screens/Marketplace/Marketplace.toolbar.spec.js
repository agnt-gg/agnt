/**
 * MARKETPLACE TOOLBAR — chrome must stay OUT of the scroll container.
 *
 * ---------------------------------------------------------------------------
 * THE DEFECT
 * ---------------------------------------------------------------------------
 * The toolbar used to sit inside <main class="marketplace-main-content"> as a
 * `position: sticky` bar that hid the cards passing under it by painting
 * `background: var(--color-background)`.
 *
 * store/app/theme.js sets `--color-background: transparent` on <body> whenever
 * a custom background is active, so the wallpaper can show through the app.
 * The bar therefore became literal glass in that mode and the entire card grid
 * scrolled visibly through it.
 *
 * Painting a solid colour instead is NOT the fix — it covers the wallpaper,
 * which is the thing the transparency exists to reveal. The requirement is
 * "clip the content, keep the bar transparent", and a pinned element cannot
 * clip what scrolls behind it. Measured, not assumed:
 *
 *   - `mask-image` on the scroller erases the top band AND the sticky bar
 *     inside it; a mask applies to the element's whole painted group.
 *   - a `position: fixed` child does not escape that mask either.
 *   - `backdrop-filter: opacity(0)` is a no-op here even with the screen root
 *     declaring `isolation: isolate` (sampled pixels identical to the control).
 *
 * The only mechanism left is the correct one: chrome does not belong in the
 * scroll flow. Outside the scroller, `overflow` clips the cards at the
 * element boundary for free and the bar needs no background at all.
 *
 * These are source assertions rather than a mount: the defect is a
 * relationship between the template's structure and the stylesheet, and it
 * reproduces only under a runtime CSS variable that jsdom does not model.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'Marketplace.vue');
const src = fs.readFileSync(FILE, 'utf8');

const stripCssComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const css = stripCssComments(
  [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n')
);
/** Template block = everything before the <script>. Avoids nested <template>. */
const template = src.slice(0, src.indexOf('<script')).replace(/<!--[\s\S]*?-->/g, '');

const ruleBody = (selector) => {
  const re = new RegExp(`(?:^|[}\\s])${selector.replace(/\./g, '\\.')}\\s*\\{([^{}]*)\\}`);
  const m = re.exec(css);
  return m ? m[1] : null;
};

describe('marketplace toolbar placement', () => {
  it('renders outside the scroll container', () => {
    const slot = template.indexOf('class="mk-toolbar-slot"');
    const toolbar = template.indexOf('class="mk-toolbar"');
    const scroller = template.indexOf('class="marketplace-main-content"');

    // Negative control: all three must exist, or the ordering below is vacuous.
    expect(slot, 'mk-toolbar-slot missing from template').toBeGreaterThan(-1);
    expect(toolbar, 'mk-toolbar missing from template').toBeGreaterThan(-1);
    expect(scroller, 'marketplace-main-content missing from template').toBeGreaterThan(-1);

    expect(slot, 'the toolbar slot must precede <main>').toBeLessThan(scroller);
    expect(toolbar, 'the toolbar must precede <main>').toBeLessThan(scroller);
  });

  it('declares no background of its own', () => {
    // The whole point: the canvas (and any wallpaper) shows through untouched.
    const body = ruleBody('.mk-toolbar');
    expect(body, '.mk-toolbar rule not found').toBeTruthy();
    expect(body).not.toMatch(/(?:^|[;{\s])background(?:-color)?\s*:/);
  });

  it('is not sticky or fixed, so nothing can pass behind it', () => {
    const body = ruleBody('.mk-toolbar');
    expect(body).not.toMatch(/(?:^|[;{\s])position\s*:\s*(?:sticky|fixed)/);
  });

  it('compensates exactly the scrollbar the scroller always shows', () => {
    // The scroller is `overflow-y: scroll !important`, so its scrollbar is
    // permanent and its width is deterministic. The slot sits OUTSIDE that
    // element and must subtract the same amount, or the bar centres on a wider
    // axis than the grid and lands half a scrollbar to the right of the cards.
    const bar = /(?:^|[}\s])\.marketplace-main-content::-webkit-scrollbar\s*\{([^{}]*)\}/.exec(css);
    expect(bar, 'scrollbar rule not found').toBeTruthy();
    const scrollbarWidth = /width\s*:\s*(\d+)px/.exec(bar[1])[1];

    const slot = ruleBody('.mk-toolbar-slot');
    expect(slot, '.mk-toolbar-slot rule not found').toBeTruthy();
    const pad = /padding-right\s*:\s*(\d+)px/.exec(slot);
    expect(pad, '.mk-toolbar-slot must compensate the scrollbar').toBeTruthy();
    expect(pad[1]).toBe(scrollbarWidth);
  });

  it('matches the max-width the scroller gives its own children', () => {
    const childWidth = /\.marketplace-main-content > \*\s*\{([^{}]*)\}/.exec(css);
    expect(childWidth, 'scroller child rule not found').toBeTruthy();
    const expected = /max-width\s*:\s*(\d+)px/.exec(childWidth[1])[1];
    expect(/max-width\s*:\s*(\d+)px/.exec(ruleBody('.mk-toolbar'))[1]).toBe(expected);
  });
});

describe('showToolbar', () => {
  it('reproduces the branch the toolbar used to be nested in', () => {
    // It was the v-else arm of activeTab==='my-earnings' / currentLayout==='table',
    // carrying its own v-if="!profileUserId". Outside <main> none of that is
    // implicit any more, so all three conditions must be stated.
    const decl = /const showToolbar = computed\(([\s\S]*?)\);/.exec(src);
    expect(decl, 'showToolbar computed not found').toBeTruthy();
    expect(decl[1]).toMatch(/activeTab\.value !== 'my-earnings'/);
    expect(decl[1]).toMatch(/currentLayout\.value !== 'table'/);
    expect(decl[1]).toMatch(/!profileUserId\.value/);
  });

  it('is exposed to the template and gates the slot', () => {
    expect(src).toMatch(/^\s*showToolbar,\s*$/m);
    expect(template).toMatch(/<div v-if="showToolbar" class="mk-toolbar-slot">/);
  });
});
