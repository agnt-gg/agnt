// A background set from a chat turn must be INDISTINGUISHABLE from one the
// user picked in Settings → Theme. That is the whole point of this file.
//
// It replaces theme.ephemeralBackground.spec.js, which pinned the opposite
// contract: an in-memory overlay that never reached IndexedDB, never turned the
// setting on, and vanished on reload. That produced the bug this fixes —
// "you set a background, it isn't in my theme settings, and it's gone when I
// refresh." Two background systems meant two behaviours; there is one now.
//
// If any of these go red, the assistant has grown a private background system
// again.
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
const { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES } = await import('../../services/backgroundLimits.js');

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

const EVENT = { url: '/api/local-file/C:/x/annie.png', type: 'image', fileName: 'annie.png' };

// jsdom has no real object URLs; the store creates one per stored blob.
let objectUrlSeq = 0;
const createdObjectUrls = [];

function mockFetchOk(blob) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    blob: async () => blob,
  });
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  objectUrlSeq = 0;
  createdObjectUrls.length = 0;
  document.body.className = '';
  document.body.removeAttribute('style');
  URL.createObjectURL = vi.fn(() => {
    const url = `blob:mock-${++objectUrlSeq}`;
    createdObjectUrls.push(url);
    return url;
  });
  URL.revokeObjectURL = vi.fn();
  mockFetchOk(new Blob(['png-bytes'], { type: 'image/png' }));
});

// ── The core claim ────────────────────────────────────────────────────────────
describe('a chat-set background is the real setting', () => {
  it('persists the bytes to the same IndexedDB key the Settings picker uses', async () => {
    const s = makeStore();
    await s.dispatch('theme/applyAssistantBackground', EVENT);

    expect(mediaStorage.setItem).toHaveBeenCalledTimes(1);
    const [key, blob] = mediaStorage.setItem.mock.calls[0];
    // Same key shape as ThemeSelector's file picker writes.
    expect(key).toBe(`customBackgroundImage_${s.state.theme.currentTheme}`);
    expect(blob).toBeInstanceOf(Blob);
  });

  it('turns the Custom Background setting ON, so Settings shows it enabled', async () => {
    const s = makeStore();
    expect(s.state.theme.useCustomBackground).toBe(false);

    await s.dispatch('theme/applyAssistantBackground', EVENT);

    expect(s.state.theme.useCustomBackground).toBe(true);
    expect(localStorage.setItem).toHaveBeenCalledWith('useCustomBackground', true);
  });

  it('marks the theme as having a custom background so it survives a reload', async () => {
    const s = makeStore();
    await s.dispatch('theme/applyAssistantBackground', EVENT);

    const theme = s.state.theme.currentTheme;
    expect(s.state.theme.hasCustomBackground[theme]).toBe(true);
    expect(localStorage.setItem).toHaveBeenCalledWith(`customBackgroundImage_${theme}_exists`, 'true');
  });

  it('renders immediately — no reload, no second user action', async () => {
    const s = makeStore();
    await s.dispatch('theme/applyAssistantBackground', EVENT);

    expect(s.getters['theme/backgroundLayerActive']).toBe(true);
    expect(s.getters['theme/currentThemeBackgroundImage']).toBe(createdObjectUrls[0]);
    expect(document.body.classList.contains('custom-bg')).toBe(true);
  });

  it('records the file name so Settings labels it instead of saying "No file"', async () => {
    const s = makeStore();
    await s.dispatch('theme/applyAssistantBackground', EVENT);

    expect(s.getters['theme/backgroundFileName']).toBe('annie.png');
    expect(localStorage.setItem)
      .toHaveBeenCalledWith(`customBackgroundImage_${s.state.theme.currentTheme}_name`, 'annie.png');
  });

  it('is byte-for-byte the same store state as the Settings picker produces', async () => {
    const viaChat = makeStore();
    await viaChat.dispatch('theme/applyAssistantBackground', EVENT);

    const viaSettings = makeStore();
    viaSettings.commit('theme/SET_USE_CUSTOM_BACKGROUND', true);
    const file = new File(['png-bytes'], 'annie.png', { type: 'image/png' });
    await viaSettings.dispatch('theme/setCustomBackgroundImage', {
      theme: viaSettings.state.theme.currentTheme,
      file,
    });

    const shape = (s) => ({
      useCustomBackground: s.state.theme.useCustomBackground,
      hasCustomBackground: s.state.theme.hasCustomBackground,
      backgroundFileNames: s.state.theme.backgroundFileNames,
      type: s.state.theme.currentBackgroundType,
      layerActive: s.getters['theme/backgroundLayerActive'],
    });
    expect(shape(viaChat)).toEqual(shape(viaSettings));
  });
});

