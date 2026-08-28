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
import aiProviderStore, { canonicalizeProviderCase } from './aiProvider.js';

const { setProvider, setModel } = aiProviderStore.actions;

describe('setProvider / setModel transient mode', () => {
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

  it('a string payload commits AND persists (legacy contract unchanged)', async () => {
    await setProvider({ commit, state }, 'OpenAI');
    expect(commit).toHaveBeenCalledWith('SET_SELECTED_PROVIDER', 'OpenAI');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain('/users/settings');
    expect(opts.method).toBe('PUT');
  });

  it('{ persist: false } commits but NEVER touches the network', async () => {
    await setProvider({ commit, state }, { provider: 'Anthropic', persist: false });
    expect(commit).toHaveBeenCalledWith('SET_SELECTED_PROVIDER', 'Anthropic');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('an object payload WITHOUT persist:false still persists (default is true)', async () => {
    await setProvider({ commit, state }, { provider: 'OpenAI' });
    expect(commit).toHaveBeenCalledWith('SET_SELECTED_PROVIDER', 'OpenAI');
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
