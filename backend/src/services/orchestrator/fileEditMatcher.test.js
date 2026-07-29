/**
 * Matching policy and failure diagnostics for edit_file.
 *
 * These are the assertions that make the 2026-07-28 audit's headline finding
 * actionable. Measured over the full production history:
 *
 *   - 7.8% of edit_file calls did not fully land
 *   - whitespace/indentation drift explained 0.5% of the failures
 *   - 47% (noise-excluded) were NEAR MISSES: right block, one token wrong
 *
 * So the two things worth pinning are (a) an ambiguous match is never resolved
 * silently, and (b) a miss comes back with the file's real text attached.
 */

import { describe, it, expect } from 'vitest';
import {
  findMatches,
  findCandidates,
  describeMiss,
  describeAmbiguity,
  shiftRecords,
  renderDiff,
  lineAt,
  lineStartAt,
  lineEndAt,
  MATCH_TIERS,
} from './fileEditMatcher.js';

const LF = ['function boot() {', '  const a = 1;', '  const b = 2;', '  return a + b;', '}', ''].join('\n');
const CRLF = LF.replace(/\n/g, '\r\n');

describe('findMatches — tiers', () => {
  it('matches exactly and reports the tier', () => {
    const r = findMatches(LF, '  const a = 1;');
    expect(r.tier).toBe(MATCH_TIERS.EXACT);
    expect(r.matches).toHaveLength(1);
    expect(LF.slice(r.matches[0].start, r.matches[0].end)).toBe('  const a = 1;');
  });

  it('matches an LF search against a CRLF file (the 2026-07-25 bug class)', () => {
    // Callers write "\n". Before the EOL tier existed, indexOf could never match
    // on a CRLF file, so EVERY multi-line edit fell through to fuzzy matching —
    // which welded the replacement onto the end of the preceding line.
    const r = findMatches(CRLF, '  const a = 1;\n  const b = 2;');
    expect(r.tier).toBe(MATCH_TIERS.EOL);
    expect(r.matches).toHaveLength(1);
    expect(CRLF.slice(r.matches[0].start, r.matches[0].end)).toBe('  const a = 1;\r\n  const b = 2;');
  });

  it('falls back to whitespace-insensitive only when the exact tiers miss', () => {
    const r = findMatches(LF, '    const a   =   1;');
    expect(r.tier).toBe(MATCH_TIERS.WHITESPACE);
    expect(r.matches).toHaveLength(1);
  });

  it('a whitespace-tier match never begins on whitespace', () => {
    // The one guard that stops the splice from eating the preceding newline.
    const r = findMatches(CRLF, '    const a = 1;');
    const { start } = r.matches[0];
    expect(CRLF[start]).not.toMatch(/[\r\n]/);
    // Indentation is absorbed horizontally, so the start sits after the CRLF.
    expect(CRLF.slice(start - 2, start)).toBe('\r\n');
  });

  it('returns null rather than guessing when nothing matches', () => {
    expect(findMatches(LF, 'const nowhere = 1;')).toBeNull();
  });

  it('rejects an empty search instead of matching position 0', () => {
    expect(findMatches(LF, '')).toBeNull();
  });
});

describe('findMatches — occurrence counting', () => {
  const DUPES = ['dup();', 'a();', 'dup();', 'b();', 'dup();'].join('\n');

  it('counts every exact occurrence', () => {
    const r = findMatches(DUPES, 'dup();');
    expect(r.matches).toHaveLength(3);
  });

  it('counts every WHITESPACE-tier occurrence too', () => {
    // The old fuzzy path hardcoded `occurrences: 1`, so an ambiguous fuzzy match
    // was indistinguishable from a unique one — the exact shape that lets a tool
    // edit the wrong site and call it success.
    const src = 'function calc(){ return  a  +  b; }\nfunction other(){ return  a  +  b; }\n';
    const r = findMatches(src, 'return  a   +   b;');
    expect(r.tier).toBe(MATCH_TIERS.WHITESPACE);
    expect(r.matches).toHaveLength(2);
  });

  it('returns non-overlapping matches', () => {
    const r = findMatches('aaaa', 'aa');
    expect(r.matches).toEqual([{ start: 0, end: 2 }, { start: 2, end: 4 }]);
  });
});

