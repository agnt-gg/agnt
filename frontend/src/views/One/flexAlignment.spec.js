/**
 * Every flex rule in AGNT One's styles states its cross-axis alignment.
 *
 * Reported from the app: the starter pills under the composer had their icon
 * and label pinned to the pill's top edge. A browser (and every headless check)
 * showed them centred. The engines disagree on an UNSET value: Electron 33's
 * Chromium 130, the one AGNT ships, gives <button> a built-in
 * `align-items: flex-start`; newer Chromium gives `normal` (stretch). The pill
 * is a flex <button> that never said, so the engine decided.
 *
 * jsdom has no layout and no browser stylesheet, so this is held at the
 * source: in these files, a rule that makes something a flex container also
 * says how its children align. (Grid rules are not covered: none of these
 * buttons is a grid without place-items, and the default differs only for
 * flex.)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(DIR, rel), 'utf8');
const styleOf = (sfc) => [...sfc.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');

const SOURCES = {
  'views/One/one.css': read('one.css'),
  'views/Focused/FocusedStarters.vue': styleOf(read('../Focused/FocusedStarters.vue')),
};

/** Flat list of { selector, body } for every style rule, at any @-rule depth. */
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
      stack.push(head.startsWith('@') ? { at: true } : { selector: head, start: i + 1 });
    } else if (ch === '}') {
      const open = stack.pop();
      if (open && !open.at) out.push({ selector: open.selector, body: text.slice(open.start, i) });
      buffer = '';
    } else {
      buffer += ch;
    }
  }
  return out;
}

const isFlex = (body) => /(^|[;{\s])display\s*:\s*(inline-)?flex\b/.test(body);
const statesAlignment = (body) => /(^|[;{\s])align-items\s*:/.test(body);

describe('flex rules state their alignment', () => {
  it.each(Object.entries(SOURCES))('%s', (_file, css) => {
    const rules = rulesOf(css);
    expect(rules.filter((r) => isFlex(r.body)).length).toBeGreaterThan(2); // anti-vacuity
    const unstated = rules.filter((r) => isFlex(r.body) && !statesAlignment(r.body)).map((r) => r.selector.replace(/\s+/g, ' '));
    expect(unstated).toEqual([]);
  });

  it('the starter pill centres its content (the reported bug)', () => {
    const pill = rulesOf(SOURCES['views/One/one.css']).find((r) => r.selector === '.ui-one.ui-focused .focused-starter');
    expect(pill?.body).toMatch(/align-items:\s*center/);
  });

  it('can see an unstated flex rule (anti-vacuity)', () => {
    const [rule] = rulesOf('.x { display: flex; gap: 4px; }');
    expect(isFlex(rule.body) && !statesAlignment(rule.body)).toBe(true);
  });
});
