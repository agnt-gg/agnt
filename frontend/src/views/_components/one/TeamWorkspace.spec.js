import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createStore } from 'vuex';
import TeamWorkspace from './TeamWorkspace.vue';

const wrappers = [];
afterEach(() => { wrappers.splice(0).forEach(w => w.unmount()); vi.unstubAllGlobals(); delete window.electron; });

function setup(role = 'owner', { onInstance = true } = {}) {
  const calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
    calls.push({ url, options });
    let body = [];
    if (url.endsWith('/teams')) body = [{ id: 't', name: 'Engineering', role, tenantSlug: 'eng', tenantUrl: onInstance ? window.location.origin : 'https://eng.agnt.gg', entitlement: { teamsEnabled: true }, capabilities: { manageMembers: ['owner', 'admin'].includes(role) }, seats: { used: 2, total: 3 } }];
    else if (url.endsWith('/tenants')) body = { tenants: [] };
    else if (url.endsWith('/t/members')) body = [{ user_id: 'u1', email: 'owner@x.co', role: 'owner' }, { user_id: 'u2', email: 'dev@x.co', role }];
    else if (url.endsWith('/t/assets')) body = [{ id: 'a', name: 'Brief', kind: 'markdown', revision: 2 }];
    else if (url.endsWith('/tenants/eng')) body = { slug: 'eng', members: [], seats: { used: 2, total: 3 } };
    return { ok: true, json: async () => body };
  }));
  const store = createStore({ state: { userAuth: { token: 'u1', user: { id: 'u1' } } } });
  const w = mount(TeamWorkspace, { global: { plugins: [store], directives: { tooltip: {} } } });
  wrappers.push(w);
  return { w, calls };
}
const manage = async w => { await flushPromises(); await w.findAll('.rows button').find(b => b.text() === 'Manage').trigger('click'); await flushPromises(); };

describe('TeamWorkspace', () => {
  it('starts on the team list and loads a team only when chosen, always authenticated', async () => {
    const { w, calls } = setup();
    await flushPromises();
    expect(w.text()).toContain('Engineering');
    expect(calls.map(c => c.url.split('/api')[1])).toEqual(['/teams', '/tenants']);
    await manage(w);
    expect(w.find('nav .active').text()).toBe('Members');
    expect(w.text()).toContain('dev@x.co');
    expect(calls.every(c => 'Authorization' in c.options.headers)).toBe(true);
  });

  it('adds people in one step with a role, never raw capability strings', async () => {
    const { w } = setup();
    await manage(w);
    expect(w.text()).toContain('Add person');
    expect(w.text()).not.toMatch(/resources\.(read|write)|connections\.use/);
  });

  it('guests can look and download but cannot add people, invite, or edit library content', async () => {
    const { w } = setup('viewer');
    await manage(w);
    expect(w.text()).not.toContain('Add person');
    expect(w.text()).not.toContain('Send invitation');
    await w.findAll('nav button').find(b => b.text() === 'Library').trigger('click');
    await flushPromises();
    expect(w.text()).toContain('Brief');
    expect(w.find('textarea').exists()).toBe(false);
    expect(w.findAll('button').some(b => b.text() === 'Download')).toBe(true);
  });

  it('off the team instance, offers to open the team instead of showing empty lists', async () => {
    const host = { switch: vi.fn(async () => ({ ok: true })), syncTeams: vi.fn(async () => ({ ok: true })) };
    window.electron = { spaces: host };
    const { w, calls } = setup('owner', { onInstance: false });
    await manage(w);
    await w.findAll('nav button').find(b => b.text() === 'Projects').trigger('click');
    await flushPromises();
    expect(w.text()).toContain('Open Engineering to see its projects');
    expect(calls.some(c => c.url.includes('/t/workspaces'))).toBe(false);
    await w.findAll('header button').find(b => b.text() === 'Open Engineering').trigger('click');
    await flushPromises();
    expect(host.switch).toHaveBeenCalledWith('team:t', { projectId: null });
  });

  it('has no simulated membership or content in the initial state', async () => {
    const { w } = setup();
    await flushPromises();
    expect(w.text()).not.toContain('Release brief');
    expect(w.find('nav').exists()).toBe(false);
  });
});
