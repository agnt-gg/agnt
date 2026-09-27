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
