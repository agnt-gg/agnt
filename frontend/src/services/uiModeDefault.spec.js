import { describe, it, expect } from 'vitest';
import { classifyAccount, defaultModeFor, graduationUnlock, readFlag, writeFlag } from './uiModeDefault.js';

describe('classifyAccount', () => {
  it('nothing yet is a new account', () => {
    expect(classifyAccount({ chats: 0, agents: 0, workflows: 0 })).toBe('new');
  });
  it('any chat, agent or workflow makes it existing', () => {
    expect(classifyAccount({ chats: 1, agents: 0, workflows: 0 })).toBe('existing');
    expect(classifyAccount({ chats: 0, agents: 1, workflows: 0 })).toBe('existing');
    expect(classifyAccount({ chats: 0, agents: 0, workflows: 3 })).toBe('existing');
  });
  it('is undecided until every fact has loaded \u2014 a slow fetch is not an empty account', () => {
    expect(classifyAccount({ chats: 0, agents: 0 })).toBeNull();
    expect(classifyAccount({})).toBeNull();
    expect(classifyAccount()).toBeNull();
  });
});

it('new starts in Simple, everything else in Studio', () => {
  expect(defaultModeFor('new')).toBe('simple');
  expect(defaultModeFor('existing')).toBe('studio');
  expect(defaultModeFor(null)).toBe('studio');
});

describe('graduationUnlock', () => {
  it('offers on the first workflow or agent', () => {
    expect(graduationUnlock(['workflows'], false)).toBe('workflows');
    expect(graduationUnlock(['apps', 'agents'], false)).toBe('agents');
  });
  it('does not offer for unlocks that are not building', () => {
    expect(graduationUnlock(['apps', 'artifacts', 'traces'], false)).toBeNull();
  });
  it('asks once, ever', () => {
    expect(graduationUnlock(['workflows'], true)).toBeNull();
  });
  it('survives junk', () => {
    expect(graduationUnlock(null, false)).toBeNull();
  });
});

describe('flags', () => {
  it('round-trip, and storage that throws reads as unset', () => {
    const mem = new Map();
    const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
    expect(readFlag('k', storage)).toBe(false);
    writeFlag('k', storage);
    expect(readFlag('k', storage)).toBe(true);
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(readFlag('k', broken)).toBe(false);
    expect(() => writeFlag('k', broken)).not.toThrow();
  });
});
