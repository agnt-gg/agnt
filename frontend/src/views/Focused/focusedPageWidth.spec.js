/**
 * Focused layout invariants.
 *
 * Every Focused page is ONE width (Plugins' width). Pages were 880px with
 * Plugins alone overridden to 1204px, so moving between pages changed the
 * width every time. The width lives in one variable; no page may set its own.
 * Chat keeps its reading column, which is a different rule entirely.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
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
    const pageWidths = rules.filter(([selector, body]) => /\.focused-page\b/.test(selector) && /max-width/.test(body));
    expect(pageWidths.map(([selector]) => selector)).toEqual(['.ui-focused .focused-page']);
    expect(pageWidths[0][1]).toMatch(/max-width:\s*var\(--focused-page-width\)/);
  });

  it('no Focused page class narrows itself with its own max-width', () => {
    const narrowed = rules.filter(([selector, body]) => /\.focused-page\.focused-[\w-]+$|\.focused-(apps|editor)$/.test(selector) && /(^|;)\s*max-width\s*:\s*\d/.test(body));
    expect(narrowed.map(([selector]) => selector)).toEqual([]);
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
