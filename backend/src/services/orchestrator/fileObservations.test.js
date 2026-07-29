/**
 * The staleness ledger behind edit_file's refusal to edit a file that moved
 * underneath it (probe T6, 2026-07-28).
 *
 * The distinction these tests exist to protect: UNOBSERVED is not STALE.
 * Measured, 42% of production edits were issued against a file this process had
 * never read. Hard-failing all of them would break far more than it fixed, so
 * `checkStale` must return null — not a truthy "unknown" — for a path nobody
 * has looked at.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  observe,
  getObservation,
  checkStale,
  hashContent,
  _resetObservations,
  MAX_OBSERVATIONS,
} from './fileObservations.js';

beforeEach(() => _resetObservations());

describe('observe / getObservation', () => {
  it('records a hash and size', () => {
    observe('a.js', 'hello');
    const o = getObservation('a.js');
    expect(o.hash).toBe(hashContent('hello'));
    expect(o.size).toBe(5);
    expect(typeof o.at).toBe('number');
  });

  it('an unknown key has no observation', () => {
    expect(getObservation('never-seen.js')).toBeNull();
  });

  it('re-observing replaces the previous record', () => {
    observe('a.js', 'one');
    observe('a.js', 'two');
    expect(getObservation('a.js').hash).toBe(hashContent('two'));
  });
});

describe('checkStale', () => {
  it('returns null for an unobserved path — unknown is not stale', () => {
    expect(checkStale('fresh.js', 'anything at all')).toBeNull();
  });

  it('returns null when the content is unchanged', () => {
    observe('a.js', 'stable');
    expect(checkStale('a.js', 'stable')).toBeNull();
  });

  it('detects a change and reports both sides', () => {
    observe('a.js', 'v1');
    const stale = checkStale('a.js', 'v2');
    expect(stale).not.toBeNull();
    expect(stale.priorHash).toBe(hashContent('v1'));
    expect(stale.currentHash).toBe(hashContent('v2'));
    expect(stale.priorSize).toBe(2);
    expect(stale.currentSize).toBe(2);
  });

  it('detects a same-length change — size alone would miss it', () => {
    // mtime+size is the tempting cheap check and it is genuinely unsound: two
    // writes in the same millisecond producing the same byte count are exactly
    // the concurrent-edit case this guard exists for.
    observe('a.js', 'const FLAG = 0;');
    expect(checkStale('a.js', 'const FLAG = 1;')).not.toBeNull();
  });

  it('re-observing clears staleness', () => {
    observe('a.js', 'v1');
    expect(checkStale('a.js', 'v2')).not.toBeNull();
    observe('a.js', 'v2');
    expect(checkStale('a.js', 'v2')).toBeNull();
  });
});

describe('bounded growth', () => {
  it('evicts oldest entries past the cap', () => {
    for (let i = 0; i < MAX_OBSERVATIONS + 50; i++) observe(`f${i}.js`, `content ${i}`);
    expect(getObservation('f0.js')).toBeNull();
    expect(getObservation(`f${MAX_OBSERVATIONS + 49}.js`)).not.toBeNull();
  });

  it('touching a key keeps it alive (LRU order, not insertion order)', () => {
    observe('keep.js', 'v1');
    for (let i = 0; i < MAX_OBSERVATIONS - 1; i++) observe(`f${i}.js`, 'x');
    observe('keep.js', 'v2'); // moves it to the end
    for (let i = 0; i < 100; i++) observe(`g${i}.js`, 'x');
    expect(getObservation('keep.js')).not.toBeNull();
  });
});
