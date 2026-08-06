/**
 * userPreferences — merge/validation semantics.
 *
 * These are the rules the endpoint's correctness rests on, and every one of
 * them is a bug someone would otherwise hit in the field:
 *   - a stale tab replaying an old theme over a new one
 *   - a laptop's panel widths landing on a desktop
 *   - a numeric string from localStorage being stored as a string and then
 *     compared as a number somewhere downstream
 *   - an unknown key silently "succeeding"
 */

import { describe, it, expect } from 'vitest';
import {
  parsePreferences,
  mergePreferences,
  serializePreferences,
  projectForDevice,
  emptyPreferences,
  isValidDeviceId,
  MAX_DEVICES,
} from './userPreferences.js';

const DEV_A = 'dev-aaaa1111';
const DEV_B = 'dev-bbbb2222';

describe('parsePreferences', () => {
  it('returns an empty structure for null/garbage rather than throwing', () => {
    expect(parsePreferences(null)).toEqual(emptyPreferences());
    expect(parsePreferences('')).toEqual(emptyPreferences());
    expect(parsePreferences('{not json')).toEqual(emptyPreferences());
    expect(parsePreferences('[1,2,3]')).toEqual(emptyPreferences());
    expect(parsePreferences('"a string"')).toEqual(emptyPreferences());
  });

  it('re-validates stored content, dropping keys no longer in the allowlist', () => {
    const stored = JSON.stringify({
      global: { currentTheme: 'dark', retiredKey: 'whatever', bgOpacity: 999 },
      devices: {},
      updatedAt: 5,
    });
    const parsed = parsePreferences(stored);
    expect(parsed.global.currentTheme).toBe('dark');
    expect(parsed.global).not.toHaveProperty('retiredKey');
    // out-of-range clamps rather than vanishing
    expect(parsed.global.bgOpacity).toBe(100);
  });

  it('drops device buckets with malformed ids', () => {
    const stored = JSON.stringify({
      global: {},
      devices: {
        [DEV_A]: { prefs: { uiScale: 110 }, updatedAt: 1 },
        'bad id with spaces': { prefs: { uiScale: 120 }, updatedAt: 2 },
      },
      updatedAt: 0,
    });
    const parsed = parsePreferences(stored);
    expect(Object.keys(parsed.devices)).toEqual([DEV_A]);
  });
});

describe('validation and coercion', () => {
  it('accepts numeric strings, because localStorage round-trips through strings', () => {
    const { next } = mergePreferences(null, { deviceId: DEV_A, device: { leftPanelWidth: '384' } }, 100);
    expect(next.devices[DEV_A].prefs.leftPanelWidth).toBe(384);
    expect(typeof next.devices[DEV_A].prefs.leftPanelWidth).toBe('number');
  });

  it('accepts the strings "true"/"false" as booleans', () => {
    const { next } = mergePreferences(null, { global: { darkMode: 'true', greyscaleMode: 'false' } }, 100);
    expect(next.global.darkMode).toBe(true);
    expect(next.global.greyscaleMode).toBe(false);
  });

  it('does NOT coerce empty string to 0 — that would collapse a panel', () => {
    const { next, result } = mergePreferences(null, { deviceId: DEV_A, device: { leftPanelWidth: '' } }, 100);
    expect(next.devices[DEV_A]?.prefs).not.toHaveProperty('leftPanelWidth');
    expect(result.device.rejected[0]).toMatchObject({ key: 'leftPanelWidth' });
  });

  it('clamps out-of-range numbers instead of rejecting them', () => {
    const { next } = mergePreferences(null, { deviceId: DEV_A, device: { uiScale: 5000 } }, 100);
    expect(next.devices[DEV_A].prefs.uiScale).toBe(150);
  });

  it('rejects unknown keys and says so, instead of silently succeeding', () => {
    const { next, result } = mergePreferences(null, { global: { evilKey: 'x', currentTheme: 'cyber' } }, 100);
    expect(next.global).toEqual({ currentTheme: 'cyber' });
    expect(result.global.rejected).toEqual([{ key: 'evilKey', reason: 'unknown key' }]);
    expect(result.global.applied).toEqual(['currentTheme']);
  });

  it('rejects a global key sent to the device scope and vice versa', () => {
    const { result } = mergePreferences(
      null,
      { global: { uiScale: 120 }, deviceId: DEV_A, device: { currentTheme: 'dark' } },
      100,
    );
    expect(result.global.rejected).toEqual([{ key: 'uiScale', reason: 'unknown key' }]);
    expect(result.device.rejected).toEqual([{ key: 'currentTheme', reason: 'unknown key' }]);
  });

  it('enforces the panelPosition enum', () => {
    const { result } = mergePreferences(null, { global: { panelPosition: 'diagonal' } }, 100);
    expect(result.global.rejected[0].key).toBe('panelPosition');
  });
});

