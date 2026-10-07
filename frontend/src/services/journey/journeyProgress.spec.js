import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  emptyProgress,
  loadProgress,
  normalizeProgress,
  offersEnabled,
  progressKey,
  saveProgress,
  toursEnabled,
} from './journeyProgress.js';

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => { data[key] = String(value); },
    data,
  };
}

describe('journey progress', () => {
  let storage;
  beforeEach(() => { storage = memoryStorage(); });

  it('is per account, case-insensitively', () => {
    saveProgress('Ann@Example.com', { ...emptyProgress(), done: { 'first-chat': true } }, storage);
    expect(loadProgress('ann@example.com', storage).done).toEqual({ 'first-chat': true });
    expect(loadProgress('bob@example.com', storage).done).toEqual({});
    expect(progressKey(null)).toBe('agnt.journey.v1:anonymous');
  });

  it('round-trips everything it stores', () => {
    const saved = { done: { a: true }, dismissed: { b: true }, flags: { modelChosen: true }, checklistHidden: true, celebrated: true };
    saveProgress('x', saved, storage);
    expect(loadProgress('x', storage)).toEqual(saved);
  });

  it('reads anything malformed as a fresh start', () => {
    storage.setItem(progressKey('x'), '{not json');
    expect(loadProgress('x', storage)).toEqual(emptyProgress());
    expect(normalizeProgress([])).toEqual(emptyProgress());
    // Only literal `true` survives: a string "true" or an object is not a finished mission.
    expect(normalizeProgress({ done: { a: 'true', b: true, c: {} }, checklistHidden: 'yes' })).toEqual({ ...emptyProgress(), done: { b: true } });
  });

  it('a storage failure on save is reported, not thrown', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const broken = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
    expect(() => saveProgress('x', emptyProgress(), broken)).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('honours the two switches Settings has always written', () => {
    expect(toursEnabled(storage)).toBe(true);
    expect(offersEnabled(storage)).toBe(true);
    storage.setItem('tours_auto_start', 'false');
    expect(offersEnabled(storage)).toBe(false);
    storage.setItem('tours_auto_start', 'true');
    storage.setItem('tours_enabled', 'false');
    expect(toursEnabled(storage)).toBe(false);
    expect(offersEnabled(storage)).toBe(false); // off means off, offers included
  });
});
