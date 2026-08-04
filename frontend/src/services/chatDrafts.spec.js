import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { getDraft, setDraft, clearDraft, MAX_DRAFT_CHARS, MAX_DRAFTS } from './chatDrafts.js';

const KEY = 'chatDraftsV1';

beforeEach(() => {
  localStorage.removeItem(KEY);
});

afterEach(() => {
  localStorage.removeItem(KEY);
  vi.restoreAllMocks();
});

describe('chatDrafts — isolation, the property this module exists for', () => {
  it('a draft saved under one conversation never appears under another', () => {
    setDraft('convo-a', 'half-finished thought');
    expect(getDraft('convo-b')).toBe('');
    expect(getDraft('convo-a')).toBe('half-finished thought');
  });

  it('drafts for many conversations coexist independently', () => {
    setDraft('a', 'alpha');
    setDraft('b', 'beta');
    setDraft('c', 'gamma');
    expect(getDraft('b')).toBe('beta');
    setDraft('b', 'beta 2');
    expect(getDraft('a')).toBe('alpha');
    expect(getDraft('b')).toBe('beta 2');
    expect(getDraft('c')).toBe('gamma');
  });

  it('persists across module use — the storage, not the closure, is the truth', () => {
    setDraft('a', 'survives');
    // Fresh read from the actual localStorage blob.
    const raw = JSON.parse(localStorage.getItem(KEY));
    expect(raw.a.text).toBe('survives');
  });
});

describe('chatDrafts — clearing semantics', () => {
  it('an empty draft deletes the entry rather than storing a tombstone', () => {
    setDraft('a', 'something');
    setDraft('a', '');
    expect(getDraft('a')).toBe('');
    expect(JSON.parse(localStorage.getItem(KEY) || '{}').a).toBeUndefined();
  });

  it('whitespace-only counts as empty', () => {
    setDraft('a', 'something');
    setDraft('a', '   \n  ');
    expect(getDraft('a')).toBe('');
  });

  it('clearDraft is the same as setting empty', () => {
    setDraft('a', 'something');
    clearDraft('a');
    expect(getDraft('a')).toBe('');
  });

  it('clearing a conversation leaves the others alone', () => {
    setDraft('a', 'alpha');
    setDraft('b', 'beta');
    clearDraft('a');
    expect(getDraft('b')).toBe('beta');
  });
});

describe('chatDrafts — bounded by construction', () => {
  it('clamps a draft longer than MAX_DRAFT_CHARS', () => {
    setDraft('a', 'x'.repeat(MAX_DRAFT_CHARS + 5000));
    expect(getDraft('a').length).toBe(MAX_DRAFT_CHARS);
  });

  it('evicts the OLDEST entries past MAX_DRAFTS, keeping the newest', () => {
    let t = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => (t += 1));
    for (let i = 0; i < MAX_DRAFTS + 5; i++) setDraft(`c${i}`, `draft ${i}`);

    const stored = JSON.parse(localStorage.getItem(KEY));
    expect(Object.keys(stored).length).toBe(MAX_DRAFTS);
    expect(getDraft('c0')).toBe(''); // oldest gone
    expect(getDraft(`c${MAX_DRAFTS + 4}`)).toBe(`draft ${MAX_DRAFTS + 4}`); // newest kept
  });
});

describe('chatDrafts — failure is never an error', () => {
  it('a corrupted blob reads as no drafts, not a throw', () => {
    localStorage.setItem(KEY, '{not json');
    expect(getDraft('a')).toBe('');
    expect(() => setDraft('a', 'recovers')).not.toThrow();
    expect(getDraft('a')).toBe('recovers');
  });

  it('a non-object blob is ignored', () => {
    localStorage.setItem(KEY, '[1,2,3]');
    expect(getDraft('a')).toBe('');
  });

  it('a storage write failure (quota, private mode) is swallowed', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => setDraft('a', 'text')).not.toThrow();
  });

  it('missing or non-string ids are no-ops', () => {
    expect(() => setDraft(null, 'x')).not.toThrow();
    expect(() => setDraft(undefined, 'x')).not.toThrow();
    expect(getDraft(null)).toBe('');
    expect(getDraft(42)).toBe('');
  });

  it('non-string text is treated as empty', () => {
    setDraft('a', 'real');
    setDraft('a', { evil: true });
    expect(getDraft('a')).toBe('');
  });
});
