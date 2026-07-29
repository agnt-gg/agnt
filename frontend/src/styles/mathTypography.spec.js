/**
 * Static guards for math (MathJax) typography.
 *
 * Rendered math lands in <mjx-container>. Three stylesheets had swept it into
 * their <pre> / code-block rules, so every equation in a chat message rendered
 * inside a dark box with a border and 16px of inset — reading as code, not as
 * prose. The fix removes mjx-container from those code-block selector lists.
 *
 * Two mistakes are pinned here because both actually shipped:
 *
 *   1. THE COMMA LEAK. themes/_dark.css contained
 *        `body.dark pre,\n mjx-container { border: 1px solid ... }`
 *      The second selector is BARE. A selector list is a list of independent
 *      selectors — the `body.dark` scope on the first one does not carry over —
 *      so a rule living in the dark-theme file put a border on math in every
 *      theme. Same class of bug as the unscoped `header{display:none}` leak
 *      guarded by globalStyleLeaks.spec.js.
 *
 *   2. ABSOLUTE FONT SIZE. mjx-container was pinned to var(--font-size-md)
 *      (16px) while .message-text is var(--font-size-sm) (14px), so math was
 *      sized independently of the prose it sits in and drifted whenever either
 *      moved. It is now relative (110%), which tracks the surrounding text.
 *
 * All statically checkable, so checked statically.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..');

const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

/** Every stylesheet that is reachable from the app entry and mentions math. */
const SHEETS = ['styles/themes/_dark.css', 'styles/themes/_light.css', 'base/css/main.css'];

/**
 * Crude but sufficient rule splitter: returns { selector, body } for every
 * top-level rule whose selector list mentions mjx-container. Comments are
 * stripped first so a commented-out example cannot satisfy or fail a guard.
 */
/**
 * Read one declaration's value out of a rule body. Deliberately NOT a
 * `(?!0)` lookahead: `/padding\s*:\s*(?!0)/` backtracks — `\s*` gives up the
 * space it matched, the lookahead then sees the space instead of the `0`, and
 * `padding: 0` reports as non-zero. That false positive is what this helper
 * exists to prevent. Compare the extracted value instead of asserting inside
 * a variable-width match.
 */
function declValue(body, prop) {
  const m = body.match(new RegExp(`(^|[;{\\s])${prop}\\s*:\\s*([^;]+)`));
  return m ? m[2].trim().replace(/\s*!important$/, '') : null;
}

const isNonZero = (v) => v !== null && !/^0(px|em|rem|%)?$/.test(v);

function mjxRules(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(clean)) !== null) {
    const selector = m[1].trim();
    if (/\bmjx-container\b/.test(selector)) rules.push({ selector, body: m[2] });
  }
  return rules;
}

describe('math is not styled as a code block', () => {
  for (const rel of SHEETS) {
    it(`${rel} gives mjx-container no background, border or radius`, () => {
      for (const { selector, body } of mjxRules(read(rel))) {
        // `background: none` / `border: none` are the explicit removals; any
        // other value would be re-boxing math.
        const bg = body.match(/(^|[;\s])background(-color)?\s*:\s*([^;]+)/);
        if (bg) expect(bg[3].trim().replace(/\s*!important$/, ''), `${rel} :: ${selector}`).toBe('none');

        const border = body.match(/(^|[;\s])border\s*:\s*([^;]+)/);
        if (border) expect(border[2].trim().replace(/\s*!important$/, ''), `${rel} :: ${selector}`).toBe('none');

        expect(body, `${rel} :: ${selector} must not round math like a code block`).not.toMatch(/border-radius\s*:/);
      }
    });
  }

  it('main.css reserves the 16px inset for <pre>, not for math', () => {
    const rules = mjxRules(read('base/css/main.css'));
    const padded = rules.filter((r) => isNonZero(declValue(r.body, 'padding')));
    expect(padded.map((r) => r.selector)).toEqual([]);
  });

  /**
   * MathJax injects `mjx-container[display="true"] { margin: 1em 0 }` into a
   * <style> appended to <head> at runtime. An author rule of equal specificity
   * loses on source order, so display-math rhythm is MathJax's to own and any
   * author margin here is either dead (on [display='true']) or actively wrong
   * (bare `mjx-container`, which leaks vertical margin onto INLINE math and
   * shoves the line box around mid-sentence). Measured in a real browser
   * against the built bundle: 15.4px top/bottom on a 14px prose base.
   */
  it('no author rule sets a margin on mjx-container', () => {
    for (const rel of SHEETS) {
      for (const { selector, body } of mjxRules(read(rel))) {
        expect(isNonZero(declValue(body, 'margin')), `${rel} :: ${selector}`).toBe(false);
      }
    }
  });
});

describe('the comma leak (a body.dark rule that escaped its theme)', () => {
  /**
   * Pre-existing offenders, each with a reason. This guard is file-wide on
   * purpose — the mistake is about selector lists, not about math — so an
   * older instance is recorded here rather than silently excluded. Removing
   * one from the CSS without removing it here fails the stale-entry check
   * below, so the allowlist cannot rot.
   */
  const KNOWN_LEAKS = [
    // Forces --color-med-navy on the cancel button in EVERY theme, not just
    // dark. Same bug, unrelated component; fixing it changes light/cyberpunk
    // button colours, so it is left for a deliberate visual change.
    'body.dark .cancel, .generate.holofx-bg.cancel',
  ];

  it('_dark.css never lists a bare, unscoped selector alongside a body.dark one', () => {
    const css = read('styles/themes/_dark.css').replace(/\/\*[\s\S]*?\*\//g, '');
    const offenders = [];
    const re = /([^{}]+)\{[^{}]*\}/g;
    let m;
    while ((m = re.exec(css)) !== null) {
      const parts = m[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (parts.length < 2) continue;
      // At-rule preludes (@media ...) are not selector lists.
      if (parts.some((p) => p.startsWith('@'))) continue;
      const scoped = parts.filter((p) => /(^|\s|>)body\b/.test(p) || p.startsWith(':root') || p.startsWith('html'));
      if (scoped.length > 0 && scoped.length < parts.length) {
        offenders.push(m[1].trim().replace(/\s+/g, ' '));
      }
    }
    expect(offenders.filter((o) => !KNOWN_LEAKS.includes(o))).toEqual([]);

    // The allowlist must not outlive the leak it documents.
    expect(KNOWN_LEAKS.filter((k) => !offenders.includes(k)), 'stale allowlist entry').toEqual([]);
  });
});

describe('math font size is relative to its prose', () => {
  const css = read('base/css/main.css');

  it('mjx-container[jax=CHTML] is set to 110%', () => {
    const rule = mjxRules(css).find((r) => r.selector.includes("[jax='CHTML']"));
    expect(rule, "the jax='CHTML' rule is the winning declaration and must exist").toBeTruthy();
    expect(rule.body).toMatch(/font-size\s*:\s*110%\s*!important/);
  });

  it('no mjx-container rule pins an absolute px/var font size', () => {
    for (const { selector, body } of mjxRules(css)) {
      const fs_ = body.match(/font-size\s*:\s*([^;]+)/);
      if (fs_) expect(fs_[1].trim(), `${selector} must size math relatively`).toMatch(/%/);
    }
  });
});
