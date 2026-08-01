import { describe, it, expect } from 'vitest';
import {
  contentTokens,
  similarity,
  isNearDuplicate,
  buildMatchQuery,
  CONTAINMENT_THRESHOLD,
  JACCARD_FLOOR,
  MIN_TOKENS_FOR_COMPARISON,
} from './memorySimilarity.js';

// Real pairs from the live store. These are what the exact-match and shape
// dedupes both missed: the extractor is an LLM, so it rewords every time.
const PAIR_A = 'The direct read_file call failed due to path traversal restrictions on a Windows absolute path, while file_system_operation succeeded for the same target';
const PAIR_B = 'Direct read_file on the full Windows path failed due to path traversal restrictions, while file_system_operation succeeded reading the same file';

const DIFFERENT = 'The user prefers dark mode and a compact sidebar layout in the workflow editor canvas';

const dup = (a, b) => isNearDuplicate(contentTokens(a), contentTokens(b));

describe('contentTokens', () => {
  it('drops stopwords, short tokens and numbers', () => {
    const t = contentTokens('The node ran for 4300ms at 12:05 on a b c');
    expect(t.has('the')).toBe(false);
    expect(t.has('node')).toBe(true);
    expect([...t].some((x) => /\d/.test(x))).toBe(false);
    expect(t.has('a')).toBe(false);
  });

  it('strips UUIDs rather than shredding them into tokens', () => {
    const t = contentTokens('run a3f1c8e2-4b5d-4e6f-8a9b-0c1d2e3f4a5b completed cleanly');
    expect([...t].some((x) => x.length === 4 && /^[a-f]+$/.test(x))).toBe(false);
    expect(t.has('completed')).toBe(true);
  });

  it('is order-insensitive — it returns a set', () => {
    expect([...contentTokens('alpha beta gamma')].sort())
      .toEqual([...contentTokens('gamma alpha beta')].sort());
  });

  it('handles null/undefined', () => {
    expect(contentTokens(null).size).toBe(0);
    expect(contentTokens(undefined).size).toBe(0);
  });
});

describe('similarity', () => {
  it('scores a real paraphrase pair above both thresholds', () => {
    const s = similarity(contentTokens(PAIR_A), contentTokens(PAIR_B));
    expect(s.comparable).toBe(true);
    expect(s.containment).toBeGreaterThanOrEqual(CONTAINMENT_THRESHOLD);
    expect(s.jaccard).toBeGreaterThanOrEqual(JACCARD_FLOOR);
  });

  it('scores unrelated memories far below', () => {
    const s = similarity(contentTokens(PAIR_A), contentTokens(DIFFERENT));
    expect(s.containment).toBeLessThan(CONTAINMENT_THRESHOLD);
  });

  it('is symmetric', () => {
    const a = contentTokens(PAIR_A);
    const b = contentTokens(PAIR_B);
    expect(similarity(a, b)).toEqual(similarity(b, a));
  });
});

describe('the Jaccard floor exists to kill asymmetric false positives', () => {
  // THE case containment alone gets wrong: a narrow memory whose every token
  // appears in a much richer one scores containment 1.00 while the richer one
  // carries real extra information. Collapsing them would discard it.
  //
  // NARROW is deliberately over the MIN_TOKENS_FOR_COMPARISON floor. An earlier
  // version used a four-token fixture, which the short-content floor rejected
  // outright — so the test passed for the wrong reason and stayed green when
  // the Jaccard floor was deleted. A guard can only be tested by a case that
  // reaches it.
  const NARROW = 'timer trigger executed twice within scheduler window duplicate listener registered';
  const RICH = 'timer trigger executed twice within scheduler window duplicate listener registered '
    + 'after a hot reload, which also caused downstream fetch nodes to run concurrently, '
    + 'exhausting the connection pool during peak traffic and delaying every subsequent '
    + 'email dispatch batch until the supervisor restarted the queue consumer process';

  it('both sides clear the comparison floor, so the thresholds actually decide', () => {
    expect(contentTokens(NARROW).size).toBeGreaterThanOrEqual(MIN_TOKENS_FOR_COMPARISON);
    expect(contentTokens(RICH).size).toBeGreaterThanOrEqual(MIN_TOKENS_FOR_COMPARISON);
    expect(similarity(contentTokens(NARROW), contentTokens(RICH)).comparable).toBe(true);
  });

  it('containment alone would call these duplicates', () => {
    const s = similarity(contentTokens(NARROW), contentTokens(RICH));
    expect(s.containment).toBeGreaterThanOrEqual(CONTAINMENT_THRESHOLD);
  });

  it('but Jaccard rejects them, so isNearDuplicate says no', () => {
    const s = similarity(contentTokens(NARROW), contentTokens(RICH));
    expect(s.jaccard).toBeLessThan(JACCARD_FLOOR);
    expect(dup(NARROW, RICH)).toBe(false);
  });
});

