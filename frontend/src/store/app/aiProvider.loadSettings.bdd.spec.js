/** Regression: case-drift in saved settings must not clear the toolbar model. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'vuex';
import aiProvider from './aiProvider.js';
import { invalidateAllFreshness } from '../_utils/withFreshness.js';

const models = ['recommended-test-model', 'saved-test-model'];
function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}
let fetchMock;

function makeStore(settings, overrides = {}) {
  fetchMock = vi.fn(async (url, options = {}) => {
    if ((options.method || 'GET') !== 'GET') throw new Error(`Unexpected settings write: ${url}`);
    if (url.endsWith('/users/settings')) return { ok: true, json: async () => settings };
    if (/\/models\/[^/]+\/models$/.test(url)) return { ok: true, json: async () => ({ models }) };
    if (url.endsWith('/metadata')) return { ok: true, json: async () => ({ success: true, metadata: {} }) };
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return createStore({
    modules: {
      aiProvider: {
        ...aiProvider,
        state: () => ({
          ...aiProvider.state,
          providers: [...aiProvider.state.providers],
          customProviders: [],
          allModels: {},
          loadingModels: {},
          modelMetadata: {},
          selectedProvider: null,
          selectedModel: null,
          ...overrides,
        }),
      },
    },
  });
}

beforeEach(() => {
  invalidateAllFreshness();
  localStorage.clear();
  localStorage.setItem('token', 'synthetic-test-token');
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('Given an account default whose provider differs only in case', () => {
  it.each([
    ['openai-codex', 'OpenAI-Codex', 'openai-codex'],
    ['OPENAI-CODEX', 'OpenAI-Codex', 'openai-codex'],
    ['OpenAI-Codex', 'OpenAI-Codex', 'openai-codex'],
    ['gemini-cli', 'Gemini-CLI', 'gemini-cli'],
    ['claude-code', 'Claude-Code', 'claude-code'],
    ['anthropic', 'Anthropic', 'anthropic'],
    ['openai', 'OpenAI', 'openai'],
    ['z.ai', 'Z.AI', 'zai'],
  ])('when loading %s, then fetch via %s and retain the saved model', async (savedProvider, canonical, key) => {
    const store = makeStore({ selectedProvider: savedProvider, selectedModel: models[1] });
    await store.dispatch('aiProvider/loadUserSettings');

    expect(store.state.aiProvider.selectedProvider).toBe(canonical);
    expect(store.state.aiProvider.selectedModel).toBe(models[1]);
    expect(store.state.aiProvider.allModels[canonical]).toEqual(models);
    expect(localStorage.getItem('selectedProvider')).toBe(canonical);
    expect(localStorage.getItem('selectedModel')).toBe(models[1]);
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith(`/models/${key}/models`))).toBe(true);
    expect(fetchMock.mock.calls.every(([, opts = {}]) => (opts.method || 'GET') === 'GET')).toBe(true);
  });

  it('when another boot task has already canonicalized the selection, then settings loading does not undo it', async () => {
    const store = makeStore({ selectedProvider: 'openai-codex', selectedModel: models[1] }, {
      selectedProvider: 'OpenAI-Codex', selectedModel: models[1],
      allModels: { 'OpenAI-Codex': [...models] },
    });
    localStorage.setItem('OpenAI-Codex_models', JSON.stringify({ models, timestamp: Date.now() }));
    await store.dispatch('aiProvider/loadUserSettings');
    expect(store.state.aiProvider.selectedProvider).toBe('OpenAI-Codex');
    expect(store.state.aiProvider.selectedModel).toBe(models[1]);
    expect(store.state.aiProvider.allModels['openai-codex']).toBeUndefined();
  });
});

describe('Given settings outside the built-in provider case-drift path', () => {
  it('preserves an exact custom-provider identifier and its dedicated fetch path', async () => {
    const id = 'CUSTOM-A1b2';
    const store = makeStore({ selectedProvider: id, selectedModel: models[1] }, {
      customProviders: [{ id, provider_name: 'Private model host' }],
    });
    fetchMock.mockImplementation(async (url) => {
      if (url.endsWith('/users/settings')) return { ok: true, json: async () => ({ selectedProvider: id, selectedModel: models[1] }) };
      if (url.endsWith(`/custom-providers/${id}/models`)) return { ok: true, json: async () => ({ models }) };
      throw new Error(`Unexpected request: ${url}`);
    });
    await store.dispatch('aiProvider/loadUserSettings');
    expect(store.state.aiProvider.selectedProvider).toBe(id);
    expect(store.state.aiProvider.selectedModel).toBe(models[1]);
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith(`/custom-providers/${id}/models`))).toBe(true);
  });

  it('leaves a missing saved provider alone instead of choosing a different provider', async () => {
    const store = makeStore({ selectedProvider: null, selectedModel: null });
    await store.dispatch('aiProvider/loadUserSettings');
    expect(store.state.aiProvider.selectedProvider).toBeNull();
    expect(store.state.aiProvider.selectedModel).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not reinterpret an unknown provider as a built-in or silently fetch another provider', async () => {
    const store = makeStore({ selectedProvider: 'unknown-provider', selectedModel: models[1] });
    await store.dispatch('aiProvider/loadUserSettings');
    expect(store.state.aiProvider.selectedProvider).toBe('unknown-provider');
    expect(store.state.aiProvider.selectedModel).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});


describe('Given concurrent settings and provider-list initialization', () => {
  it.each(['settings-first', 'providers-first'])('retains the saved model with %s completion', async (order) => {
    const settings = { selectedProvider: 'openai-codex', selectedModel: models[1] };
    const store = makeStore(settings, { selectedProvider: 'openai-codex' });
    const settingsResponse = deferred();
    const providersResponse = deferred();
    fetchMock.mockImplementation(async (url) => {
      if (url.endsWith('/users/settings')) return settingsResponse.promise;
      if (url.endsWith('/custom-providers')) return providersResponse.promise;
      if (url.endsWith('/models/openai-codex/models')) return { ok: true, json: async () => ({ models }) };
      if (url.endsWith('/metadata')) return { ok: true, json: async () => ({ success: true, metadata: {} }) };
      throw new Error('Unexpected request: ' + url);
    });
    const loadingSettings = store.dispatch('aiProvider/loadUserSettings');
    const loadingProviders = store.dispatch('aiProvider/fetchCustomProviders', { forceRefresh: true });
    if (order === 'settings-first') {
      settingsResponse.resolve({ ok: true, json: async () => settings });
      await loadingSettings;
      providersResponse.resolve({ ok: true, json: async () => ({ providers: [] }) });
    } else {
      providersResponse.resolve({ ok: true, json: async () => ({ providers: [] }) });
      await loadingProviders;
      settingsResponse.resolve({ ok: true, json: async () => settings });
    }
    await Promise.all([loadingSettings, loadingProviders]);
    expect(store.state.aiProvider.selectedProvider).toBe('OpenAI-Codex');
    expect(store.state.aiProvider.selectedModel).toBe(models[1]);
    expect(localStorage.getItem('selectedModel')).toBe(models[1]);
    expect(fetchMock.mock.calls.every(([, options = {}]) => (options.method || 'GET') === 'GET')).toBe(true);
  });
});

it('uses the dedicated Local fetcher for a lowercase saved Local provider', async () => {
  const store = makeStore({ selectedProvider: 'local', selectedModel: models[1] });
  localStorage.setItem('Local_models', JSON.stringify({ models, timestamp: Date.now() }));
  await store.dispatch('aiProvider/loadUserSettings');
  expect(store.state.aiProvider.selectedProvider).toBe('Local');
  expect(store.state.aiProvider.selectedModel).toBe(models[1]);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('preserves current preferences when the settings service is unavailable', async () => {
  const store = makeStore({}, { selectedProvider: 'OpenAI-Codex', selectedModel: models[1] });
  fetchMock.mockResolvedValue({ ok: false, status: 503 });
  await store.dispatch('aiProvider/loadUserSettings');
  expect(store.state.aiProvider.selectedProvider).toBe('OpenAI-Codex');
  expect(store.state.aiProvider.selectedModel).toBe(models[1]);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
