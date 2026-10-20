/**
 * AGNT One under a custom background follows Studio's rule.
 *
 * Reported: with a custom background on, One's sidebar and frame sat on the
 * raw wallpaper. Studio's rule (styles/themes/_core.css): theme.js adds
 * body.custom-bg and makes --color-background transparent; each chrome
 * surface paints the theme colour at --bg-opacity, blurred by --bg-blur. One
 * painted nothing, so the rail, the Chats drawer, the top bar and every page
 * were unreadable; only Chat was tinted (by Studio's .main-panel rule).
 *
 * jsdom has no layout or paint, so this holds the rule at the source; the
 * look itself was checked in the shipped Electron 33.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const ONE = readFileSync(join(DIR, 'one.css'), 'utf8');
const CORE = readFileSync(join(DIR, '../../styles/themes/_core.css'), 'utf8');

/** Flat { selectors[], body } for every style rule, at any @-rule depth. */
function rulesOf(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  const stack = [];
  let buffer = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '{') {
      const head = buffer.trim();
      buffer = '';
      stack.push(head.startsWith('@') ? { at: true } : { head, start: i + 1 });
    } else if (ch === '}') {
      const open = stack.pop();
      if (open && !open.at) out.push({ selectors: open.head.split(',').map((s) => s.trim().replace(/\s+/g, ' ')), body: text.slice(open.start, i) });
      buffer = '';
    } else {
      buffer += ch;
    }
  }
  return out;
}
const decl = (body, prop) => body.match(new RegExp(`(?:^|[;\\s])${prop}\\s*:\\s*([^;]+)`))?.[1].trim() ?? null;
const ruleFor = (rules, selector) => rules.find((r) => r.selectors.includes(selector));

const ONE_RULES = rulesOf(ONE);
// Studio's panel glass, the one definition of what a panel looks like.
const STUDIO = ruleFor(rulesOf(CORE), 'body.custom-bg .main-panel');
const STUDIO_TINT = decl(STUDIO.body, 'background').replace(/\s*!important$/, '');
const STUDIO_BLUR = decl(STUDIO.body, 'backdrop-filter');

describe('AGNT One under a custom background', () => {
  it('reads Studio’s rule (anti-vacuity)', () => {
    expect(STUDIO_TINT).toMatch(/^rgba\(var\(--color-background-rgb[^)]*\), var\(--bg-opacity[^)]*\)\)$/);
    expect(STUDIO_BLUR).toMatch(/^blur\(var\(--bg-blur/);
  });

  it.each([
    ['the rail', 'body.custom-bg .ui-one .one-rail::before'],
    ['the Chats drawer', 'body.custom-bg .ui-one:not(.is-compact) .one-drawer::before'],
    ['the sheet (top bar and every page)', 'body.custom-bg .ui-one .one-main::before'],
  ])('%s paints Studio’s glass, once', (_name, selector) => {
    const rule = ruleFor(ONE_RULES, selector);
    expect(rule, selector).toBeTruthy();
    expect(decl(rule.body, 'background')).toBe(STUDIO_TINT);
    expect(decl(rule.body, 'backdrop-filter')).toBe(STUDIO_BLUR);
    expect(decl(rule.body, 'z-index')).toBe('-1');
    expect(decl(rule.body, 'pointer-events')).toBe('none');
  });

  // Any backdrop-filter other than none makes its element the containing
  // block of every position:fixed descendant; on the drawer that moved its
  // right-click menu (position:fixed at the pointer) off the pointer.
  it('no element in One carries a backdrop-filter itself; only a childless ::before does', () => {
    const offenders = ONE_RULES.flatMap((r) => {
      const value = decl(r.body, 'backdrop-filter');
      if (!value || value === 'none') return [];
      return r.selectors.filter((s) => !/::(before|after)$/.test(s));
    });
    expect(offenders).toEqual([]);
  });

  it('the panels of the screen inside the sheet add content only, so the wallpaper crosses one layer', () => {
    for (const panel of ['main-panel', 'left-panel', 'controls-panel']) {
      const rule = ruleFor(ONE_RULES, `body.custom-bg .ui-one .one-main .${panel}`);
      expect(rule, panel).toBeTruthy();
      expect(decl(rule.body, 'background')).toBe('transparent !important');
      expect(decl(rule.body, 'backdrop-filter')).toBe('none');
    }
  });

  it('the sheet floats with an even gutter on desktop, and goes edge to edge on a phone', () => {
    const desktop = ruleFor(ONE_RULES, 'body.custom-bg .ui-one:not(.is-compact) .one-main');
    expect(decl(desktop.body, 'margin')).toBe('8px');
    expect(ruleFor(ONE_RULES, 'body.custom-bg .ui-one .one-main::before')).toBeTruthy();
    // No custom-bg rule reaches the phone sheet's geometry (it keeps margin 0).
    expect(ONE_RULES.some((r) => r.selectors.some((s) => s.startsWith('body.custom-bg') && /\.ui-one\.is-compact[^,]*\.one-main/.test(s)))).toBe(false);
  });

  it('overlays over moving content stay solid', () => {
    for (const overlay of ['body.custom-bg .ui-one.is-compact .one-drawer', 'body.custom-bg .ui-one .chat-scroll-controls .scroll-btn']) {
      expect(decl(ruleFor(ONE_RULES, overlay).body, 'background'), overlay).toBe('rgb(var(--color-background-rgb, 0, 0, 0))');
    }
  });
});
