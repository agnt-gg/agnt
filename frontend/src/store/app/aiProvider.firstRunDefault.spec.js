/**
 * The first-run default: a subscription already on this machine, else AGNT Flash.
 *
 * Reported: a fresh install with a valid ChatGPT sign-in lit the ChatGPT tile
 * in onboarding but left the account on AGNT Flash. Flash had been saved
 * before the connection list arrived, and a saved default is never replaced
 * automatically, so the user had to find and click through the connect flow
 * for something AGNT had already found.
 */
import { describe, it, expect, vi } from 'vitest';
import aiProviderStore, {
  FIRST_RUN_SUBSCRIPTION_ORDER,
  SUBSCRIPTION_PROVIDER_IDS,
  detectedSubscriptions,
  providerStoreName,
} from './aiProvider.js';

const { applyIncludedModelDefault, useProvider, selectAgntFlash } = aiProviderStore.actions;

const PROVIDERS = [
  'AGNT', 'Anthropic', 'Antigravity', 'Claude-Code', 'Cursor', 'Gemini', 'Gemini-CLI',
  'Grok-Build', 'Kimi-Code', 'OpenAI', 'OpenAI-Codex',
];

/** One listable model per subscription seat, keyed the way the store keys them. */
const SEAT_MODELS = {
  'OpenAI-Codex': ['gpt-5.5', 'gpt-5-codex'],
  'Claude-Code': ['claude-opus-5'],
  'Gemini-CLI': ['gemini-3-pro'],
  Antigravity: ['antigravity-default'],
  'Grok-Build': ['grok-4.5'],
  Cursor: ['auto'],
  'Kimi-Code': ['kimi-k3'],
};

/**
 * A store context whose own actions run for real. Everything else dispatched
 * is recorded, and fetchConnectedApps delivers `connected` the way the real
 * action does: by committing it to appAuth state and marking it settled.
 */
function harness({
  selectedProvider = null,
  isAuthenticated = true,
  settled = false,
  connected = [],
  models = { AGNT: ['agnt-flash'], ...SEAT_MODELS },
  onFetchConnected = () => {},
} = {}) {
  const state = { selectedProvider, selectedModel: null, providers: [...PROVIDERS], allModels: {} };
  const rootState = { appAuth: { connectedAppsSettled: settled, connectedApps: settled ? [...connected] : [] } };
  const rootGetters = { 'userAuth/isPremium': false, 'userAuth/isAuthenticated': isAuthenticated };
  const context = { commit: vi.fn(), state, rootState, rootGetters };
  const own = { useProvider, selectAgntFlash, applyIncludedModelDefault };
  context.dispatch = vi.fn(async (action, payload) => {
    if (own[action]) return own[action](context, payload);
    if (action === 'appAuth/fetchConnectedApps') {
      rootState.appAuth.connectedApps = [...connected];
      rootState.appAuth.connectedAppsSettled = true;
      onFetchConnected(state);
      return { authoritative: true };
    }
    if (action === 'fetchProviderModels') {
      state.allModels[payload.provider] = models[payload.provider] || [];
      return state.allModels[payload.provider];
    }
    if (action === 'setProvider') state.selectedProvider = payload.provider;
    if (action === 'setModel') state.selectedModel = payload.model;
    return undefined;
  });
  return { state, rootState, context };
}

/** The saves, in order: what would reach the database. */
const saves = (h) =>
  h.context.dispatch.mock.calls.filter(([action]) => action === 'setProvider' || action === 'setModel');

const savedPair = (provider, model, source) => [
  ['setProvider', { provider, persist: false }],
  ['setModel', { model, source }],
];

describe('detectedSubscriptions', () => {
  it('covers every subscription seat exactly once', () => {
    expect([...FIRST_RUN_SUBSCRIPTION_ORDER].sort()).toEqual([...SUBSCRIPTION_PROVIDER_IDS].sort());
    expect(new Set(FIRST_RUN_SUBSCRIPTION_ORDER).size).toBe(FIRST_RUN_SUBSCRIPTION_ORDER.length);
  });

  it('puts ChatGPT first, whatever order the connections arrived in', () => {
    expect(detectedSubscriptions(['claude-code', 'agnt', 'OpenAI-Codex'])).toEqual(['openai-codex', 'claude-code']);
  });

  // The connectedApps getter always adds 'agnt' for a signed-in account, which
  // is why "is anything connected?" could never see that nothing was.
  it('never counts AGNT or a metered API key as a detected subscription', () => {
    expect(detectedSubscriptions(['agnt', 'openai', 'anthropic'])).toEqual([]);
    expect(detectedSubscriptions(undefined)).toEqual([]);
  });
});

