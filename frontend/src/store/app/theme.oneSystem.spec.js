// The picker owns styling; retained dark-mode state is a derived mirror only.
import fs from 'node:fs';
import path from 'node:path';
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

describe('one theme application path', () => {
  it('has no obsolete component, actions or Cyberpunk mirror', () => {
    expect(fs.existsSync(path.resolve(process.cwd(), 'src/views/Terminal/CenterPanel/screens/Settings/components/DarkMode/DarkModeToggle.vue'))).toBe(false);
    for (const name of ['toggleDarkMode', 'toggleCyberpunkMode', 'initDarkMode', 'initCyberpunkMode']) expect(themeModule.actions[name]).toBeUndefined();
    expect(themeModule.mutations.SET_CYBERPUNK_MODE).toBeUndefined();
    expect(themeModule.state).not.toHaveProperty('isCyberpunkMode');
    expect(themeModule.getters).not.toHaveProperty('isCyberpunkMode');
  });
  it('the dark-mode mirror does not repaint or write independent preferences', () => {
    const store = makeStore();
    store.commit('theme/SET_THEME', 'light');
    store.commit('theme/SET_DARK_MODE', true);
    expect(classes()).toBe('');
    expect(store.state.theme.currentTheme).toBe('light');
    expect(stored.has('darkMode')).toBe(false);
    expect(stored.has('cyberpunkMode')).toBe(false);
  });
  it.each(['dark', 'light', 'cyberpunk', 'nord', 'rose', 'everforest'])('picker action persists %s and loads its background', async (name) => {
    const load = vi.spyOn(themeModule.actions, 'loadCurrentThemeBackground');
    const apply = vi.spyOn(themeModule.actions, 'applyCurrentThemeBackground');
    // Register spies before constructing the store used by this assertion.
    const observed = makeStore();
    try {
      await observed.dispatch('theme/setTheme', name);
      expect(observed.state.theme.currentTheme).toBe(name);
      expect(stored.get('currentTheme')).toBe(name);
      expect(load).toHaveBeenCalledTimes(1);
      expect(apply).toHaveBeenCalledTimes(1);
      const painted = classes();
      expect(afterReload()).toBe(painted);
      expect(stored.has('darkMode')).toBe(false);
      expect(stored.has('cyberpunkMode')).toBe(false);
    } finally { load.mockRestore(); apply.mockRestore(); }
  });
});
