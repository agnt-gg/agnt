// The ephemeral background overlay exists so an assistant can change what the
// user is looking at WITHOUT touching what the user chose. Everything below is
// really one property stated five ways: the overlay is memory-only and fully
// reversible. If any of these go red, a chat preview has become a setting.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createStore } from 'vuex';

const mediaStorage = {
  setItem: vi.fn().mockResolvedValue(undefined),
  getItem: vi.fn().mockResolvedValue(null),
  removeItem: vi.fn().mockResolvedValue(undefined),
};
vi.mock('../../utils/mediaStorage.js', () => ({ mediaStorage }));

// theme.js reads localStorage at MODULE LOAD to build initial state, so the
// stub has to exist before the dynamic import below.
const store = new Map();
const localStorageMock = {
  getItem: vi.fn((k) => (store.has(k) ? store.get(k) : null)),
  setItem: vi.fn((k, v) => store.set(k, String(v))),
  removeItem: vi.fn((k) => store.delete(k)),
  clear: vi.fn(() => store.clear()),
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

const { default: themeModule } = await import('./theme.js');

// theme.js exports its `state` as a plain OBJECT, not a factory, so every
// createStore() call would otherwise share one mutable instance and a commit in
// one test would leak into the next. Snapshot it once and hand each store a
// fresh clone.
const BASE_STATE = structuredClone(themeModule.state);
const makeStore = () => createStore({
  modules: {
    theme: { ...themeModule, namespaced: true, state: structuredClone(BASE_STATE) },
  },
});

const OVERLAY = { url: '/api/local-file/C:/x/annie.png', type: 'image', fileName: 'annie.png' };

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  document.body.className = '';
  document.body.removeAttribute('style');
});

describe('overlay precedence', () => {
  it('wins over the persisted background while set', () => {
    const s = makeStore();
    s.commit('theme/SET_CURRENT_BACKGROUND', { url: 'blob:user-bg', type: 'image' });
    expect(s.getters['theme/currentThemeBackgroundImage']).toBe('blob:user-bg');

    s.dispatch('theme/setEphemeralBackground', OVERLAY);
    expect(s.getters['theme/currentThemeBackgroundImage']).toBe(OVERLAY.url);
  });

  it('falls back to the persisted background the moment it is cleared', () => {
    const s = makeStore();
    s.commit('theme/SET_CURRENT_BACKGROUND', { url: 'blob:user-bg', type: 'image' });
    s.dispatch('theme/setEphemeralBackground', OVERLAY);
    s.dispatch('theme/clearEphemeralBackground');

    expect(s.state.theme.ephemeralBackground).toBeNull();
    expect(s.getters['theme/currentThemeBackgroundImage']).toBe('blob:user-bg');
  });

  it('carries its own type so a video overlay over an image background renders as video', () => {
    const s = makeStore();
    s.commit('theme/SET_CURRENT_BACKGROUND', { url: 'blob:user-bg', type: 'image' });
    s.dispatch('theme/setEphemeralBackground', { url: '/api/local-file/x/loop.mp4', type: 'video' });

    expect(s.getters['theme/currentBackgroundType']).toBe('video');
    expect(s.getters['theme/isCurrentBackgroundVideo']).toBe(true);
  });

  it('defaults to image when no type is supplied', () => {
    const s = makeStore();
    s.dispatch('theme/setEphemeralBackground', { url: '/api/local-file/x/a.png' });
    expect(s.getters['theme/currentBackgroundType']).toBe('image');
  });
});

