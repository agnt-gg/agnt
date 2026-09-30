import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import aiProvider, { listingFromResponse, describeStaleListing } from './aiProvider.js';

/**
 * Model-list provenance: the backend now says whether a list is a live vendor
 * answer or a saved/built-in stand-in. Verified live 2026-09-30, xAI answered
 * 403 "used all available credits" while AGNT showed a week-old Grok list as
 * if it were current. The store must carry that signal, not drop it.
 */

const STALE_GROK = {
  success: true,
  models: ['grok-4.3', 'grok-4.20-0309-reasoning'],
  source: 'persisted',
  stale: true,
  fetchedAt: '2026-09-23T04:00:00.000Z',
  upstreamError: 'Grok AI API error: 403 Forbidden - used all available credits',
};

describe('listingFromResponse', () => {
  it('keeps exactly the provenance fields', () => {
    expect(listingFromResponse(STALE_GROK)).toEqual({
      source: 'persisted', stale: true, fetchedAt: '2026-09-23T04:00:00.000Z', upstreamError: STALE_GROK.upstreamError,
    });
  });

  it('returns null for a response without provenance, rather than guessing', () => {
    expect(listingFromResponse({ success: true, models: ['a'] })).toBeNull();
    expect(listingFromResponse({ source: 'made-up' })).toBeNull();
    expect(listingFromResponse(null)).toBeNull();
  });

  it('only a literal true is stale', () => {
    expect(listingFromResponse({ source: 'live', stale: 'yes' }).stale).toBe(false);
  });
});

describe('describeStaleListing', () => {
  it('says what is shown instead and why', () => {
    const text = describeStaleListing('GrokAI', listingFromResponse(STALE_GROK));
    expect(text).toMatch(/^GrokAI did not return its model list, so this shows the list it last returned \(/);
    expect(text).toContain('used all available credits');
  });

  it('names built-in defaults for a fallback list', () => {
    expect(describeStaleListing('DeepSeek', { source: 'fallback', stale: true, fetchedAt: null, upstreamError: null }))
      .toBe('DeepSeek did not return its model list, so this shows built-in defaults, which may be out of date.');
  });

  it('is empty for a live list', () => {
    expect(describeStaleListing('OpenAI', { source: 'live', stale: false })).toBe('');
    expect(describeStaleListing('OpenAI', null)).toBe('');
  });
});

describe('fetchProviderModels records provenance', () => {
  const commits = [];
  const commit = (type, payload) => commits.push([type, payload]);
  let state;

  beforeEach(() => {
    commits.length = 0;
    localStorage.clear();
    localStorage.setItem('token', 't');
    state = { customProviders: [], loadingModels: {}, allModels: {} };
    vi.stubGlobal('fetch', vi.fn(async (url) => ({
      ok: true,
      json: async () => (String(url).includes('/metadata') ? { success: false } : STALE_GROK),
    })));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('commits the listing the backend reported alongside the models', async () => {
    const models = await aiProvider.actions.fetchProviderModels({ commit, state, dispatch: vi.fn() }, { provider: 'GrokAI', forceRefresh: true });

    expect(models).toEqual(STALE_GROK.models);
    expect(commits).toContainEqual(['SET_MODEL_LISTING', { provider: 'GrokAI', listing: listingFromResponse(STALE_GROK) }]);
  });

  it('SET_MODEL_LISTING + modelListingFor round-trip', () => {
    const s = { modelListing: {} };
    aiProvider.mutations.SET_MODEL_LISTING(s, { provider: 'GrokAI', listing: { stale: true } });
    expect(aiProvider.getters.modelListingFor(s)('GrokAI')).toEqual({ stale: true });
    expect(aiProvider.getters.modelListingFor(s)('OpenAI')).toBeNull();
  });
});