describe('merge is partial, not a replace', () => {
  it('leaves untouched keys alone so an older client cannot erase newer ones', () => {
    const first = mergePreferences(null, { global: { currentTheme: 'dark', fontFamily: 'mono' } }, 100).next;
    const second = mergePreferences(first, { global: { fontFamily: 'sans' } }, 200).next;
    expect(second.global.currentTheme).toBe('dark');
    expect(second.global.fontFamily).toBe('sans');
  });

  it('treats explicit null as a deletion', () => {
    const first = mergePreferences(null, { global: { currentTheme: 'dark', fontFamily: 'mono' } }, 100).next;
    const { next, result } = mergePreferences(first, { global: { fontFamily: null } }, 200);
    expect(next.global).toEqual({ currentTheme: 'dark' });
    expect(result.global.deleted).toEqual(['fontFamily']);
  });
});

describe('global scope is last-write-wins', () => {
  it('ignores a patch older than the stored state', () => {
    const fresh = mergePreferences(null, { global: { currentTheme: 'cyberpunk' }, updatedAt: 500 }, 500).next;
    const { next, result } = mergePreferences(fresh, { global: { currentTheme: 'dark' }, updatedAt: 200 }, 600);
    expect(next.global.currentTheme).toBe('cyberpunk');
    expect(result.global.staleIgnored).toBe(true);
    expect(result.global.applied).toEqual([]);
  });

  it('applies a newer patch', () => {
    const old = mergePreferences(null, { global: { currentTheme: 'dark' }, updatedAt: 200 }, 200).next;
    const { next, result } = mergePreferences(old, { global: { currentTheme: 'cyberpunk' }, updatedAt: 500 }, 500);
    expect(next.global.currentTheme).toBe('cyberpunk');
    expect(result.global.staleIgnored).toBe(false);
  });

  it('applies on an equal timestamp — same-ms is one client sending twice, not a race', () => {
    const a = mergePreferences(null, { global: { currentTheme: 'dark' }, updatedAt: 300 }, 300).next;
    const { next } = mergePreferences(a, { global: { fontFamily: 'mono' }, updatedAt: 300 }, 300);
    expect(next.global.fontFamily).toBe('mono');
  });

  it('does not advance updatedAt when a patch changed nothing', () => {
    const a = mergePreferences(null, { global: { currentTheme: 'dark' }, updatedAt: 300 }, 300).next;
    const { next } = mergePreferences(a, { global: { bogus: 1 }, updatedAt: 900 }, 900);
    expect(next.updatedAt).toBe(300);
  });
});

