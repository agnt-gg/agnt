import { describe, it, expect, vi } from 'vitest';

vi.mock('@/tt.config.js', () => ({ API_CONFIG: { BASE_URL: 'http://local.test/api', REMOTE_URL: 'https://remote.test' } }));
vi.mock('@/utils/apiFetch.js', () => ({ apiFetch: vi.fn() }));

const { apiFetch } = await import('@/utils/apiFetch.js');
const { buildPublishRequest, skillAssetData, fetchWorkflowForPublish, fetchStripeConnected, money, PUBLISHABLE_KINDS } = await import('./marketplacePublish.js');

const form = { title: 'T', description: 'D', category: 'c', price: 0, preview_image: '' };
const respond = (status, body) => ({ ok: status < 400, status, json: async () => body });

describe('buildPublishRequest', () => {
  it('an agent ships whole, with its avatar as the default preview', async () => {
    const agent = { id: 'a1', name: 'Kai', avatar: 'data:img' };
    expect(await buildPublishRequest('agent', agent, form)).toMatchObject({ title: 'T', asset_data: agent, preview_image: 'data:img' });
    expect((await buildPublishRequest('agent', agent, { ...form, preview_image: 'mine' })).preview_image).toBe('mine');
  });
  it('a tool ships whole', async () => {
    const tool = { id: 't1', title: 'Fetch' };
    expect(await buildPublishRequest('tool', tool, form)).toMatchObject({ asset_data: tool });
  });
  it('a skill keeps every field an install needs, including snake_case allowed tools', async () => {
    const out = await buildPublishRequest('skill', { id: 's1', name: 'cite', instructions: 'Do X', allowed_tools: ['web_search'] }, form);
    expect(out.asset_data).toEqual(skillAssetData({ name: 'cite', instructions: 'Do X', allowed_tools: ['web_search'] }));
    expect(out.asset_data.allowedTools).toEqual(['web_search']);
  });
  it('a workflow is read fresh, not taken from the list row', async () => {
    const loadWorkflow = vi.fn(async (id) => ({ id, nodes: [1, 2] }));
    const out = await buildPublishRequest('workflow', { id: 'w1', name: 'stale row' }, form, { loadWorkflow });
    expect(loadWorkflow).toHaveBeenCalledWith('w1');
    expect(out.workflow_data).toEqual({ id: 'w1', nodes: [1, 2] });
  });
  it('refuses kinds it cannot publish and a missing item, with a reason', async () => {
    await expect(buildPublishRequest('plugin', { id: 'p' }, form)).rejects.toThrow('can’t be published');
    await expect(buildPublishRequest('agent', null, form)).rejects.toThrow('Choose what to publish');
    expect(PUBLISHABLE_KINDS).not.toContain('plugin');
  });
});

describe('backend reads', () => {
  it('fetchWorkflowForPublish returns the workflow or throws the server reason', async () => {
    apiFetch.mockResolvedValueOnce(respond(200, { workflow: { id: 'w1' } }));
    await expect(fetchWorkflowForPublish('w 1')).resolves.toEqual({ id: 'w1' });
    expect(apiFetch).toHaveBeenLastCalledWith('http://local.test/api/workflows/w%201');
    apiFetch.mockResolvedValueOnce(respond(404, { error: 'Not found' }));
    await expect(fetchWorkflowForPublish('x')).rejects.toThrow('Not found');
  });
  it('fetchStripeConnected needs both an account and finished onboarding; failures read as false', async () => {
    apiFetch.mockResolvedValueOnce(respond(200, { exists: true, onboardingComplete: true }));
    expect(await fetchStripeConnected()).toBe(true);
    apiFetch.mockResolvedValueOnce(respond(200, { exists: true, onboardingComplete: false }));
    expect(await fetchStripeConnected()).toBe(false);
    apiFetch.mockResolvedValueOnce(respond(500, {}));
    expect(await fetchStripeConnected()).toBe(false);
    apiFetch.mockRejectedValueOnce(new Error('offline'));
    expect(await fetchStripeConnected()).toBe(false);
  });
});

describe('money', () => {
  it('formats dollars and never shows NaN', () => {
    expect(money(12.5)).toBe('$12.50');
    expect(money(undefined)).toBe('$0.00');
    expect(money('abc')).toBe('$0.00');
  });
});
