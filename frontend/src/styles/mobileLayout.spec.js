/**
 * Static guards for the mobile layout fixes.
 *
 * jsdom has no layout engine, so the real verification for these is a headless
 * Chrome probe (projects/agnt-remote/probe-final.mjs) measuring actual boxes on
 * three device viewports. What this file pins is the class of mistake that
 * actually happened while building them — each one shipped, looked plausible in
 * the source, and did nothing at all:
 *
 *   1. The narrow-viewport rules were written in CanvasScreen's SECOND,
 *      UNSCOPED <style> block. Vue appends [data-v-*] to scoped selectors,
 *      which ADDS specificity, so `.cv-sidebar.expanded` (0,2,0) in the global
 *      block silently lost to `.cv-sidebar.expanded[data-v-*]` (0,3,0) and the
 *      120px rail stayed at 120px on a 390px phone.
 *
 *   2. `.main-panel` kept `min-width: 320px` on mobile. min-width beats width,
 *      !important or not, so the panel overflowed every viewport under 320px of
 *      available space and carried the send button off-screen.
 *
 *   3. Safe-area padding was declared on `.main-panel`, where fourteen
 *      `body[data-page='...'] .main-panel` rules (0,2,0) outrank it (0,1,0).
 *      Every inset was dead on arrival.
 *
 * All three are statically checkable, so they are checked statically.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..');

const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

const MOBILE_QUERY = /@media\s*\(\s*max-width:\s*800px\s*\)/;

/**
 * The narrow-viewport block's own banner — the ═-ruled section header, not the
 * words inside it.
 *
 * Anchoring on the bare phrase made these guards decidable by prose: the
 * script half of CanvasScreen.vue legitimately cross-references this block by
 * name (the tooltip suppression reads the same 800px breakpoint), which made
 * the count 2 and put the "first occurrence" above `<style scoped>`, failing
 * both guards below on a file where nothing was wrong.
 *
 * This is the same mistake three other assertions in this file already carry a
 * note about — ruleBody strips comments, the 100vh chain strips comments, and
 * the viewport meta is parsed rather than searched. A guard a comment can fail
 * is a guard that punishes documentation, so it gets written out of the file
 * rather than worked around. A row of ═ cannot appear in prose by accident.
 */
const NARROW_BANNER = /═+\s*NARROW VIEWPORTS\s*═+/;
const NARROW_BANNER_G = new RegExp(NARROW_BANNER.source, 'g');

describe('CanvasScreen narrow-viewport rules', () => {
  const file = read('canvas/CanvasScreen.vue');

  it('has exactly one narrow-viewport block', () => {
    expect((file.match(NARROW_BANNER_G) || []).length).toBe(1);
  });

  it('counts the block, not prose that refers to it', () => {
    // Anti-vacuity for the locator itself: a cross-reference must not register
    // as a second block, or documenting the breakpoint breaks the build.
    expect(NARROW_BANNER.test('see the NARROW VIEWPORTS block in the stylesheet')).toBe(false);
    expect(NARROW_BANNER.test('/* \u2550\u2550\u2550 NARROW VIEWPORTS \u2550\u2550\u2550 */')).toBe(true);
  });

  it('places that block inside the SCOPED style block, not the global one', () => {
    const scopedOpen = file.indexOf('<style scoped>');
    const scopedClose = file.indexOf('</style>', scopedOpen);
    const blockAt = file.search(NARROW_BANNER);

    expect(scopedOpen).toBeGreaterThan(-1);
    expect(blockAt).toBeGreaterThan(scopedOpen);
    // The whole point: it must close before the scoped block ends, so Vue
    // appends [data-v-*] and the selector can win on specificity.
    expect(blockAt).toBeLessThan(scopedClose);
  });

  it('collapses the rail regardless of the persisted expanded state', () => {
    // EOL-agnostic: this file is CRLF, so any pattern containing a bare \n
    // silently matches nothing.
    const block = file.slice(file.search(NARROW_BANNER)).replace(/\r\n/g, '\n');
    const rule = /\.cv-sidebar,\s*\n\s*\.cv-sidebar\.expanded\s*\{([^}]*)\}/.exec(block);
    expect(rule, 'combined .cv-sidebar/.cv-sidebar.expanded rule not found').not.toBeNull();
    expect(rule[1]).toMatch(/width:\s*44px/);
    expect(rule[1]).toMatch(/min-width:\s*44px/);
  });

  it('grows the toolbar as well as the tab strip', () => {
    // A 44px strip centred in a 33px toolbar resolves to top:-6px and pushes
    // the tab above the viewport — which is exactly what happened.
    const block = file.slice(file.search(NARROW_BANNER));
    expect(block).toMatch(/\.cv-toolbar\s*\{[^}]*min-height:\s*44px/);
    expect(block).toMatch(/\.cv-nav-panels\s*\{[^}]*min-height:\s*44px/);
  });
});