describe('findCandidates — did you mean', () => {
  const SOURCE = [
    'function boot() {',
    '  // rm-then-extract order, section 3.1 gotcha G2',
    '  const cfg = loadConfig({ retries: 3, timeout: 900 });',
    '  return cfg;',
    '}',
    '',
  ].join('\n');

  it('finds the right line when one token is wrong (the real failure shape)', () => {
    // Verbatim from the production pairing: "rt-then-extract" vs
    // "rm-then-extract" scored 0.94 similarity and still failed to match.
    const c = findCandidates(SOURCE, '  // rt-then-extract order, section 3.1 gotcha G2');
    expect(c[0].startLine).toBe(2);
    expect(c[0].actual).toContain('rm-then-extract');
    expect(c[0].similarity).toBeGreaterThan(0.8);
  });

  it('reports the real multi-line block, aligned on the anchor line', () => {
    const c = findCandidates(SOURCE, '  const cfg = loadConfig({ retries: 5, timeout: 900 });\n  return cfg;');
    expect(c[0].startLine).toBe(3);
    expect(c[0].endLine).toBe(4);
    expect(c[0].actual).toBe('  const cfg = loadConfig({ retries: 3, timeout: 900 });\n  return cfg;');
  });

  it('returns nothing rather than inventing a candidate', () => {
    // An unrelated suggestion is worse than none: it invites a second wrong
    // guess, which is precisely the 355-wasted-call behaviour being fixed.
    expect(findCandidates(SOURCE, 'const quantumFlux = new Reactor({ core: true });')).toHaveLength(0);
  });

  it('caps how much text a single candidate can return', () => {
    const huge = `${'x'.repeat(5000)}\n`;
    const c = findCandidates(huge, `${'x'.repeat(4990)}`);
    if (c.length) expect(c[0].actual.length).toBeLessThan(1400);
  });

  it('skips scanning implausibly large sources instead of stalling a turn', () => {
    const enormous = 'a'.repeat(4_000_001);
    expect(findCandidates(enormous, 'aaaa')).toEqual([]);
  });
});

describe('describeMiss / describeAmbiguity — the copy is the fix', () => {
  const SOURCE = 'const alpha = 1;\nconst beta = 2;\n';

  it('a miss names the remedy and carries the real text', () => {
    const d = describeMiss(SOURCE, 'const alpha = 2;');
    expect(d.reason).toBe('Search string not found');
    expect(d.didYouMean[0].actual).toBe('const alpha = 1;');
    expect(d.hint).toMatch(/verbatim/i);
  });

  it('a miss with no nearby text says so honestly', () => {
    const d = describeMiss(SOURCE, 'import { createServer } from "node:http";');
    expect(d.didYouMean).toBeUndefined();
    expect(d.hint).toMatch(/Re-read the file/i);
  });

  it('ambiguity lists every line and offers both escapes', () => {
    const src = 'dup();\na();\ndup();\n';
    const m = findMatches(src, 'dup();');
    const d = describeAmbiguity(src, 'dup();', m.matches, m.tier);
    expect(d.occurrences).toBe(2);
    expect(d.lines).toEqual([1, 3]);
    expect(d.hint).toMatch(/surrounding context/);
    expect(d.hint).toMatch(/replace_all/);
  });

  it('truncates a huge search string in the failure payload', () => {
    const d = describeMiss(SOURCE, 'q'.repeat(5000));
    expect(d.search.length).toBeLessThanOrEqual(201);
  });
});

describe('offset helpers', () => {
  const S = 'aaa\nbbb\r\nccc\n';
  it('lineAt is 1-based', () => {
    expect(lineAt(S, 0)).toBe(1);
    expect(lineAt(S, 4)).toBe(2);
    expect(lineAt(S, 9)).toBe(3);
  });
  it('lineStartAt finds the start of the containing line', () => {
    expect(lineStartAt(S, 0)).toBe(0);
    expect(lineStartAt(S, 5)).toBe(4);
  });
  it('lineEndAt stops before the terminator, CR included', () => {
    expect(S.slice(lineStartAt(S, 5), lineEndAt(S, 5))).toBe('bbb');
    expect(S.slice(lineStartAt(S, 1), lineEndAt(S, 1))).toBe('aaa');
  });
});

describe('diff records stay exact across multiple edits', () => {
  it('shiftRecords keeps earlier offsets valid after a later splice', () => {
    const records = [{ finalStart: 100, oldBlock: 'x', newBlock: 'y' }];
    // A splice at [10,20) replacing 10 chars with 3 shrinks everything after it.
    shiftRecords(records, 10, 20, 3);
    expect(records[0].finalStart).toBe(93);
  });

  it('a splice entirely after a record leaves it alone', () => {
    const records = [{ finalStart: 5, oldBlock: 'x', newBlock: 'y' }];
    shiftRecords(records, 50, 60, 0);
    expect(records[0].finalStart).toBe(5);
  });

  it('renderDiff emits hunks in file order regardless of application order', () => {
    const final = 'one\ntwo\nthree\n';
    const diff = renderDiff(final, [
      { finalStart: 8, oldBlock: 'THREE', newBlock: 'three' },
      { finalStart: 0, oldBlock: 'ONE', newBlock: 'one' },
    ]);
    expect(diff.indexOf('-ONE')).toBeLessThan(diff.indexOf('-THREE'));
    expect(diff).toContain('@@ line 1 @@');
    expect(diff).toContain('@@ line 3 @@');
  });

  it('caps total diff size', () => {
    const records = Array.from({ length: 50 }, (_, i) => ({
      finalStart: i * 100,
      oldBlock: 'o'.repeat(200),
      newBlock: 'n'.repeat(200),
    }));
    const diff = renderDiff('z'.repeat(6000), records);
    expect(diff.length).toBeLessThan(2600);
    expect(diff).toMatch(/more hunk\(s\) omitted/);
  });
});
