import { describe, it, expect, vi } from 'vitest';
import { startTrials, refusedSentence } from './startTrials.js';
import { onePage, sameProblemElsewhere } from './learningFormat.js';

const finding = (id, capability) => ({ id, capability });

describe('spreading a kept fix: one trial per tool', () => {
  it('starts each in turn; a refusal for one tool does not stop the others', async () => {
    const start = vi.fn(async (f) => { if (f.id === 'b') throw new Error('insufficient_baseline'); });
    const outcome = await startTrials([finding('a', 'list_files'), finding('b', 'grep_files'), finding('c', 'glob_files')], start, (e) => (e.message === 'insufficient_baseline' ? 'More known baseline calls are needed.' : e.message));
    expect(start.mock.calls.map(([f]) => f.id)).toEqual(['a', 'b', 'c']);
    expect(outcome).toEqual({ started: 2, refused: [{ capability: 'grep_files', reason: 'More known baseline calls are needed.' }] });
    expect(refusedSentence(outcome)).toBe('2 of 3 trials started. grep_files: More known baseline calls are needed.');
    expect(refusedSentence({ started: 0, refused: [{ capability: 'x', reason: 'No.' }] })).toBe('No trial started. x: No.');
    expect(refusedSentence({ started: 3, refused: [] })).toBe('');
  });

  it('an abort (the account changed, the page closed) stops the whole run', async () => {
    const abort = Object.assign(new Error('Account changed'), { name: 'AbortError' });
    const start = vi.fn(async () => { throw abort; });
    await expect(startTrials([finding('a', 'x'), finding('b', 'y')], start)).rejects.toBe(abort);
    expect(start).toHaveBeenCalledTimes(1);
  });
});

describe('learning words', () => {
  it('the one page states the evidence and the trial terms', () => {
    const page = onePage({ capability: 'read_file', error_kind: 'unavailable', occurrences: 1, independent_runs: 1, candidate: { when: {} } });
    expect(page.happened).toBe('read_file could not reach its service 1 time across 1 separate run.');
    expect(page.tryText).toContain('after it cannot reach its service');
    expect(page.know).toContain('fall by at least 10 points');
  });

  it('same problem elsewhere: same error kind, another tool, a supported change, not already tested; most frequent first', () => {
    const policy = { capability: 'read_file', error_kind: 'timeout' };
    const findings = [
      { id: 'self', capability: 'read_file', error_kind: 'timeout', state: 'detected', candidate: {}, candidate_hash: 'h', occurrences: 9 },
      { id: 'other-kind', capability: 'list_files', error_kind: 'unavailable', state: 'detected', candidate: {}, candidate_hash: 'h', occurrences: 9 },
      { id: 'no-change', capability: 'web_scrape', error_kind: 'timeout', state: 'detected', candidate: null, candidate_hash: null, occurrences: 9 },
      { id: 'testing', capability: 'glob_files', error_kind: 'timeout', state: 'watching', candidate: {}, candidate_hash: 'h', occurrences: 9 },
      { id: 'few', capability: 'grep_files', error_kind: 'timeout', state: 'detected', candidate: {}, candidate_hash: 'h', occurrences: 3 },
      { id: 'many', capability: 'list_files', error_kind: 'timeout', state: 'detected', candidate: {}, candidate_hash: 'h', occurrences: 8 },
    ];
    expect(sameProblemElsewhere(policy, findings).map((f) => f.id)).toEqual(['many', 'few']);
    expect(sameProblemElsewhere(null, findings)).toEqual([]);
  });
});