describe('applyIncludedModelDefault', () => {
  it('uses a ChatGPT sign-in found on this machine, with its first model, in one save', async () => {
    const h = harness({ connected: ['openai-codex'] });
    await applyIncludedModelDefault(h.context);
    expect(saves(h)).toEqual(savedPair('OpenAI-Codex', 'gpt-5.5', 'detected-default'));
  });

  it('waits for the real connection list instead of reading an unloaded one', async () => {
    const h = harness({ settled: false, connected: ['openai-codex'] });
    await applyIncludedModelDefault(h.context);
    expect(h.context.dispatch).toHaveBeenCalledWith('appAuth/fetchConnectedApps', undefined, { root: true });
    expect(h.state.selectedProvider).toBe('OpenAI-Codex');
  });

  it('does not refetch a list that has already settled', async () => {
    const h = harness({ settled: true, connected: ['claude-code'] });
    await applyIncludedModelDefault(h.context);
    expect(h.context.dispatch).not.toHaveBeenCalledWith('appAuth/fetchConnectedApps', undefined, { root: true });
    expect(saves(h)).toEqual(savedPair('Claude-Code', 'claude-opus-5', 'detected-default'));
  });

  it('picks one when several are found, ChatGPT first', async () => {
    const h = harness({ connected: ['claude-code', 'cursor-cli', 'openai-codex'] });
    await applyIncludedModelDefault(h.context);
    expect(h.state.selectedProvider).toBe('OpenAI-Codex');
  });

  it('resolves a seat whose display name differs from its key (cursor-cli is Cursor)', async () => {
    const h = harness({ connected: ['cursor-cli'] });
    await applyIncludedModelDefault(h.context);
    expect(saves(h)).toEqual(savedPair('Cursor', 'auto', 'detected-default'));
  });

  // Asked directly: "if only Claude Code, or only Gemini, is found, it uses
  // that?" Yes, every seat, each on its own.
  it.each(FIRST_RUN_SUBSCRIPTION_ORDER)('uses %s when it is the only subscription found', async (key) => {
    const name = providerStoreName(key);
    const h = harness({ connected: ['agnt', key] });
    await applyIncludedModelDefault(h.context);
    expect(saves(h)).toEqual(savedPair(name, SEAT_MODELS[name][0], 'detected-default'));
  });

  it('falls back to AGNT Flash when nothing is found', async () => {
    const h = harness({ connected: ['agnt'] });
    await applyIncludedModelDefault(h.context);
    expect(saves(h)).toEqual(savedPair('AGNT', 'agnt-flash', 'included-default'));
  });

  it('falls back to AGNT Flash when only metered API keys are connected', async () => {
    const h = harness({ connected: ['openai', 'anthropic'] });
    await applyIncludedModelDefault(h.context);
    expect(h.state.selectedProvider).toBe('AGNT');
  });

  it('moves on to the next seat, then Flash, when a seat lists no models', async () => {
    const h = harness({ connected: ['openai-codex', 'claude-code'], models: { AGNT: ['agnt-flash'], 'OpenAI-Codex': [], 'Claude-Code': ['claude-opus-5'] } });
    await applyIncludedModelDefault(h.context);
    expect(saves(h)).toEqual(savedPair('Claude-Code', 'claude-opus-5', 'detected-default'));

    const none = harness({ connected: ['openai-codex'], models: { AGNT: ['agnt-flash'], 'OpenAI-Codex': [] } });
    await applyIncludedModelDefault(none.context);
    expect(none.state.selectedProvider).toBe('AGNT');
  });

  it('never replaces a default the account already has', async () => {
    const h = harness({ selectedProvider: 'Anthropic', connected: ['openai-codex'] });
    await applyIncludedModelDefault(h.context);
    expect(h.context.dispatch).not.toHaveBeenCalled();
  });

  it('lets a pick the user made while the list loaded win', async () => {
    const h = harness({
      connected: ['openai-codex'],
      onFetchConnected: (state) => {
        state.selectedProvider = 'Anthropic';
      },
    });
    await applyIncludedModelDefault(h.context);
    expect(saves(h)).toEqual([]);
    expect(h.state.selectedProvider).toBe('Anthropic');
  });

  it('chooses nothing for a signed-out install', async () => {
    const h = harness({ isAuthenticated: false, connected: ['openai-codex'] });
    await applyIncludedModelDefault(h.context);
    expect(h.context.dispatch).not.toHaveBeenCalled();
  });

  it('makes one decision when asked twice at once', async () => {
    const h = harness({ connected: ['openai-codex'] });
    await Promise.all([applyIncludedModelDefault(h.context), applyIncludedModelDefault(h.context)]);
    expect(saves(h)).toEqual(savedPair('OpenAI-Codex', 'gpt-5.5', 'detected-default'));
  });
});

describe('providerStoreName', () => {
  it('maps every subscription seat to the name the store keys it by', () => {
    expect(FIRST_RUN_SUBSCRIPTION_ORDER.map(providerStoreName)).toEqual([
      'OpenAI-Codex', 'Claude-Code', 'Gemini-CLI', 'Antigravity', 'Grok-Build', 'Cursor', 'Kimi-Code',
    ]);
  });

  it('accepts a store name or any casing, and leaves unknown ids alone', () => {
    expect(providerStoreName('OpenAI-Codex')).toBe('OpenAI-Codex');
    expect(providerStoreName('ANTHROPIC')).toBe('Anthropic');
    expect(providerStoreName('custom-7f3a')).toBe('custom-7f3a');
  });
});

describe('useProvider', () => {
  it('keeps the current model when it belongs to the provider being chosen', async () => {
    const h = harness();
    h.state.selectedProvider = 'OpenAI-Codex';
    h.state.selectedModel = 'gpt-5-codex';
    expect(await useProvider(h.context, { provider: 'OpenAI-Codex', source: 'onboarding' })).toBe(true);
    expect(saves(h)).toEqual(savedPair('OpenAI-Codex', 'gpt-5-codex', 'onboarding'));
  });

  // The old pick saved the provider beside the PREVIOUS provider's model.
  it('never saves a provider beside another provider\'s model', async () => {
    const h = harness();
    h.state.selectedProvider = 'AGNT';
    h.state.selectedModel = 'agnt-flash';
    await useProvider(h.context, { provider: 'OpenAI-Codex', source: 'onboarding' });
    expect(saves(h)).toEqual(savedPair('OpenAI-Codex', 'gpt-5.5', 'onboarding'));
  });

  it('saves nothing and reports false when the provider lists no models', async () => {
    const h = harness({ models: {} });
    expect(await useProvider(h.context, { provider: 'OpenAI-Codex' })).toBe(false);
    expect(saves(h)).toEqual([]);
  });
});