describe('device scope is isolated — the reason this feature is not one flat bag', () => {
  it('does not let one device overwrite another device geometry', () => {
    const desktop = mergePreferences(null, { deviceId: DEV_A, device: { leftPanelWidth: 500 } }, 100).next;
    const { next } = mergePreferences(desktop, { deviceId: DEV_B, device: { leftPanelWidth: 200 } }, 200);
    expect(next.devices[DEV_A].prefs.leftPanelWidth).toBe(500);
    expect(next.devices[DEV_B].prefs.leftPanelWidth).toBe(200);
  });

  it('applies device writes even when they are older than global state (uncontended)', () => {
    const fresh = mergePreferences(null, { global: { currentTheme: 'dark' }, updatedAt: 900 }, 900).next;
    const { next } = mergePreferences(fresh, { deviceId: DEV_A, device: { uiScale: 90 }, updatedAt: 100 }, 100);
    expect(next.devices[DEV_A].prefs.uiScale).toBe(90);
  });

  it('rejects a device patch with no usable deviceId rather than inventing one', () => {
    const { next, result } = mergePreferences(null, { device: { uiScale: 90 } }, 100);
    expect(next.devices).toEqual({});
    expect(result.device.rejected[0].reason).toMatch(/deviceId/);
  });

  it('evicts the least-recently-used bucket past the cap, never the current one', () => {
    let state = emptyPreferences();
    for (let i = 0; i < MAX_DEVICES; i++) {
      state = mergePreferences(state, { deviceId: `dev-${i}`, device: { uiScale: 100 } }, 1000 + i).next;
    }
    expect(Object.keys(state.devices)).toHaveLength(MAX_DEVICES);

    const { next, result } = mergePreferences(state, { deviceId: 'dev-new', device: { uiScale: 125 } }, 9999);
    expect(Object.keys(next.devices)).toHaveLength(MAX_DEVICES);
    expect(next.devices['dev-new'].prefs.uiScale).toBe(125);
    expect(result.evictedDevices).toEqual(['dev-0']);
  });
});

describe('serializePreferences', () => {
  it('returns null when nothing is stored, so the column clears', () => {
    expect(serializePreferences(emptyPreferences())).toBeNull();
  });

  it('round-trips through parse without loss', () => {
    const { next } = mergePreferences(
      null,
      { global: { currentTheme: 'dark', bgBlur: 4 }, deviceId: DEV_A, device: { uiScale: 110 }, updatedAt: 42 },
      42,
    );
    const round = parsePreferences(serializePreferences(next));
    expect(round.global).toEqual({ currentTheme: 'dark', bgBlur: 4 });
    expect(round.devices[DEV_A].prefs).toEqual({ uiScale: 110 });
    expect(round.updatedAt).toBe(42);
  });
});

describe('projectForDevice', () => {
  it('resolves this device bucket and hides the storage layout', () => {
    const { next } = mergePreferences(
      null,
      { global: { currentTheme: 'dark' }, deviceId: DEV_A, device: { uiScale: 110 }, deviceLabel: 'iMac' },
      100,
    );
    const view = projectForDevice(next, DEV_A);
    expect(view.global).toEqual({ currentTheme: 'dark' });
    expect(view.device).toEqual({ uiScale: 110 });
    expect(view.knownDevices).toEqual([
      { deviceId: DEV_A, label: 'iMac', updatedAt: 100, current: true },
    ]);
  });

  it('returns an empty device bucket for a device that has never written', () => {
    const { next } = mergePreferences(null, { global: { currentTheme: 'dark' } }, 100);
    const view = projectForDevice(next, DEV_B);
    expect(view.device).toEqual({});
    expect(view.global).toEqual({ currentTheme: 'dark' });
  });
});

describe('isValidDeviceId', () => {
  it('accepts opaque url-safe ids and rejects everything else', () => {
    expect(isValidDeviceId('dev-abc_123')).toBe(true);
    expect(isValidDeviceId('')).toBe(false);
    expect(isValidDeviceId('has space')).toBe(false);
    expect(isValidDeviceId('../../etc/passwd')).toBe(false);
    expect(isValidDeviceId('x'.repeat(65))).toBe(false);
    expect(isValidDeviceId(null)).toBe(false);
  });
});