describe('the containment threshold is load-bearing too', () => {
  // Jaccard <= containment always, so a pair can clear the Jaccard floor and
  // still be rejected on containment. Without a fixture in that band, loosening
  // CONTAINMENT_THRESHOLD changes no test result and the constant is unguarded.
  //
  // The band is narrow and has to be constructed, not guessed. With |A|=|B|=m
  // and intersection i: jaccard >= 0.5 requires i >= 2m/3, containment < 0.8
  // requires i < 0.8m. So i must land in [0.667m, 0.8m) — here m=15, i=11,
  // giving containment 0.733 and jaccard 0.579. A first attempt at this pair
  // was eyeballed and landed at containment 0.818, outside the band, so the
  // test failed in the baseline and made its negative control look green.
  const shared = 'scheduler queue consumer restarted connection pool exhausted handles dispatch batches supervisor';
  const A = `${shared} webhook retrying downstream latency`;
  const B = `${shared} migration backlog throttling quota`;

  it('the fixture really is 15 vs 15 sharing 11 (anti-vacuity)', () => {
    expect(contentTokens(A).size).toBe(15);
    expect(contentTokens(B).size).toBe(15);
  });

  it('sits between the two thresholds — above the Jaccard floor, below containment', () => {
    const s = similarity(contentTokens(A), contentTokens(B));
    expect(s.comparable).toBe(true);
    expect(s.jaccard).toBeGreaterThanOrEqual(JACCARD_FLOOR);
    expect(s.containment).toBeLessThan(CONTAINMENT_THRESHOLD);
  });

  it('so containment is what rejects it', () => {
    expect(dup(A, B)).toBe(false);
  });
});

describe('isNearDuplicate', () => {
  it('accepts the real paraphrase pair', () => {
    expect(dup(PAIR_A, PAIR_B)).toBe(true);
  });

  it('rejects genuinely different findings', () => {
    expect(dup(PAIR_A, DIFFERENT)).toBe(false);
  });

  it('accepts a memory against itself', () => {
    expect(dup(PAIR_A, PAIR_A)).toBe(true);
  });

  it('DECLINES to judge memories that are too short', () => {
    // Two three-word memories trivially contain each other. A false duplicate
    // silently discards a memory, which is worse than keeping a redundant one.
    expect(dup('likes green', 'likes green')).toBe(false);
    expect(contentTokens('likes green').size).toBeLessThan(MIN_TOKENS_FOR_COMPARISON);
  });

  it('handles empty content without throwing', () => {
    expect(dup('', '')).toBe(false);
    expect(dup(PAIR_A, '')).toBe(false);
  });
});

describe('buildMatchQuery', () => {
  it('quotes every token so FTS5 operators cannot leak through', () => {
    // Bare AND/OR/NOT/NEAR are FTS5 operators; an unquoted token from LLM prose
    // throws rather than returning no rows — a silent write-path failure.
    const q = buildMatchQuery(
      'the workflow AND the trigger NOT the node NEAR another scheduler '
      + 'listener queue handler dispatcher registry OR something entirely'
    );
    expect(q).toBeTruthy();
    for (const op of ['AND', 'OR ', 'NOT', 'NEAR']) {
      expect(q).not.toMatch(new RegExp(`(^|\\s)${op.trim()}(\\s|$)(?!")`));
    }
    for (const term of q.split(' OR ')) {
      expect(term.startsWith('"') && term.endsWith('"')).toBe(true);
    }
  });

  it('returns null for content too short to block on', () => {
    expect(buildMatchQuery('likes green')).toBeNull();
    expect(buildMatchQuery('')).toBeNull();
  });

  it('caps the number of terms', () => {
    const long = Array.from({ length: 200 }, (_, i) => `token${'x'.repeat(i % 9)}word${i}`).join(' ');
    const q = buildMatchQuery(long, 24);
    expect(q.split(' OR ').length).toBeLessThanOrEqual(24);
  });

  it('produces a query containing the distinctive domain nouns', () => {
    // Underscores split into separate tokens, which is what we want: it lets
    // `read_file` match prose that says "read file".
    const q = buildMatchQuery(PAIR_A);
    expect(q).toContain('"traversal"');
    expect(q).toContain('"restrictions"');
    expect(contentTokens('file_system_operation')).toEqual(new Set(['file', 'system', 'operation']));
  });

  it('never emits a bare punctuation term', () => {
    const q = buildMatchQuery('node-id: a3f1 (failed) — retrying! "quoted" [bracketed] {braced} 100%');
    if (q) {
      for (const term of q.split(' OR ')) {
        expect(term).toMatch(/^"[a-z]+"$/);
      }
    }
  });
});
