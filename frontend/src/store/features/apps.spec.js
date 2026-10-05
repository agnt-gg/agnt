import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createStore } from 'vuex';
import apps from './apps.js';

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('App catalog loading', () => {
  it.each([['fetchInstalled', 'installed', 'error'], ['fetchAvailable', 'available', 'availableError']])('preserves stale-good %s data and surfaces API failure', async (action, field, errorField) => {
    const store = createStore({ modules: { apps } });
    store.state.apps[field] = [{ name: 'keep-me' }];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: false, error: 'Catalog unavailable', plugins: [] }) }));
    await store.dispatch(`apps/${action}`, { force: true });
    expect(store.state.apps[field]).toEqual([{ name: 'keep-me' }]);
    expect(store.state.apps[errorField]).toBe('Catalog unavailable');
  });
  it('clears a marketplace error after a successful retry', async () => {
    const store = createStore({ modules: { apps } }); store.state.apps.availableError = 'failed';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, plugins: [{ name: 'new' }] }) }));
    await store.dispatch('apps/fetchAvailable', { force: true });
    expect(store.state.apps.availableError).toBeNull();
    expect(store.state.apps.available).toEqual([{ name: 'new' }]);
  });
});

it('ignores a prior account response that arrives after the token changes', async () => {
  const store = createStore({ modules: { apps } });
  localStorage.setItem('token', 'alice');
  let finish;
  vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(resolve => { finish = resolve; })));
  const pending = store.dispatch('apps/fetchInstalled', { force: true });
  localStorage.setItem('token', 'bob');
  finish({ ok: true, json: async () => ({ success: true, plugins: [{ name: 'alice-private' }] }) });
  await pending;
  expect(store.state.apps.installed).toEqual([]);
  localStorage.removeItem('token');
});
