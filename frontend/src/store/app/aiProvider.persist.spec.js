/**
 * The transient-selection contract, and the case-drift rescue.
 *
 * THE BUG THESE PREVENT (provider drift)
 * --------------------------------------
 * Every chat surface mirrors its own pinned provider into Vuex on mount via
 * setProvider/setModel — which ALSO PUT /users/settings. Landing on a surface
 * once pinned to Anthropic therefore rewrote the ACCOUNT default to
 * Anthropic. `persist: false` is the escape hatch: local state moves, the
 * database does not.
 *
 * Separately: a lowercase provider key in the DB ('claude-code') failed the
 * exact-case existence check in fetchCustomProviders and NULLED the
 * selection, handing it to the Anthropic-first connected-provider ladder.
 * canonicalizeProviderCase rescues the case variant instead of clearing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createStore } from 'vuex';
import aiProviderStore, { canonicalizeProviderCase } from './aiProvider.js';
import { invalidateAllFreshness } from '../_utils/withFreshness.js';

const { setModel } = aiProviderStore.actions;

const settingsWrites = (fetchMock) =>
  fetchMock.mock.calls
    .filter(([url, opts = {}]) => url.endsWith('/users/settings') && opts.method === 'PUT')
    .map(([, opts]) => JSON.parse(opts.body));

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

/**
 * A real store, so setProvider's commit -> fetch -> save sequence runs for
 * real. A mocked commit cannot show the bug this guards: the save happening
 * before the provider's models exist.
 */