describe('BaseScreen mobile block', () => {
  const file = read('views/Terminal/CenterPanel/BaseScreen.vue').replace(/\r\n/g, '\n');
  const mobileBlockStart = file.search(MOBILE_QUERY);
  const mobileBlock = file.slice(mobileBlockStart, mobileBlockStart + 4000);

  /**
   * Extract one rule's declarations by selector.
   *
   * Searching the whole mobile block for a declaration is not good enough: an
   * earlier version of this file asserted `min-width: 0` against the block and
   * was satisfied by an unrelated rule, so it passed with `min-width: 320px`
   * still on .main-panel. Negative control NC11 caught it.
   */
  const ruleBody = (selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // The selector may be the first rule inside the media query (preceded by
    // `{`), or follow a previous rule (`}`), or a selector list (`,`) — and is
    // always indented.
    const re = new RegExp(`(?:^|[{},])\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm');
    const m = re.exec(mobileBlock);
    if (!m) return null;
    // Strip comments. Twice while writing these tests an assertion was decided
    // by prose in a comment rather than by a declaration (a rationale
    // mentioning `min-width: 320px`, and one mentioning `maximum-scale`).
    // This extractor returns declarations only.
    return m[1].replace(/\/\*[\s\S]*?\*\//g, '');
  };

  it('has a max-width:800px block', () => {
    expect(mobileBlockStart).toBeGreaterThan(-1);
  });

  it('releases .main-panel min-width (min-width outranks width)', () => {
    const body = ruleBody('.main-panel');
    expect(body, '.main-panel rule not found in the mobile block').not.toBeNull();
    expect(body).toMatch(/min-width:\s*0\s*;/);
    expect(body).not.toMatch(/min-width:\s*[1-9]/);
  });

  it('makes .main-panel border-box so its padding cannot overflow height:100%', () => {
    const body = ruleBody('.main-panel');
    expect(body).toMatch(/box-sizing:\s*border-box/);
    expect(body).toMatch(/height:\s*100%/);
  });

  it('declares safe-area insets on .input-container, NOT .main-panel', () => {
    // .main-panel is outranked by body[data-page='...'] .main-panel, so insets
    // declared there never apply on any real page.
    expect(ruleBody('.input-container')).toMatch(/env\(safe-area-inset-bottom\)/);
    expect(ruleBody('.main-panel')).not.toMatch(/env\(safe-area-inset/);
  });

  it('wraps the composer so the text field is not squeezed by the action buttons', () => {
    expect(mobileBlock).toMatch(/\.input-line\s*\{[^}]*flex-wrap:\s*wrap/);
    expect(mobileBlock).toMatch(/\.input-line \.input-highlight-container\s*\{[^}]*flex:\s*1 1 100%/);
  });
});

describe('touch-target floor', () => {
  const touch = read('styles/utilities/_touch.css');
  const main = read('styles/main.css');

  it('is imported by main.css', () => {
    expect(main).toMatch(/@import\s+'\.\/utilities\/_touch\.css'/);
  });

  it('cannot affect desktop: every declaration sits inside a max-width query', () => {
    // Strip comments, then assert there is no rule outside the media block.
    const noComments = touch.replace(/\/\*[\s\S]*?\*\//g, '');
    const firstQuery = noComments.search(MOBILE_QUERY);
    expect(firstQuery).toBeGreaterThan(-1);

    const beforeQuery = noComments.slice(0, firstQuery);
    expect(beforeQuery.trim()).toBe('');

    // Balance braces from the query onward: the file must be one closed block.
    const rest = noComments.slice(firstQuery);
    let depth = 0;
    let closedAt = -1;
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '{') depth++;
      else if (rest[i] === '}') {
        depth--;
        if (depth === 0) { closedAt = i; break; }
      }
    }
    expect(closedAt).toBeGreaterThan(-1);
    expect(rest.slice(closedAt + 1).trim()).toBe('');
  });

  it('floors both dimensions', () => {
    expect(touch).toMatch(/min-height:\s*40px/);
    expect(touch).toMatch(/min-width:\s*40px/);
  });

  it('exempts the autosizing composer textarea from the height floor', () => {
    // A min-height on a growing textarea fights the autosize logic and pins it
    // open; the composer owns its own height.
    expect(touch).toMatch(/textarea\s*\{[^}]*min-height:\s*0/);
  });
});

/**
 * The viewport-height chain.
 *
 * `100vh` is the LARGE viewport. Every full-height shell in this app is
 * `overflow: hidden`, so the 56-115px it over-measures by is not scrollable:
 * it lands at the bottom of the column and eats the bottom-most child, which
 * in every one of these shells is the composer. That is the entire bug, and it
 * shipped independently in seven files because each one spelled its own height
 * out by hand — three of them had even hand-rolled a `100vh; 100dvh` fallback
 * pair, i.e. three private copies of a token.
 *
 * So: one token, `--app-height`, and a list of the shells that must consume
 * it. Adding a shell to this app means adding it here, on purpose.
 */
describe('viewport height chain', () => {
  const layout = read('styles/base/_layout.css');

  /** Declarations of one rule, comments stripped. */
  const ruleBodyIn = (css, selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = new RegExp(`(?:^|[{}])\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(
      css.replace(/\r\n/g, '\n')
    );
    // Every rationale below mentions `100vh` in prose. An assertion decided by
    // a comment is an assertion that passes after the fix is reverted.
    return m ? m[1].replace(/\/\*[\s\S]*?\*\//g, '') : null;
  };

  it('declares the token as a vh -> svh -> dvh fallback chain, in that order', () => {
    const root = ruleBodyIn(layout, ':root');
    expect(root, ':root block not found in _layout.css').not.toBeNull();
    const units = [...root.matchAll(/--app-height:\s*100(vh|svh|dvh)\s*;/g)].map((m) => m[1]);
    // Later declaration wins if the engine understands the unit, so the order
    // IS the preference. Reversed, every modern browser would get 100vh.
    expect(units).toEqual(['vh', 'svh', 'dvh']);
  });

  /**
   * [file, selector] — every box that is sized to the viewport.
   */
  const SHELLS = [
    ['styles/base/_layout.css', 'body'],
    ['views/_components/layout/TerminalLayout.vue', '.terminal-container'],
    ['views/MobileLite/MobileChat.vue', '.ml-chat'],
    ['views/MobileLite/MobileHome.vue', '.ml-screen'],
    ['views/MobileLite/MobilePair.vue', '.ml-pair'],
    ['views/Pair/Pair.vue', '.pair-screen'],
    ['views/_components/utility/OAuthCallback.vue', '.oauth-callback'],
  ];

  it('covers every known shell (anti-vacuity)', () => {
    expect(SHELLS.length).toBe(7);
  });

  it.each(SHELLS)('%s %s sizes itself with var(--app-height)', (file, selector) => {
    const body = ruleBodyIn(read(file), selector);
    expect(body, `${selector} rule not found in ${file}`).not.toBeNull();
    expect(body).toMatch(/(?:^|\s)(?:min-)?height:\s*var\(--app-height\)/);
    // No private copy of the token alongside the token.
    expect(body).not.toMatch(/(?:^|\s)(?:min-)?height:\s*100[sd]?vh/);
  });

  it('does not size the lite chat shell with inset: 0', () => {
    // A fixed box resolves `bottom: 0` against the initial containing block,
    // which on mobile is the large viewport — the token cannot help a rule
    // that never asks for a height.
    const body = ruleBodyIn(read('views/MobileLite/MobileChat.vue'), '.ml-chat');
    expect(body).not.toMatch(/inset:\s*0/);
  });

  it('sizes <html> on the lite route, which height:100% cannot do', () => {
    const file = read('views/MobileLite/MobileChat.vue');
    expect(ruleBodyIn(file, 'html.mobile-lite-shell')).toMatch(/height:\s*var\(--app-height\)/);
  });

  it('installs the visualViewport refinement before mount', () => {
    // iOS never shrinks the layout viewport for its keyboard, so dvh alone
    // cannot see it. After mount is too late: the shells paint first.
    const main = read('main.js');
    const install = main.indexOf('installAppHeight()');
    const mount = main.indexOf("app.mount('#app')");
    expect(install).toBeGreaterThan(-1);
    expect(mount).toBeGreaterThan(-1);
    expect(install).toBeLessThan(mount);
  });
});

describe('PWA shell', () => {
  const html = fs.readFileSync(path.resolve(SRC, '..', 'index.html'), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(path.resolve(SRC, '..', 'public', 'manifest.webmanifest'), 'utf8'));

  // Assert against the meta tag's own content, not the whole file: the
  // surrounding comment explains why maximum-scale is absent, and a
  // whole-file search for "maximum-scale" therefore matches the explanation.
  const viewport = /<meta\s+name="viewport"\s+content="([^"]+)"/.exec(html)?.[1] ?? '';

  it('sets viewport-fit=cover, without which every env(safe-area-inset-*) is 0', () => {
    expect(viewport).toContain('viewport-fit=cover');
  });

  it('lets the on-screen keyboard resize the layout viewport', () => {
    // Chrome's default is resizes-visual: the keyboard shrinks only the visual
    // viewport, 100dvh keeps its full value, and the composer sits behind the
    // keys. Ignored by engines that do not know it.
    expect(viewport).toContain('interactive-widget=resizes-content');
  });

  it('does not block pinch-zoom', () => {
    expect(viewport).not.toContain('maximum-scale');
    expect(viewport).not.toContain('user-scalable=no');
  });

  it('links the manifest and an apple-touch-icon', () => {
    expect(html).toMatch(/rel="manifest"/);
    expect(html).toMatch(/rel="apple-touch-icon"/);
  });

  it('ships a standalone manifest with a maskable icon', () => {
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/chat');
    expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true);
  });

  it('references icons that actually exist on disk', () => {
    for (const icon of manifest.icons) {
      const p = path.resolve(SRC, '..', 'public', icon.src.replace(/^\//, ''));
      expect(fs.existsSync(p), `${icon.src} missing`).toBe(true);
    }
    const touchIcon = /rel="apple-touch-icon" href="([^"]+)"/.exec(html)[1];
    expect(fs.existsSync(path.resolve(SRC, '..', 'public', touchIcon.replace(/^\//, '')))).toBe(true);
  });
});
