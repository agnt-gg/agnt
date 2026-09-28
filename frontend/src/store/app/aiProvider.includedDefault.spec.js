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

const { applyIncludedModelDefault } = aiProviderStore.actions;

function harness({ selectedProvider = null, isPremium = false, isAuthenticated = false, models = ['agnt-flash'] } = {}) {
  const state = { selectedProvider, providers: ['agnt', 'openai'], allModels: { agnt: models } };
  const dispatch = vi.fn().mockResolvedValue(undefined);
  const rootGetters = { 'userAuth/isPremium': isPremium, 'userAuth/isAuthenticated': isAuthenticated };
  return { state, dispatch, context: { commit: vi.fn(), dispatch, state, rootGetters } };
}

const chose = (dispatch) => dispatch.mock.calls.filter(([action]) => action === 'setProvider' || action === 'setModel');

describe('applyIncludedModelDefault', () => {
  it('starts a signed-in free account on AGNT Flash for its trial', async () => {
    const h = harness({ isAuthenticated: true });
    await applyIncludedModelDefault(h.context);
    expect(chose(h.dispatch)).toEqual([['setProvider', 'agnt'], ['setModel', 'agnt-flash']]);
  });

  it('starts a paid account on AGNT Flash', async () => {
    const h = harness({ isPremium: true, isAuthenticated: true });
    await applyIncludedModelDefault(h.context);
    expect(chose(h.dispatch)).toEqual([['setProvider', 'agnt'], ['setModel', 'agnt-flash']]);
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
