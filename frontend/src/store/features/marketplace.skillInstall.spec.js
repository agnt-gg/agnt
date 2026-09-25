import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createStore } from 'vuex';
import marketplace from './marketplace.js';
import { API_CONFIG } from '@/tt.config.js';

/**
 * Installing a marketplace SKILL, end to end through the store.
 *
 * agnt.gg now sends readers straight to skill listings ("Install in AGNT" on
 * the 100-best-skills article, and /marketplace/skills). The fixture below is
 * the asset api.agnt.gg actually returned for agnt-skill-frontend-design when
 * it was published — the shape of MarketplaceController's `case 'skill'` — so
 * this pins the contract between the two sides: whatever the server hands
 * back must land in POST /api/skills/ as `{ skill }`, unaltered.
 *
 * The failure worth guarding most is a silent one: a local save that fails
 * while the install reports success, sending the user to look for a skill that
 * was never written.
 */
const pristine = JSON.parse(JSON.stringify(marketplace.state));
const fetchSkills = vi.fn();
const makeStore = () =>
  createStore({
    modules: {
      marketplace: { ...marketplace, namespaced: true, state: JSON.parse(JSON.stringify(pristine)) },
      skills: { namespaced: true, actions: { fetchSkills } },
    },
  });

const SKILL_ASSET = {
  id: 'local-asset-id',
  name: 'frontend-design',
  description: 'Guidance for distinctive, intentional visual design when building new UI or reshaping an existing one.',
  instructions: '# Frontend Design\n\nApproach this as the design lead at a design studio.',
  category: 'Technology & Development',
  icon: 'fas fa-graduation-cap',
  license: 'Apache-2.0',
  compatibility: '',
  metadata: {
    author: 'Anthropic',
    source: 'https://github.com/anthropics/skills/blob/34040c9c568585f6929bedeaad110ad08f079624/skills/frontend-design/SKILL.md',
    'license-file': 'LICENSE.txt',
  },
  allowedTools: [],
  isBuiltin: 0,
};

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

/** Route fetch by URL: the remote install call, then the local save. */
function stubFetch({ localStatus = 201, localBody = { skillId: 'saved-1' } } = {}) {
  const calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('/marketplace/workflows/')) {
      return json(200, { assetType: 'skill', assetId: 'agnt-skill-frontend-design', assetData: SKILL_ASSET });
    }
    if (String(url) === `${API_CONFIG.BASE_URL}/skills/`) return json(localStatus, localBody);
    return json(404, { error: `unexpected ${url}` });
  }));
  return calls;
}

beforeEach(() => {
  localStorage.setItem('token', 'test-token');
  fetchSkills.mockClear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('marketplace store — installing a skill', () => {
  it('saves the listing\'s skill locally, exactly as the marketplace returned it', async () => {
    const calls = stubFetch();
    const store = makeStore();

    const result = await store.dispatch('marketplace/installWorkflow', { workflowId: 'listing-1' });

    const save = calls.find((c) => c.url === `${API_CONFIG.BASE_URL}/skills/`);
    expect(save, 'no local save was attempted').toBeTruthy();
    expect(save.init.method).toBe('POST');
    expect(save.init.headers.Authorization).toBe('Bearer test-token');
    expect(JSON.parse(save.init.body)).toEqual({ skill: SKILL_ASSET });
    expect(result.assetType).toBe('skill');
  });

  it('refreshes the Skills list so the new skill is visible at once', async () => {
    stubFetch();
    await makeStore().dispatch('marketplace/installWorkflow', { workflowId: 'listing-1' });
    expect(fetchSkills).toHaveBeenCalledTimes(1);
  });

  it('carries attribution and licence through to the local save', async () => {
    const calls = stubFetch();
    await makeStore().dispatch('marketplace/installWorkflow', { workflowId: 'listing-1' });
    const saved = JSON.parse(calls.find((c) => c.url === `${API_CONFIG.BASE_URL}/skills/`).init.body).skill;
    expect(saved.license).toBe('Apache-2.0');
    expect(saved.metadata.author).toBe('Anthropic');
    expect(saved.metadata.source).toMatch(/^https:\/\/github\.com\/anthropics\/skills\/blob\/[0-9a-f]{40}\//);
  });

  it('fails the install when the local save fails, instead of reporting success', async () => {
    stubFetch({ localStatus: 400, localBody: { error: 'name and description are required' } });
    const store = makeStore();
    await expect(store.dispatch('marketplace/installWorkflow', { workflowId: 'listing-1' }))
      .rejects.toThrow('name and description are required');
    expect(fetchSkills).not.toHaveBeenCalled();
    // The shared local-save helper prefixes context; what matters is that the
    // server's reason reaches the user rather than a bare status.
    expect(store.state.marketplace.error).toContain('name and description are required');
  });

  it('saves a skill fetched earlier through saveInstalledAsset the same way', async () => {
    const calls = stubFetch();
    const result = await makeStore().dispatch('marketplace/saveInstalledAsset', { assetType: 'skill', assetData: SKILL_ASSET });
    expect(result).toEqual({ success: true });
    const save = calls.find((c) => c.url === `${API_CONFIG.BASE_URL}/skills/`);
    expect(JSON.parse(save.init.body)).toEqual({ skill: SKILL_ASSET });
  });
});
