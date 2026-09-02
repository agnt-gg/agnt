import { describe, expect, it } from 'vitest';

import { summaryOf } from './pipeline.mjs';

const words = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

describe('summaryOf', () => {
  it('prefers the frontmatter title over the body', () => {
    expect(summaryOf({ title: 'Real title', body: 'raw dump line\nmore' })).toBe('Real title');
  });

  it('falls back to the first non-empty body line when title is missing or empty', () => {
    expect(summaryOf({ body: '\n\n  first real line\nsecond' })).toBe('first real line');
    expect(summaryOf({ title: '', body: 'from body' })).toBe('from body');
    expect(summaryOf({ title: '   ', body: 'from body' })).toBe('from body');
    expect(summaryOf({ title: 42, body: 'from body' })).toBe('from body');
  });

  it('returns an empty string when there is nothing to show', () => {
    expect(summaryOf({})).toBe('');
    expect(summaryOf({ body: '\n \n' })).toBe('');
  });

  it('leaves text at or under the width untouched', () => {
    const exact = 'x'.repeat(70);
    expect(summaryOf({ title: exact })).toBe(exact);
    expect(summaryOf({ title: 'short' })).toBe('short');
  });

  it('breaks long text on a word boundary with an ellipsis', () => {
    const s = summaryOf({ title: words(30) });
    expect(s.endsWith('…')).toBe(true);
    expect(s.length).toBeLessThanOrEqual(70);
    const kept = s.slice(0, -1);
    expect(kept.endsWith(' ')).toBe(false);
    expect(kept.split(' ').every((w) => /^word\d+$/.test(w))).toBe(true);
  });

  it('hard-cuts text that has no whitespace to break on', () => {
    const s = summaryOf({ title: 'a'.repeat(100) });
    expect(s).toBe(`${'a'.repeat(69)}…`);
  });

  it('honours a custom width', () => {
    expect(summaryOf({ title: 'one two three four' }, 10)).toBe('one two…');
    expect(summaryOf({ title: 'abcdefghijkl' }, 10)).toBe('abcdefghi…');
  });

  it('never exceeds the width', () => {
    const samples = [words(50), 'z'.repeat(200), `${'q'.repeat(69)} tail`, `${'q'.repeat(75)} tail`, 'a b c d e f g h i j k l m n o p q r s t u v w x y z a b c d e f g h i j k l m n o p q r s t u v w x y z'];
    for (const width of [5, 10, 70]) {
      for (const text of samples) expect(summaryOf({ title: text }, width).length).toBeLessThanOrEqual(width);
    }
  });
});
