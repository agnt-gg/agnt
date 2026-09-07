// A theme that carries BOTH faces has to answer two questions the other themes
// never raise: which face right now, and who decides.
//
// The desktop decides by default. But `prefers-color-scheme` answers "light"
// forever on a desktop that has no day/night switch at all, so following it can
// never be the only mechanism -- those users would be locked out of the dark
// face with no control that reaches it. An explicit face outranks the desktop,
// and re-picking the theme hands control back.
//
// If any of these go red, one of those two is broken.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createStore } from 'vuex';

vi.mock('../../utils/mediaStorage.js', () => ({
  mediaStorage: {
    setItem: vi.fn().mockResolvedValue(undefined),
    getItem: vi.fn().mockResolvedValue(null),
    removeItem: vi.fn().mockResolvedValue(undefined),
  },
}));

// theme.js reads localStorage at MODULE LOAD to build initial state, so both
// stubs have to exist before the dynamic import below.
const stored = new Map();
Object.defineProperty(globalThis, 'localStorage', {
  writable: true,
  value: {
    getItem: vi.fn((k) => (stored.has(k) ? stored.get(k) : null)),
    setItem: vi.fn((k, v) => stored.set(k, String(v))),
    removeItem: vi.fn((k) => stored.delete(k)),
    clear: vi.fn(() => stored.clear()),
  },
});

let desktopPrefersDark = false;
const schemeListeners = [];
Object.defineProperty(globalThis.window, 'matchMedia', {
  writable: true,
  value: vi.fn((query) => ({
    media: query,
    get matches() {
      return query.includes('dark') && desktopPrefersDark;
    },
    addEventListener: (_event, handler) => schemeListeners.push(handler),
    removeEventListener: vi.fn(),
  })),
});
/** Fire a desktop day/night flip at whoever is listening. */
const flipDesktopTo = (dark) => {
  desktopPrefersDark = dark;
  for (const handler of schemeListeners) handler({ matches: dark });
};

const { default: themeModule } = await import('./theme.js');
const BASE_STATE = structuredClone(themeModule.state);
const makeStore = () => createStore({
  modules: { theme: { ...themeModule, namespaced: true, state: structuredClone(BASE_STATE) } },
});

const faceOf = () => (document.body.classList.contains('dark') ? 'dark' : 'light');

beforeEach(() => {
  stored.clear();
  document.body.className = '';
  desktopPrefersDark = false;
});

describe('a theme with two faces', () => {
  it('takes its face from the desktop', () => {
    const store = makeStore();

    desktopPrefersDark = true;
    store.commit('theme/SET_THEME', 'everforest');
    expect(document.body.classList.contains('everforest')).toBe(true);
    expect(faceOf()).toBe('dark');
    expect(store.state.theme.isDarkMode).toBe(true);

    desktopPrefersDark = false;
    store.commit('theme/SET_THEME', 'everforest');
    expect(document.body.classList.contains('everforest')).toBe(true);
    expect(faceOf()).toBe('light');
    expect(store.state.theme.isDarkMode).toBe(false);
  });

  it('lets a desktop with no dark mode reach the dark face anyway', () => {
    const store = makeStore();
    store.commit('theme/SET_THEME', 'everforest');
    expect(faceOf()).toBe('light');

    // The one control such a user has. It must stick, not flip a class back.
    store.dispatch('theme/toggleDarkMode');
    expect(faceOf()).toBe('dark');
    expect(store.state.theme.themeFace).toBe('dark');
    expect(store.state.theme.isDarkMode).toBe(true);
    expect(stored.get('themeFace')).toBe('dark');
  });

  // The desktop watcher is registered once, by initTheme, and closes over that store's state --
  // so both halves of this contract have to be driven through the same store.
  it('follows a desktop flip on auto, and stops following once a face is pinned', async () => {
    const store = makeStore();
    store.commit('theme/SET_THEME', 'everforest');
    await store.dispatch('theme/initTheme');
    expect(schemeListeners.length).toBeGreaterThan(0); // anti-vacuity: something is listening

    flipDesktopTo(true);
    expect(faceOf()).toBe('dark');
    expect(store.state.theme.isDarkMode).toBe(true);

    flipDesktopTo(false);
    expect(faceOf()).toBe('light');

    store.commit('theme/SET_THEME_FACE', 'light');
    flipDesktopTo(true);
    expect(faceOf()).toBe('light');
    expect(store.state.theme.themeFace).toBe('light');

    store.commit('theme/SET_THEME_FACE', 'dark');
    flipDesktopTo(false);
    expect(faceOf()).toBe('dark');
  });

  it('hands control back to the desktop when the theme is picked again', () => {
    const store = makeStore();
    store.commit('theme/SET_THEME', 'everforest');
    store.commit('theme/SET_THEME_FACE', 'dark');
    expect(faceOf()).toBe('dark');

    desktopPrefersDark = false;
    store.commit('theme/SET_THEME', 'everforest');

    expect(store.state.theme.themeFace).toBe('auto');
    expect(faceOf()).toBe('light');
  });

  it('refuses a face it does not recognise rather than storing it', () => {
    const store = makeStore();
    store.commit('theme/SET_THEME', 'everforest');
    store.commit('theme/SET_THEME_FACE', 'chartreuse');
    expect(store.state.theme.themeFace).toBe('auto');
  });
});

describe('the single-face themes are untouched by any of it', () => {
  it('still resolve from the theme name alone', () => {
    const store = makeStore();
    desktopPrefersDark = false;

    store.commit('theme/SET_THEME', 'nord');
    expect(document.body.classList.contains('nord')).toBe(true);
    expect(faceOf()).toBe('dark');
    expect(store.state.theme.isDarkMode).toBe(true);

    store.commit('theme/SET_THEME', 'light');
    expect(document.body.className).toBe('');
    expect(store.state.theme.isDarkMode).toBe(false);

    store.commit('theme/SET_THEME', 'rose');
    expect(document.body.classList.contains('rose')).toBe(true);
    expect(faceOf()).toBe('light');
  });

  it('still toggle dark mode the legacy way', () => {
    const store = makeStore();
    store.commit('theme/SET_THEME', 'light');
    store.dispatch('theme/toggleDarkMode');
    expect(store.state.theme.isDarkMode).toBe(true);
    expect(store.state.theme.themeFace).toBe('auto');
  });
});
