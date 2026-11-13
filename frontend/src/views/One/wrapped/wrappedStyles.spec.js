/**
 * wrapped.css is global (the cards are teleported to <body>), so its reach is
 * pinned here: every rule stays under .one-wrapped or the capsule's .ui-one,
 * keyframes are namespaced, the cards keep the brand palette whatever the
 * theme, and no element inside a card wears a card's ground class (it would
 * take that card's ground and layout rules with it).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCards } from './wrappedModel.js';
import { yearFixture } from './wrapped.fixture.js';

const DIR = dirname(fileURLToPath(import.meta.url));
const read = (file) => readFileSync(join(DIR, file), 'utf8');
const css = read('wrapped.css').replace(/\/\*[\s\S]*?\*\//g, '');
const withoutKeyframes = css.replace(/@keyframes\s+[\w-]+\s*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '').replace(/@(?:media|container)[^{]*\{/g, '');
const rules = [...withoutKeyframes.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selectors: m[1].split(',').map((s) => s.trim()).filter(Boolean), body: m[2] }));

describe('wrapped.css', () => {
  it('parses into a plausible number of rules (anti-vacuity)', () => {
    expect(rules.length).toBeGreaterThan(100);
  });

  it('every rule is scoped under .one-wrapped (the cards) or .ui-one (the capsule)', () => {
    const loose = rules.flatMap((r) => r.selectors).filter((s) => !/^\.one-wrapped(?![\w-])/.test(s) && !/^\.ui-one(?![\w-])/.test(s));
    expect(loose).toEqual([]);
  });

  it('every keyframe is namespaced one-wrapped-', () => {
    const names = [...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(5);
    expect(names.filter((n) => !n.startsWith('one-wrapped-'))).toEqual([]);
  });

  it('the cards keep the brand palette: no card rule reads a theme colour token', () => {
    const themed = rules.filter((r) => r.selectors.some((s) => s.startsWith('.one-wrapped')) && /var\(--color-/.test(r.body)).map((r) => r.selectors.join(', '));
    expect(themed).toEqual([]);
  });

  it('no element inside a card wears a card ground class', () => {
    const grounds = new Set([...buildCards(yearFixture()).map((c) => `wr-${c.id}`), 'wr-state']);
    const offenders = [];
    for (const file of ['WrappedCard.vue', 'WrappedStory.vue']) {
      for (const [, classes] of read(file).matchAll(/\bclass="([^"]*)"/g)) {
        for (const name of classes.split(/\s+/)) if (grounds.has(name) && !(file === 'WrappedStory.vue' && name === 'wr-state')) offenders.push(`${file}: ${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