function makeStore({ selectedProvider = 'Claude-Code', selectedModel = 'claude-opus-5', allModels = {}, modelsFor = () => [] } = {}) {
  const fetchMock = vi.fn(async (url, options = {}) => {
    if (url.endsWith('/users/settings')) return { ok: true, json: async () => ({}), text: async () => '' };
    const match = /\/models\/([^/]+)\/models$/.exec(url);
    if (match) {
      const models = await modelsFor(match[1]);
      return { ok: true, json: async () => ({ models }) };
    }
    if (url.endsWith('/metadata')) return { ok: true, json: async () => ({ success: true, metadata: {} }) };
    throw new Error(`Unexpected request: ${options.method || 'GET'} ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  const store = createStore({
    modules: {
      aiProvider: {
        ...aiProviderStore,
        state: () => ({
          ...aiProviderStore.state,
          providers: [...aiProviderStore.state.providers],
          customProviders: [],
          allModels: { ...allModels },
          loadingModels: {},
          modelMetadata: {},
          selectedProvider,
          selectedModel,
        }),
      },
    },
  });
  return { store, fetchMock };
}

describe('setProvider never saves a provider without a model', () => {
  beforeEach(() => {
    invalidateAllFreshness();
    localStorage.clear();
    localStorage.setItem('token', 'test-token');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('THE REPORTED BUG: switching to a provider whose models are not loaded saves the complete pair', async () => {
    const { store, fetchMock } = makeStore({ modelsFor: () => ['claude-opus-5', 'claude-sonnet-5'] });
    await store.dispatch('aiProvider/setProvider', 'Anthropic');
    expect(settingsWrites(fetchMock)).toEqual([
      { selectedProvider: 'Anthropic', selectedModel: 'claude-opus-5', changeSource: 'set-provider' },
    ]);
  });

  it('a provider with no models at all is applied locally but never saved', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { store, fetchMock } = makeStore({ modelsFor: () => [] });
    await store.dispatch('aiProvider/setProvider', 'Anthropic');
    expect(store.state.aiProvider.selectedProvider).toBe('Anthropic');
    expect(settingsWrites(fetchMock)).toEqual([]);
    warn.mockRestore();
  });

  it('a selection made while the models load owns the save; the earlier one is dropped', async () => {
    const slow = deferred();
    const { store, fetchMock } = makeStore({
      modelsFor: (key) => (key === 'anthropic' ? slow.promise : ['gpt-6']),
    });
    const first = store.dispatch('aiProvider/setProvider', 'Anthropic');
    await store.dispatch('aiProvider/setProvider', 'OpenAI');
    slow.resolve(['claude-opus-5']);
    await first;
    expect(settingsWrites(fetchMock)).toEqual([
      { selectedProvider: 'OpenAI', selectedModel: 'gpt-6', changeSource: 'set-provider' },
    ]);
  });

  it('loaded models are not refetched and the caller-named source is recorded', async () => {
    const { store, fetchMock } = makeStore({ allModels: { OpenAI: ['gpt-6'] } });
    await store.dispatch('aiProvider/setProvider', { provider: 'OpenAI', source: 'chat-picker' });
    expect(fetchMock.mock.calls.some(([url]) => /\/models\//.test(url))).toBe(false);
    expect(settingsWrites(fetchMock)).toEqual([
      { selectedProvider: 'OpenAI', selectedModel: 'gpt-6', changeSource: 'chat-picker' },
    ]);
  });

  it('{ persist: false } changes local state and never touches the network', async () => {
    const { store, fetchMock } = makeStore();
    await store.dispatch('aiProvider/setProvider', { provider: 'Anthropic', persist: false });
    expect(store.state.aiProvider.selectedProvider).toBe('Anthropic');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('setModel transient mode', () => {
  let fetchMock;
  let commit;
  const state = { selectedProvider: 'Claude-Code', selectedModel: 'claude-opus-5' };

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    // A token must be present or the persist path is skipped and the
    // "does not PUT" assertions pass vacuously.
    vi.stubGlobal('localStorage', { getItem: () => 'test-token' });
    commit = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('an empty model is never saved', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const empty of [null, '', '  ']) {
      await setModel({ commit, state }, empty);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('setModel honors the same contract', async () => {
    await setModel({ commit, state }, { model: 'gpt-5', persist: false });
    expect(commit).toHaveBeenCalledWith('SET_SELECTED_MODEL', 'gpt-5');
    expect(fetchMock).not.toHaveBeenCalled();

    await setModel({ commit, state }, 'gpt-5');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain('/users/settings');
    expect(opts.method).toBe('PUT');
  });
});

describe('a model write never carries a null provider', () => {
  /**
   * The server treats `selectedProvider: null` as an EXPLICIT write and nulls
   * default_provider AND default_model. A nulled provider then reads back as
   * 'Anthropic'. So sending the provider we do not have turns "save my model"
   * into "erase my account default" — the reported "my default keeps becoming
   * Anthropic / stopped saving".
   *
   * The server refuses the erasure too (see providerDefaultErasure.test.js);
   * this is the client half, so the bad payload never leaves in the first
   * place.
   */
  let fetchMock;
  let commit;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('localStorage', { getItem: () => 'test-token' });
    commit = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const bodyOf = (mock) => JSON.parse(mock.mock.calls[0][1].body);

  it('omits selectedProvider entirely when state has none', async () => {
    const state = { selectedProvider: null, selectedModel: null };
    await setModel({ commit, state }, 'claude-opus-5');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = bodyOf(fetchMock);
    expect('selectedProvider' in body).toBe(false);
    expect(body.selectedModel).toBe('claude-opus-5');
  });

  it('still sends the pair when a provider IS selected', async () => {
    const state = { selectedProvider: 'Claude-Code', selectedModel: 'claude-opus-5' };
    await setModel({ commit, state }, 'claude-opus-6');

    const body = bodyOf(fetchMock);
    expect(body.selectedProvider).toBe('Claude-Code');
    expect(body.selectedModel).toBe('claude-opus-6');
  });
});

describe('canonicalizeProviderCase', () => {
  const providers = ['Anthropic', 'Claude-Code', 'OpenAI-Codex', 'Local'];

  it('rescues a lowercase DB value to its canonical identifier', () => {
    expect(canonicalizeProviderCase(providers, 'claude-code')).toBe('Claude-Code');
    expect(canonicalizeProviderCase(providers, 'anthropic')).toBe('Anthropic');
  });

  it('returns the canonical name unchanged when case already matches', () => {
    expect(canonicalizeProviderCase(providers, 'Claude-Code')).toBe('Claude-Code');
  });

  it('returns null for a provider that genuinely does not exist', () => {
    expect(canonicalizeProviderCase(providers, 'netscape-ai')).toBeNull();
    expect(canonicalizeProviderCase(providers, '')).toBeNull();
    expect(canonicalizeProviderCase(providers, null)).toBeNull();
    expect(canonicalizeProviderCase(providers, undefined)).toBeNull();
  });
});
