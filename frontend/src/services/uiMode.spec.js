import { describe, it, expect } from 'vitest';
import {
  UI_MODES,
  DEFAULT_UI_MODE,
  normalizeUiMode,
  resolveUiMode,
  otherUiMode,
  readStoredUiMode,
  isUiModeToggleKey,
} from './uiMode.js';

describe('uiMode', () => {
  it('has exactly two modes and a valid default', () => {
    expect(UI_MODES).toEqual(['simple', 'studio']);
    expect(UI_MODES).toContain(DEFAULT_UI_MODE);
  });

  describe('normalizeUiMode', () => {
    it.each([
      ['simple', 'simple'],
      ['studio', 'studio'],
      [' Studio ', 'studio'],
      ['SIMPLE', 'simple'],
      ['pro', null],
      ['', null],
      [null, null],
      [undefined, null],
      [1, null],
      [{}, null],
    ])('%j -> %j', (raw, expected) => {
      expect(normalizeUiMode(raw)).toBe(expected);
    });
  });

  describe('resolveUiMode', () => {
    it('an explicit choice wins', () => {
      expect(resolveUiMode({ explicit: 'simple', fallback: 'studio' })).toBe('simple');
      expect(resolveUiMode({ explicit: 'studio', fallback: 'simple' })).toBe('studio');
    });
    it('no choice falls back, then to the default', () => {
      expect(resolveUiMode({ fallback: 'simple' })).toBe('simple');
      expect(resolveUiMode({})).toBe(DEFAULT_UI_MODE);
      expect(resolveUiMode()).toBe(DEFAULT_UI_MODE);
    });
    it('garbage degrades to the default, never to an unknown mode', () => {
      expect(resolveUiMode({ explicit: 'classic', fallback: 'nope' })).toBe(DEFAULT_UI_MODE);
    });
  });

  it('otherUiMode flips, and treats garbage as the default', () => {
    expect(otherUiMode('simple')).toBe('studio');
    expect(otherUiMode('studio')).toBe('simple');
    expect(otherUiMode('garbage')).toBe(otherUiMode(DEFAULT_UI_MODE));
  });

  describe('readStoredUiMode', () => {
    it('reads a valid value', () => {
      expect(readStoredUiMode({ getItem: () => 'simple' })).toBe('simple');
    });
    it('rejects an invalid value', () => {
      expect(readStoredUiMode({ getItem: () => 'pro' })).toBeNull();
    });
    it('survives storage that throws (private mode)', () => {
      expect(
        readStoredUiMode({
          getItem: () => {
            throw new Error('denied');
          },
        }),
      ).toBeNull();
    });
    it('survives missing storage', () => {
      expect(readStoredUiMode(undefined)).toBeNull();
    });
  });

  describe('isUiModeToggleKey', () => {
    const ev = (o) => ({ key: 's', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...o });
    it('matches Ctrl+Shift+S and ⌘+Shift+S in either case', () => {
      expect(isUiModeToggleKey(ev({ ctrlKey: true, shiftKey: true }))).toBe(true);
      expect(isUiModeToggleKey(ev({ metaKey: true, shiftKey: true, key: 'S' }))).toBe(true);
    });
    it('rejects near misses', () => {
      expect(isUiModeToggleKey(ev({ ctrlKey: true }))).toBe(false); // Ctrl+S is save
      expect(isUiModeToggleKey(ev({ shiftKey: true }))).toBe(false);
      expect(isUiModeToggleKey(ev({ ctrlKey: true, shiftKey: true, altKey: true }))).toBe(false);
      expect(isUiModeToggleKey(ev({ ctrlKey: true, shiftKey: true, key: 'd' }))).toBe(false);
      expect(isUiModeToggleKey(null)).toBe(false);
    });
  });
});