// ── Video ─────────────────────────────────────────────────────────────────────
describe('video backgrounds', () => {
  it('stores a video as a video so it still renders as <video> after a reload', async () => {
    mockFetchOk(new Blob(['mp4'], { type: 'video/mp4' }));
    const s = makeStore();
    await s.dispatch('theme/applyAssistantBackground', {
      url: '/api/local-file/C:/x/loop.mp4', type: 'video', fileName: 'loop.mp4',
    });

    expect(s.getters['theme/isCurrentBackgroundVideo']).toBe(true);
    expect(mediaStorage.setItem.mock.calls[0][1].type).toMatch(/^video\//);
  });

  // The regression this guards: an extension the server has no MIME entry for
  // arrives as application/octet-stream, blobTypeKind defaults that to 'image',
  // and the video comes back as a broken <img> on the next reload.
  it('re-tags a generic Content-Type using the kind the backend determined', async () => {
    mockFetchOk(new Blob(['mp4'], { type: 'application/octet-stream' }));
    const s = makeStore();
    await s.dispatch('theme/applyAssistantBackground', {
      url: '/api/local-file/C:/x/loop.m4v', type: 'video', fileName: 'loop.m4v',
    });

    expect(mediaStorage.setItem.mock.calls[0][1].type).toMatch(/^video\//);
    expect(s.getters['theme/isCurrentBackgroundVideo']).toBe(true);
  });

  it('leaves an already-correct Content-Type alone', async () => {
    const original = new Blob(['png'], { type: 'image/webp' });
    mockFetchOk(original);
    const s = makeStore();
    await s.dispatch('theme/applyAssistantBackground', { ...EVENT, url: '/api/local-file/C:/x/a.webp' });

    expect(mediaStorage.setItem.mock.calls[0][1].type).toBe('image/webp');
  });
});

// ── Clearing ──────────────────────────────────────────────────────────────────
describe('clearing', () => {
  it('removes the stored background and turns the setting back off', async () => {
    const s = makeStore();
    await s.dispatch('theme/applyAssistantBackground', EVENT);

    await s.dispatch('theme/clearAssistantBackground');

    const theme = s.state.theme.currentTheme;
    expect(mediaStorage.removeItem).toHaveBeenCalledWith(`customBackgroundImage_${theme}`);
    expect(s.state.theme.useCustomBackground).toBe(false);
    expect(s.state.theme.hasCustomBackground[theme]).toBe(false);
    expect(s.getters['theme/backgroundFileName']).toBeNull();
  });

  it('goes back to the plain theme background, not the default wallpaper', async () => {
    const s = makeStore();
    await s.dispatch('theme/applyAssistantBackground', EVENT);
    await s.dispatch('theme/clearAssistantBackground');

    expect(s.getters['theme/backgroundLayerActive']).toBe(false);
    expect(document.body.classList.contains('custom-bg')).toBe(false);
  });

  it('is a no-op when nothing is set', async () => {
    const s = makeStore();
    await expect(s.dispatch('theme/clearAssistantBackground')).resolves.toBeUndefined();
    expect(s.state.theme.useCustomBackground).toBe(false);
  });

  it('treats a null url from the backend as a clear', async () => {
    const s = makeStore();
    await s.dispatch('theme/applyAssistantBackground', EVENT);

    const result = await s.dispatch('theme/applyAssistantBackground', { url: null });

    expect(result).toEqual({ ok: true, cleared: true });
    expect(s.state.theme.useCustomBackground).toBe(false);
  });
});

// ── Failure is visible, never silent ──────────────────────────────────────────
describe('failure handling', () => {
  it('leaves the existing background untouched when the fetch fails', async () => {
    const s = makeStore();
    await s.dispatch('theme/applyAssistantBackground', EVENT);
    const before = s.getters['theme/currentThemeBackgroundImage'];

    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 403, statusText: 'Forbidden' });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await s.dispatch('theme/applyAssistantBackground', {
      url: '/api/local-file/C:/secret/x.png', type: 'image', fileName: 'x.png',
    });

    expect(result).toEqual({ ok: false, reason: 'fetch-failed' });
    expect(s.getters['theme/currentThemeBackgroundImage']).toBe(before);
    expect(errorSpy).toHaveBeenCalled(); // loud, not silent
    errorSpy.mockRestore();
  });

  it('survives a network rejection without throwing at the caller', async () => {
    const s = makeStore();
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('offline'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(s.dispatch('theme/applyAssistantBackground', EVENT))
      .resolves.toEqual({ ok: false, reason: 'fetch-failed' });

    expect(s.state.theme.useCustomBackground).toBe(false);
    errorSpy.mockRestore();
  });

  it('refuses a blob larger than the shared limit rather than filling IndexedDB', async () => {
    const s = makeStore();
    const huge = { size: MAX_IMAGE_BYTES + 1, type: 'image/png' };
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, blob: async () => huge });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await s.dispatch('theme/applyAssistantBackground', EVENT);

    expect(result).toEqual({ ok: false, reason: 'too-large' });
    expect(mediaStorage.setItem).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('applies the video ceiling to videos, not the image one', async () => {
    const s = makeStore();
    const big = new Blob([], { type: 'video/mp4' });
    Object.defineProperty(big, 'size', { value: MAX_IMAGE_BYTES + 1 });
    mockFetchOk(big);

    const result = await s.dispatch('theme/applyAssistantBackground', {
      url: '/api/local-file/C:/x/loop.mp4', type: 'video', fileName: 'loop.mp4',
    });

    expect(result).toEqual({ ok: true });
    expect(MAX_VIDEO_BYTES).toBeGreaterThan(MAX_IMAGE_BYTES);
  });
});

// ── Authentication ────────────────────────────────────────────────────────────
describe('media auth', () => {
  // /api/local-file authenticates via the narrowly-scoped agnt_media_token
  // cookie; without credentials every fetch here 401s and no background is
  // ever set.
  it('sends credentials so the media cookie is attached', async () => {
    const s = makeStore();
    await s.dispatch('theme/applyAssistantBackground', EVENT);

    expect(globalThis.fetch).toHaveBeenCalledWith(EVENT.url, { credentials: 'include' });
  });
});

// ── No second system ──────────────────────────────────────────────────────────
describe('the ephemeral overlay is gone', () => {
  it('exposes no ephemeral state, actions or getters', () => {
    const s = makeStore();
    expect(s.state.theme.ephemeralBackground).toBeUndefined();
    expect(themeModule.mutations.SET_EPHEMERAL_BACKGROUND).toBeUndefined();
    expect(themeModule.actions.setEphemeralBackground).toBeUndefined();
    expect(themeModule.actions.clearEphemeralBackground).toBeUndefined();
    expect(s.getters['theme/ephemeralBackground']).toBeUndefined();
  });

  it('drives the background layer off the user setting alone', async () => {
    const s = makeStore();
    expect(s.getters['theme/backgroundLayerActive']).toBe(false);
    await s.dispatch('theme/applyAssistantBackground', EVENT);
    expect(s.getters['theme/backgroundLayerActive']).toBe(true);
  });
});
