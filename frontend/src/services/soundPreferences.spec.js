import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  DEFAULT_MASTER_VOLUME,
  SOUND_EVENTS,
  SOUND_FILES,
  getConfigurableSoundEvents,
  getEventPreferences,
  getMasterEnabled,
  getMasterVolume,
  getSoundEvent,
  resetEventPreferences,
  resolveSound,
  setEventPreferences,
  setMasterEnabled,
  setMasterVolume,
} from './soundPreferences';

describe('soundPreferences', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('catalog', () => {
    it('registers the conversation-complete sound as configurable', () => {
      const event = getSoundEvent('chatUnread');
      expect(event).toBeTruthy();
      expect(event.configurable).toBe(true);
      expect(event.defaultSrc).toBe('/sounds/success-chime.mp3');
    });

    it('exposes exactly the configurable events to the settings panel', () => {
      const ids = getConfigurableSoundEvents().map((e) => e.id);
      expect(ids).toContain('chatUnread');
      expect(ids.every((id) => getSoundEvent(id).configurable)).toBe(true);
    });

    it('every catalogued event points at a shipped audio file', () => {
      const known = new Set(SOUND_FILES.map((f) => f.src));
      for (const event of SOUND_EVENTS) {
        expect(known.has(event.defaultSrc), `${event.id} -> ${event.defaultSrc}`).toBe(true);
      }
    });

    it('returns null for an unregistered event', () => {
      expect(getSoundEvent('nope')).toBeNull();
      expect(resolveSound('nope')).toBeNull();
    });
  });

  describe('backwards compatibility', () => {
    // This is the safety argument for adding a second volume layer: an install
    // that has never touched a per-event control must behave identically.
    it('an untouched install resolves to the master volume alone', () => {
      expect(resolveSound('chatUnread')).toEqual({ src: '/sounds/success-chime.mp3', volume: DEFAULT_MASTER_VOLUME });
    });

    it('respects a saved master volume with no event prefs', () => {
      setMasterVolume(0.8);
      expect(resolveSound('chatUnread').volume).toBeCloseTo(0.8);
    });

    it('an explicit volume override still wins over master when untouched', () => {
      setMasterVolume(0.9);
      expect(resolveSound('chaChingMoney', 0.15).volume).toBeCloseTo(0.15);
    });

    it('master defaults to enabled when nothing is stored', () => {
      expect(getMasterEnabled()).toBe(true);
      expect(getMasterVolume()).toBe(DEFAULT_MASTER_VOLUME);
    });
  });

  describe('master controls', () => {
    it('silences everything when the master toggle is off', () => {
      setMasterEnabled(false);
      expect(resolveSound('chatUnread')).toBeNull();
      expect(resolveSound('buttonClick', 0.5)).toBeNull();
    });

    it('clamps an out-of-range master volume', () => {
      setMasterVolume(4);
      expect(getMasterVolume()).toBe(1);
      setMasterVolume(-1);
      expect(getMasterVolume()).toBe(0);
    });

    it('falls back to the default when the stored volume is garbage', () => {
      localStorage.setItem('soundVolume', 'not-a-number');
      expect(getMasterVolume()).toBe(DEFAULT_MASTER_VOLUME);
    });
  });

  describe('per-event preferences', () => {
    it('multiplies the event level against master', () => {
      setMasterVolume(0.5);
      setEventPreferences('chatUnread', { volume: 0.5 });
      expect(resolveSound('chatUnread').volume).toBeCloseTo(0.25);
    });

    it('mutes one event without touching the others', () => {
      setEventPreferences('chatUnread', { enabled: false });
      expect(resolveSound('chatUnread')).toBeNull();
      expect(resolveSound('buttonClick')).not.toBeNull();
    });

    it('treats a zero effective volume as silence rather than a silent play', () => {
      setEventPreferences('chatUnread', { volume: 0 });
      expect(resolveSound('chatUnread')).toBeNull();
    });

    it('applies the event multiplier even when the caller hardcodes a volume', () => {
      setEventPreferences('chaChingMoney', { volume: 0.5 });
      expect(resolveSound('chaChingMoney', 0.6).volume).toBeCloseTo(0.3);
    });

    it('swaps the audio file when a custom src is chosen', () => {
      setEventPreferences('chatUnread', { src: '/sounds/woosh_s21KzKN.mp3' });
      expect(resolveSound('chatUnread').src).toBe('/sounds/woosh_s21KzKN.mp3');
    });

    it('falls back to the catalogued file when src is cleared', () => {
      setEventPreferences('chatUnread', { src: '/sounds/woosh_s21KzKN.mp3' });
      setEventPreferences('chatUnread', { src: '' });
      expect(resolveSound('chatUnread').src).toBe('/sounds/success-chime.mp3');
    });

    it('merges patches instead of replacing the whole entry', () => {
      setEventPreferences('chatUnread', { volume: 0.4 });
      setEventPreferences('chatUnread', { src: '/sounds/woosh_s21KzKN.mp3' });
      const prefs = getEventPreferences('chatUnread');
      expect(prefs.volume).toBeCloseTo(0.4);
      expect(prefs.src).toBe('/sounds/woosh_s21KzKN.mp3');
    });

    it('keeps events isolated from one another', () => {
      setEventPreferences('chatUnread', { volume: 0.2 });
      expect(getEventPreferences('buttonClick').volume).toBe(1);
    });

    it('resets an event back to catalogue defaults', () => {
      setEventPreferences('chatUnread', { enabled: false, volume: 0.1, src: '/sounds/woosh_s21KzKN.mp3' });
      resetEventPreferences('chatUnread');
      expect(getEventPreferences('chatUnread')).toEqual({
        enabled: true,
        volume: 1,
        src: '/sounds/success-chime.mp3',
      });
    });

    it('survives a corrupt preferences blob', () => {
      localStorage.setItem('soundEventPrefs', '{not json');
      expect(getEventPreferences('chatUnread').enabled).toBe(true);
      expect(resolveSound('chatUnread')).not.toBeNull();
    });

    it('survives a non-object preferences blob', () => {
      localStorage.setItem('soundEventPrefs', '["chatUnread"]');
      expect(getEventPreferences('chatUnread').volume).toBe(1);
    });

    it('survives a non-object entry for a single event', () => {
      localStorage.setItem('soundEventPrefs', JSON.stringify({ chatUnread: 'loud' }));
      expect(getEventPreferences('chatUnread')).toEqual({
        enabled: true,
        volume: 1,
        src: '/sounds/success-chime.mp3',
      });
    });

    it('does not throw when storage is full', () => {
      const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('QuotaExceededError');
      });
      expect(() => setEventPreferences('chatUnread', { volume: 0.5 })).not.toThrow();
      spy.mockRestore();
    });

    it('does not throw when storage reads throw', () => {
      const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new DOMException('SecurityError');
      });
      expect(() => resolveSound('chatUnread')).not.toThrow();
      expect(resolveSound('chatUnread')).not.toBeNull();
      spy.mockRestore();
    });
  });

  describe('change notification', () => {
    it('broadcasts the legacy sounds-settings-changed contract on write', () => {
      const listener = vi.fn();
      window.addEventListener('sounds-settings-changed', listener);
      setMasterVolume(0.7);
      setEventPreferences('chatUnread', { volume: 0.5 });
      window.removeEventListener('sounds-settings-changed', listener);

      expect(listener).toHaveBeenCalled();
      const { detail } = listener.mock.calls.at(-1)[0];
      expect(detail).toEqual({ enabled: true, volume: 0.7 });
    });
  });
});
