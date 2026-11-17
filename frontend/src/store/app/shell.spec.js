import { describe, it, expect } from 'vitest';
import { createStore } from 'vuex';
import shell from './shell.js';

const makeStore = () => createStore({ modules: { shell } });

describe('shell screenPanels', () => {
  it('starts with no screen claiming any panel', () => {
    expect(makeStore().getters['shell/screenPanels']).toEqual({ screenId: null, left: false, right: false });
  });

  it('records exactly which panels the active screen offers', () => {
    const store = makeStore();
    store.commit('shell/SET_SCREEN_PANELS', { screenId: 'ToolsScreen', left: true, right: false });
    expect(store.getters['shell/screenPanels']).toEqual({ screenId: 'ToolsScreen', left: true, right: false });
  });

  it('coerces truthy inputs and replaces, never merges, the previous screen', () => {
    const store = makeStore();
    store.commit('shell/SET_SCREEN_PANELS', { screenId: 'ChatScreen', left: 1, right: 'yes' });
    store.commit('shell/SET_SCREEN_PANELS', { screenId: 'GoalsScreen' });
    expect(store.getters['shell/screenPanels']).toEqual({ screenId: 'GoalsScreen', left: false, right: false });
  });
});

// One's sidebar search hands its words to Find anything on Enter.
describe('shell jump seed', () => {
  it('opens the palette with the words it was handed', async () => {
    const store = makeStore();
    await store.dispatch('shell/openJump', 'northwind renewal');
    expect(store.getters['shell/jumpOpen']).toBe(true);
    expect(store.getters['shell/jumpSeed']).toBe('northwind renewal');
  });

  it('every other way in starts empty: a plain open, Ctrl K, or a seed that is not text', async () => {
    const store = makeStore();
    await store.dispatch('shell/openJump', 'northwind');
    await store.dispatch('shell/closeJump');
    await store.dispatch('shell/openJump');
    expect(store.getters['shell/jumpSeed']).toBe('');

    await store.dispatch('shell/closeJump');
    store.commit('shell/SET_JUMP_SEED', 'left over');
    await store.dispatch('shell/toggleJump');
    expect(store.getters['shell/jumpOpen']).toBe(true);
    expect(store.getters['shell/jumpSeed']).toBe('');

    await store.dispatch('shell/openJump', { query: 'northwind' });
    expect(store.getters['shell/jumpSeed']).toBe('');
  });
});
