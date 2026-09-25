import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createStore } from 'vuex';
import marketplace from './marketplace.js';
import { API_CONFIG } from '@/tt.config.js';

/**
 * Published skills were invisible to the app and uninstallable from it.
 *
 * The server has served `asset_type: 'skill'` for months, but the store only
 * bucketed workflow/agent/tool/plugin, so skills were dropped on arrival, and
 * the install switch had no skill branch, so installing one threw
 * "Unsupported asset type: skill". An agnt://marketplace?item=<skill> link from
 * agnt.gg therefore opened the app and found nothing.
 */
const pristine = JSON.parse(JSON.stringify(marketplace.state));
const refreshed = [];
const stubModule = (name, actions) => ({
  namespaced: true,
  actions: Object.fromEntries(actions.map((a) => [a, () => { refreshed.push(`${name}/${a}`); }])),
});
const makeStore = () =>
  createStore({
    modules: {
      marketplace: { ...marketplace, namespaced: true, state: JSON.parse(JSON.stringify(pristine)) },
      skills: stubModule('skills', ['fetchSkills']),
      workflows: stubModule('workflows', ['fetchWorkflows']),
      agents: stubModule('agents', ['fetchAgents']),
      tools: stubModule('tools', ['fetchTools']),
    },
  });

const SKILL_LISTING = { id: 'sk-1', asset_type: 'skill', asset_id: 'agnt-skill-frontend-design', title: 'Frontend Design skill' };
const SKILL_ROW = { id: 'local-uuid', name: 'frontend-design', description: 'Design guidance', instructions: '# Frontend Design' };

const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

/** Route fetch by URL: remote install answers, local save answers `localStatus`. */
function stubNetwork({ localStatus = 201 } = {}) {
  const calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    calls.push({ url, init });
    if (url.startsWith(API_CONFIG.REMOTE_URL) && url.endsWith('/install')) {
      return json({ assetType: 'skill', assetId: SKILL_ROW.id, assetData: SKILL_ROW });
    }
    if (url === `${API_CONFIG.BASE_URL}/skills/`) {
      return localStatus < 300 ? json({ skill: SKILL_ROW, skillId: SKILL_ROW.id }, localStatus) : json({ error: 'name and description are required' }, localStatus);
    }
    return json({ items: [] });
  }));
  return calls;
}

beforeEach(() => {
  refreshed.length = 0;
  localStorage.setItem('token', 'test-token');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('marketplace store — skills', () => {
  it('buckets skills instead of dropping them', () => {
    const store = makeStore();
    store.commit('marketplace/SET_MARKETPLACE_ITEMS', [SKILL_LISTING, { id: 'p1', asset_type: 'plugin' }]);
    expect(store.getters['marketplace/filteredMarketplaceSkills']).toEqual([SKILL_LISTING]);
    expect(store.getters['marketplace/filteredMarketplacePlugins']).toHaveLength(1);
  });

  it('installs a skill by saving the returned row to the local skills endpoint', async () => {
    const calls = stubNetwork();
    const store = makeStore();
    const result = await store.dispatch('marketplace/installWorkflow', { workflowId: SKILL_LISTING.id });

    expect(result.assetType).toBe('skill');
    const save = calls.find((c) => c.url === `${API_CONFIG.BASE_URL}/skills/`);
    expect(save, 'the skill was never saved locally').toBeTruthy();
    expect(save.init.method).toBe('POST');
    expect(JSON.parse(save.init.body)).toEqual({ skill: SKILL_ROW });
    expect(save.init.headers.Authorization).toBe('Bearer test-token');
    // The Skills screen must show it without a restart.
    expect(refreshed).toContain('skills/fetchSkills');
  });

  it('reports a failed local save as a failed install, not a success', async () => {
    stubNetwork({ localStatus: 400 });
    const store = makeStore();
    await expect(store.dispatch('marketplace/installWorkflow', { workflowId: SKILL_LISTING.id }))
      .rejects.toThrow(/Could not save the skill locally \(400\): name and description are required/);
    expect(refreshed).not.toContain('skills/fetchSkills');
  });

  it('saveInstalledAsset (the after-plugins path) saves skills the same way', async () => {
    const calls = stubNetwork();
    const store = makeStore();
    await store.dispatch('marketplace/saveInstalledAsset', { assetType: 'skill', assetData: SKILL_ROW });
    expect(calls.some((c) => c.url === `${API_CONFIG.BASE_URL}/skills/`)).toBe(true);
  });

  it('still refuses an asset type it does not know how to save', async () => {
    stubNetwork();
    const store = makeStore();
    await expect(store.dispatch('marketplace/saveInstalledAsset', { assetType: 'widget', assetData: {} }))
      .rejects.toThrow('Unsupported asset type: widget');
  });
});
