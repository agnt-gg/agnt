/**
 * Focused layout invariants.
 *
 * Every Focused page is ONE width (Plugins' width). Pages were 880px with
 * Plugins alone overridden to 1204px, so moving between pages changed the
 * width every time. The width lives in one variable; no page may set its own.
 * Chat keeps its reading column, which is a different rule entirely.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(DIR, 'focused.css'), 'utf8');
const sidebar = readFileSync(join(DIR, 'FocusedSidebar.vue'), 'utf8');

/** [selector, body] for every rule in the file (no nesting in focused.css). */
const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]]);

describe('Focused page width', () => {
  it('is set once, from the shared variable, at the Plugins width', () => {
    expect(css).toMatch(/--focused-page-width:\s*1204px/);
    expect(css).toMatch(/--focused-page-gutter:\s*max\(32px,\s*calc\(\(100% - var\(--focused-page-width\)\) \/ 2 \+ 32px\)\)/);
  });

  // The page is the scroller, so it must span the pane: a capped, centred
  // scroller left the side space outside it and the wheel did nothing there.
  it('the page scroller spans the pane and makes its column with gutters', () => {
    const page = rules.find(([selector]) => selector === '.ui-focused .focused-page')[1];
    expect(page).toMatch(/overflow-y:\s*auto/);
    expect(page).toMatch(/width:\s*100%/);
    expect(page).toMatch(/padding:\s*36px var\(--focused-page-gutter\) 48px/);
    const capped = rules.filter(([selector, body]) => /\.focused-page(?![-\w])/.test(selector) && /(^|;)\s*(max-width|margin(-left|-right|-inline)?)\s*:/.test(body));
    expect(capped.map(([selector]) => selector)).toEqual([]);
  });

  // Every class that sits beside `focused-page` on a page root, read from the
  // templates so a new page is covered without editing this list. Market used
  // to cancel the width (max-width: none) and pad itself in to 1040px, which
  // a max-width-only check missed.
  const pageClasses = [...new Set(readdirSync(DIR).filter((f) => f.endsWith('.vue')).flatMap((f) =>
    [...readFileSync(join(DIR, f), 'utf8').matchAll(/class="([^"]*)"/g)]
      .map((m) => m[1].split(/\s+/))
      .filter((tokens) => tokens.includes('focused-page')) // the exact token, not focused-page-search
      .flat().filter((c) => /^focused-/.test(c) && c !== 'focused-page')))];

  it('finds the page classes it guards', () => {
    expect(pageClasses).toEqual(expect.arrayContaining(['focused-market', 'focused-apps']));
  });

  it('no Focused page sets its own width, max-width or gutters', () => {
    const ownsLayout = rules.filter(([selector, body]) =>
      selector.split(',').some((s) => pageClasses.some((c) => new RegExp(`\\.${c}$`).test(s.trim()))) &&
      /(^|;)\s*(max-width|width|padding(-left|-right|-inline)?)\s*:/.test(body));
    expect(ownsLayout.map(([selector]) => selector)).toEqual([]);
  });

  it('blocks span their page and column rows stretch their children', () => {
    const block = rules.find(([selector]) => selector === '.ui-focused .focused-edit-block');
    expect(block[1]).toMatch(/width:\s*100%/);
    const column = rules.find(([selector]) => selector === '.ui-focused .focused-edit-row.column');
    expect(column[1]).toMatch(/align-items:\s*stretch/);
  });
});

describe('Focused sidebar', () => {
  it('New chat is an icon beside search in the header, not a nav row', () => {
    const head = sidebar.slice(sidebar.indexOf('focused-side-head'), sidebar.indexOf('</div>', sidebar.indexOf('focused-side-head')));
    expect(head.indexOf('aria-label="Search chats"')).toBeGreaterThan(-1);
    expect(head.indexOf('aria-label="New chat"')).toBeGreaterThan(head.indexOf('aria-label="Search chats"'));
    expect(sidebar).not.toMatch(/<span>New chat<\/span>/);
  });
});
