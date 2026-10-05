/**
 * Who starts on AGNT Flash.
 *
 * Paid plans include it, and a signed-in free account gets one-time trial
 * credits, so both start on it when they have not chosen a provider. Signed
 * out, nothing is chosen for them. A choice the user already made is never
 * overridden.
 */
import { describe, it, expect, vi } from 'vitest';
import aiProviderStore from './aiProvider.js';

const { applyIncludedModelDefault, selectAgntFlash } = aiProviderStore.actions;

function harness({ selectedProvider = null, isPremium = false, isAuthenticated = false, models = ['agnt-flash'] } = {}) {
  // Display names, exactly as the real store holds them. A lowercase fixture
  // here is what hid the default never applying in the app.
  const state = { selectedProvider, providers: ['AGNT', 'OpenAI'], allModels: { AGNT: models } };
  const rootGetters = { 'userAuth/isPremium': isPremium, 'userAuth/isAuthenticated': isAuthenticated };
  const context = { commit: vi.fn(), state, rootGetters };
  // selectAgntFlash runs for real; everything it dispatches is recorded.
  context.dispatch = vi.fn((action, payload) => (action === 'selectAgntFlash' ? selectAgntFlash(context, payload) : Promise.resolve(undefined)));
  return { state, dispatch: context.dispatch, context };
}

const chose = (dispatch) => dispatch.mock.calls.filter(([action]) => action === 'setProvider' || action === 'setModel');

describe('applyIncludedModelDefault', () => {
  // The provider is staged locally and the model save carries the complete
  // pair: one write, never a provider saved without its model.
  const AGNT_FLASH = [
    ['setProvider', { provider: 'AGNT', persist: false }],
    ['setModel', { model: 'agnt-flash', source: 'included-default' }],
  ];

  it('starts a signed-in free account on AGNT Flash for its trial', async () => {
    const h = harness({ isAuthenticated: true });
    await applyIncludedModelDefault(h.context);
    expect(chose(h.dispatch)).toEqual(AGNT_FLASH);
  });

  it('starts a paid account on AGNT Flash', async () => {
    const h = harness({ isPremium: true, isAuthenticated: true });
    await applyIncludedModelDefault(h.context);
    expect(chose(h.dispatch)).toEqual(AGNT_FLASH);
  });

  it('chooses nothing when AGNT has no model to offer', async () => {
    const h = harness({ isAuthenticated: true, models: [] });
    await applyIncludedModelDefault(h.context);
    expect(chose(h.dispatch)).toEqual([]);
  });

  it('chooses nothing for a signed-out install', async () => {
    const h = harness();
    await applyIncludedModelDefault(h.context);
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it('never overrides a provider the user already chose', async () => {
    const h = harness({ selectedProvider: 'OpenAI', isAuthenticated: true });
    await applyIncludedModelDefault(h.context);
    expect(h.dispatch).not.toHaveBeenCalled();
  });
});

// The chat uses this when the chosen provider is known not to work, so a
// signed-in account gets Flash instead of the connect card.
describe('selectAgntFlash', () => {
  it('moves the chat onto AGNT Flash and says it did', async () => {
    const h = harness({ selectedProvider: 'OpenAI', isAuthenticated: true });
    expect(await selectAgntFlash(h.context, { source: 'flash-fallback' })).toBe(true);
    expect(chose(h.dispatch)).toEqual([
      ['setProvider', { provider: 'AGNT', persist: false }],
      ['setModel', { model: 'agnt-flash', source: 'flash-fallback' }],
    ]);
  });

  it('reports false, changing nothing, when Flash has no model', async () => {
    const h = harness({ selectedProvider: 'OpenAI', isAuthenticated: true, models: [] });
    expect(await selectAgntFlash(h.context)).toBe(false);
    expect(chose(h.dispatch)).toEqual([]);
  });
});
