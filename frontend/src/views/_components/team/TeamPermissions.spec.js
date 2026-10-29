import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

vi.mock('@/tt.config.js', () => ({ API_CONFIG: { BASE_URL: 'http://instance/api' } }));
import TeamPermissions from './TeamPermissions.vue';

const catalog = {
  'workflows.build': 'Create and edit workflows and agents',
  'workflows.run': 'Run workflows and agents',
  'code.run': 'Run code (in the secure cloud sandbox)',
};
const all = (value) => Object.fromEntries(Object.keys(catalog).map((key) => [key, value]));
const ownerView = (overrides = {}) => ({
  revision: 3, role: 'owner', canEdit: true, catalog,
  policy: { preset: 'open', roles: { admin: all(true), member: all(true) }, members: {}, adminsCanEdit: false },
  ...overrides,
});

let responses;
const calls = [];
beforeEach(() => {
  calls.length = 0;
  responses = [];
  global.fetch = vi.fn(async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
    const next = responses.shift();
    return { ok: next.ok !== false, json: async () => next.body };
  });
});
afterEach(() => { delete global.fetch; });

describe('team permissions', () => {
  it('shows nothing to someone who cannot change the rules', async () => {
    responses.push({ body: { revision: 3, role: 'member', canEdit: false, permissions: all(true), catalog } });
    const wrapper = mount(TeamPermissions, { props: { teamId: 'genii' } });
    await flushPromises();
    expect(wrapper.find('.team-permissions').exists()).toBe(false);
  });

  it('shows nothing when the cloud does not have team permissions yet', async () => {
    responses.push({ ok: false, body: { error: 'Not found' } });
    const wrapper = mount(TeamPermissions, { props: { teamId: 'genii' } });
    await flushPromises();
    expect(wrapper.find('.team-permissions').exists()).toBe(false);
  });

  it('asks the cloud for this team, through the instance', async () => {
    responses.push({ body: ownerView() });
    mount(TeamPermissions, { props: { teamId: 'genii' } });
    await flushPromises();
    expect(calls[0]).toMatchObject({ url: 'http://instance/api/teams/genii/policy', method: 'GET' });
  });

  it('the owner switches one permission for members, sending the revision it saw', async () => {
    responses.push({ body: ownerView() });
    const wrapper = mount(TeamPermissions, { props: { teamId: 'genii' } });
    await flushPromises();
    responses.push({ body: ownerView({ revision: 4, policy: { ...ownerView().policy, preset: 'custom', roles: { admin: all(true), member: { ...all(true), 'code.run': false } } } }) });
    const memberCode = wrapper.find('input[aria-label="Run code (in the secure cloud sandbox) for members"]');
    await memberCode.setValue(false);
    await flushPromises();
    expect(calls[1]).toEqual({ url: 'http://instance/api/teams/genii/policy', method: 'PUT', body: { roles: { member: { 'code.run': false } }, revision: 3 } });
    expect(wrapper.find('input[aria-label="Run code (in the secure cloud sandbox) for members"]').element.checked).toBe(false);
  });

  it('a preset is one click', async () => {
    responses.push({ body: ownerView() });
    const wrapper = mount(TeamPermissions, { props: { teamId: 'genii' } });
    await flushPromises();
    responses.push({ body: ownerView({ revision: 4 }) });
    await wrapper.find('input[value="locked"]').setValue(true);
    await flushPromises();
    expect(calls[1].body).toEqual({ preset: 'locked', revision: 3 });
  });

  it('when someone else changed them first, it reloads the latest instead of overwriting', async () => {
    responses.push({ body: ownerView() });
    const wrapper = mount(TeamPermissions, { props: { teamId: 'genii' } });
    await flushPromises();
    responses.push({ ok: false, body: { error: 'Team permissions changed; reload and try again', code: 'policy_stale' } });
    responses.push({ body: ownerView({ revision: 5 }) });
    await wrapper.find('input[value="careful"]').setValue(true);
    await flushPromises();
    expect(calls[2]).toMatchObject({ method: 'GET' });
    expect(wrapper.find('.error').text()).toMatch(/Someone else just changed these/);
  });

  it('only the owner sees the switch that lets admins edit', async () => {
    responses.push({ body: ownerView({ role: 'admin' }) });
    const wrapper = mount(TeamPermissions, { props: { teamId: 'genii' } });
    await flushPromises();
    expect(wrapper.find('.delegate').exists()).toBe(false);
  });
});