describe('it never persists', () => {
  it('writes nothing to localStorage', () => {
    const s = makeStore();
    localStorageMock.setItem.mockClear();
    localStorageMock.removeItem.mockClear();

    s.dispatch('theme/setEphemeralBackground', OVERLAY);
    s.dispatch('theme/clearEphemeralBackground');

    expect(localStorageMock.setItem).not.toHaveBeenCalled();
    expect(localStorageMock.removeItem).not.toHaveBeenCalled();
  });

  it('writes nothing to IndexedDB', () => {
    const s = makeStore();
    s.dispatch('theme/setEphemeralBackground', OVERLAY);
    expect(mediaStorage.setItem).not.toHaveBeenCalled();
    expect(mediaStorage.removeItem).not.toHaveBeenCalled();
  });

  it('leaves the user\'s per-theme "has a custom background" flags untouched', () => {
    const s = makeStore();
    const before = JSON.stringify(s.state.theme.hasCustomBackground);
    s.dispatch('theme/setEphemeralBackground', OVERLAY);
    expect(JSON.stringify(s.state.theme.hasCustomBackground)).toBe(before);
  });

  it('leaves the user\'s useCustomBackground toggle untouched', () => {
    const s = makeStore();
    expect(s.state.theme.useCustomBackground).toBe(false);
    s.dispatch('theme/setEphemeralBackground', OVERLAY);
    // The overlay activates the LAYER without flipping the user's SETTING.
    expect(s.state.theme.useCustomBackground).toBe(false);
    expect(s.getters['theme/useCustomBackground']).toBe(false);
    expect(s.getters['theme/backgroundLayerActive']).toBe(true);
  });

  it('does not revoke the persisted object URL underneath', () => {
    // SET_CURRENT_BACKGROUND revokes on replace. If the overlay went through
    // that path it would destroy the user's blob URL and clearing would restore
    // a dead reference.
    const s = makeStore();
    const revoke = vi.fn();
    globalThis.URL.revokeObjectURL = revoke;

    s.commit('theme/SET_CURRENT_BACKGROUND', { url: 'blob:user-bg', type: 'image' });
    s.dispatch('theme/setEphemeralBackground', OVERLAY);
    s.dispatch('theme/clearEphemeralBackground');

    expect(revoke).not.toHaveBeenCalledWith('blob:user-bg');
    expect(s.state.theme.currentBackgroundUrl).toBe('blob:user-bg');
  });
});

describe('backgroundLayerActive', () => {
  it('is false when neither source wants a layer', () => {
    expect(makeStore().getters['theme/backgroundLayerActive']).toBe(false);
  });

  it('is true from the user setting alone', () => {
    const s = makeStore();
    s.commit('theme/SET_USE_CUSTOM_BACKGROUND', true);
    expect(s.getters['theme/backgroundLayerActive']).toBe(true);
  });

  it('is true from the overlay alone', () => {
    const s = makeStore();
    s.dispatch('theme/setEphemeralBackground', OVERLAY);
    expect(s.getters['theme/backgroundLayerActive']).toBe(true);
  });

  it('returns to the user setting after the overlay clears', () => {
    const s = makeStore();
    s.dispatch('theme/setEphemeralBackground', OVERLAY);
    s.dispatch('theme/clearEphemeralBackground');
    expect(s.getters['theme/backgroundLayerActive']).toBe(false);
  });
});

describe('panel transparency follows the layer, not the setting', () => {
  it('adds body.custom-bg for an overlay even with the user setting off', () => {
    // Without this the image renders at z-index -1 behind fully opaque panels
    // and the user sees no change at all.
    const s = makeStore();
    s.dispatch('theme/setEphemeralBackground', OVERLAY);
    expect(document.body.classList.contains('custom-bg')).toBe(true);
  });

  it('removes body.custom-bg when the overlay clears and the setting is off', () => {
    const s = makeStore();
    s.dispatch('theme/setEphemeralBackground', OVERLAY);
    s.dispatch('theme/clearEphemeralBackground');
    expect(document.body.classList.contains('custom-bg')).toBe(false);
  });

  it('keeps body.custom-bg when the overlay clears but the user setting is on', () => {
    const s = makeStore();
    s.commit('theme/SET_USE_CUSTOM_BACKGROUND', true);
    s.dispatch('theme/setEphemeralBackground', OVERLAY);
    s.dispatch('theme/clearEphemeralBackground');
    expect(document.body.classList.contains('custom-bg')).toBe(true);
  });
});

describe('input handling', () => {
  it('treats a falsy url as a clear', () => {
    const s = makeStore();
    s.dispatch('theme/setEphemeralBackground', OVERLAY);
    s.dispatch('theme/setEphemeralBackground', { url: null });
    expect(s.state.theme.ephemeralBackground).toBeNull();
  });

  it('survives being dispatched with no payload', () => {
    const s = makeStore();
    expect(() => s.dispatch('theme/setEphemeralBackground')).not.toThrow();
    expect(s.state.theme.ephemeralBackground).toBeNull();
  });

  it('copies the payload rather than holding the caller\'s object', () => {
    const s = makeStore();
    const payload = { ...OVERLAY };
    s.dispatch('theme/setEphemeralBackground', payload);
    payload.url = '/api/local-file/C:/x/other.png';
    expect(s.state.theme.ephemeralBackground.url).toBe(OVERLAY.url);
  });
});
