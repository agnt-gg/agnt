// There was one theme, and there were two systems deciding what it looked like.
//
//   A. `currentTheme` -> SET_THEME -> applyThemeClasses -> body classes.
//      Persisted as `currentTheme`, and re-derived from it on every load.
//
//   B. `isDarkMode` / `isCyberpunkMode` -> SET_DARK_MODE / SET_CYBERPUNK_MODE,
//      which toggled body classes THEMSELVES and wrote `darkMode` /
//      `cyberpunkMode` to localStorage. Nothing ever read those two keys back,
//      and B never touched `currentTheme`.
//
// So the two Settings toggles wrote into a system that the next re-apply or
// reload overwrote from the other one. Two concrete consequences, both covered
// below:
//
//   - Every dark variant is `body.dark.<name>` in CSS. The cyberpunk toggle
//     added `.cyberpunk` alone, so from a light theme it matched no rule at
//     all and the click did nothing visible.
//   - Whatever either toggle did was reverted on reload, because
//     `currentTheme` still said something else.
//
// Both toggles now choose a theme. If these go red, system B has grown back.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createStore } from 'vuex';

vi.mock('../../utils/mediaStorage.js', () => ({
  mediaStorage: {
    setItem: vi.fn().mockResolvedValue(undefined),
    getItem: vi.fn().mockResolvedValue(null),
    removeItem: vi.fn().mockResolvedValue(undefined),
  },
}));

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
Object.defineProperty(globalThis.window, 'matchMedia', {
  writable: true,
  value: vi.fn((query) => ({
    media: query, matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  })),
});

const { default: themeModule } = await import('./theme.js');
const BASE_STATE = structuredClone(themeModule.state);
const makeStore = () => createStore({
  modules: { theme: { ...themeModule, namespaced: true, state: structuredClone(BASE_STATE) } },
});

/** What a reload would paint: build a fresh store and re-apply the persisted theme. */
const afterReload = () => {
  const store = makeStore();
  store.commit('theme/SET_THEME', localStorage.getItem('currentTheme'));
  return [...document.body.classList].sort().join(' ');
};
const classes = () => [...document.body.classList].sort().join(' ');

beforeEach(() => {
  stored.clear();
  document.body.className = '';
});

describe('the Settings toggles drive the theme, not a class of their own', () => {
  it('cyberpunk is reachable from a light theme, which needs BOTH classes', () => {
    const store = makeStore();
    store.commit('theme/SET_THEME', 'light');
    expect(classes()).toBe('');

    store.dispatch('theme/toggleCyberpunkMode');

    // _cyberpunk.css is `body.dark.cyberpunk`. `.cyberpunk` alone paints nothing.
    expect(document.body.classList.contains('cyberpunk')).toBe(true);
    expect(document.body.classList.contains('dark')).toBe(true);
    expect(store.state.theme.currentTheme).toBe('cyberpunk');
    expect(store.state.theme.isCyberpunkMode).toBe(true);
  });

  it('and survives the reload that used to revert it', () => {
    const store = makeStore();
    store.commit('theme/SET_THEME', 'light');
    store.dispatch('theme/toggleCyberpunkMode');
    const painted = classes();

    expect(localStorage.getItem('currentTheme')).toBe('cyberpunk');
    expect(afterReload()).toBe(painted);
  });

  it('the dark toggle moves the theme, so the name never contradicts the class', () => {
    const store = makeStore();
    store.commit('theme/SET_THEME', 'nord');
    expect(classes()).toBe('dark nord');

    store.dispatch('theme/toggleDarkMode');
    expect(store.state.theme.currentTheme).toBe('light');
    expect(classes()).toBe('');
    expect(afterReload()).toBe('');

    store.dispatch('theme/toggleDarkMode');
    expect(store.state.theme.currentTheme).toBe('dark');
    expect(classes()).toBe('dark');
    expect(afterReload()).toBe('dark');
  });

  it('writes no key that nothing reads back', () => {
    const store = makeStore();
    store.commit('theme/SET_THEME', 'light');
    store.dispatch('theme/toggleDarkMode');
    store.dispatch('theme/toggleCyberpunkMode');

    expect(localStorage.getItem('darkMode')).toBeNull();
    expect(localStorage.getItem('cyberpunkMode')).toBeNull();
    expect(localStorage.getItem('currentTheme')).toBe('cyberpunk');
  });

  it('leaves the two-faced theme switching face, not theme', () => {
    const store = makeStore();
    store.commit('theme/SET_THEME', 'everforest');
    store.dispatch('theme/toggleDarkMode');

    expect(store.state.theme.currentTheme).toBe('everforest');
    expect(store.state.theme.themeFace).toBe('dark');
    expect(document.body.classList.contains('dark')).toBe(true);
  });

  it('has no second system left to call', () => {
    expect(themeModule.mutations.SET_CYBERPUNK_MODE).toBeUndefined();
    expect(themeModule.actions.initDarkMode).toBeUndefined();
    expect(themeModule.actions.initCyberpunkMode).toBeUndefined();
  });
});
