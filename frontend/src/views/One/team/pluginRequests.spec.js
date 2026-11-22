import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import TeamPluginRequestRow from './TeamPluginRequestRow.vue';
import { reachLabel, requestNeeds, usePluginRequests, _resetPluginRequests } from '@/composables/usePluginRequests.js';

const youtube = { id: 'r1', pluginName: 'youtube-plugin', requesterId: 'ana', status: 'pending', createdAt: new Date().toISOString(), report: { reaches: ['network', 'filesystem', 'env-access'], trustTier: 'official', integrityState: 'verified' } };
const ctx = { people: { value: [{ id: 'ana', name: 'Ana Ruiz' }] } };
const mountRow = (props) => mount(TeamPluginRequestRow, { props, global: { provide: { teamCtx: ctx }, directives: { tooltip: {} } } });

describe('a plugin request on Home', () => {
  it('the owner sees who asked, what it can reach, and Approve / Decline', async () => {
    const row = mountRow({ request: youtube, decider: true });
    expect(row.text()).toContain('Ana Ruiz wants to add the plugin Youtube');
    expect(row.text()).toContain('the internet, this instance’s files, this instance’s settings and keys');
    expect(row.text()).toContain('Official AGNT plugin, verified download');
    await row.find('.primary').trigger('click');
    expect(row.emitted('approve')[0][0].id).toBe('r1');
    await row.findAll('button').find((b) => b.text() === 'Decline').trigger('click');
    expect(row.emitted('decline')).toHaveLength(1);
  });
  it('the person who asked sees the outcome and can dismiss it', async () => {
    const row = mountRow({ request: { ...youtube, status: 'approved' } });
    expect(row.text()).toContain('Youtube is ready. Your request was approved.');
    await row.find('button').trigger('click');
    expect(row.emitted('dismiss')).toHaveLength(1);
    expect(mountRow({ request: { ...youtube, status: 'declined' } }).text()).toContain('was not approved');
  });
  it('counts what needs you: open requests only if you decide, your outcomes until dismissed', () => {
    expect(reachLabel([])).toBe('nothing beyond its own code');
    expect(requestNeeds({ canDecide: true, pending: [youtube], mine: [] })).toBe(1);
    expect(requestNeeds({ canDecide: false, pending: [youtube], mine: [youtube, { ...youtube, status: 'approved' }] })).toBe(1);
  });
});

describe('the client talks to the request routes', () => {
  beforeEach(() => { _resetPluginRequests(); localStorage.setItem('token', 't'); });
  it('loads, approves and reloads; a decided request leaves the queue', async () => {
    const calls = [];
    let pending = [youtube];
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      calls.push(`${opts.method || 'GET'} ${String(url).replace(/^.*\/plugins/, '')}`);
      if (String(url).endsWith('/approve')) { pending = []; return { ok: true, status: 200, json: async () => ({ success: true, approved: 1 }) }; }
      return { ok: true, status: 200, json: async () => ({ success: true, canDecide: true, pending, mine: [] }) };
    }));
    const plugins = usePluginRequests();
    await plugins.load();
    expect(plugins.state.pending).toHaveLength(1);
    await plugins.approve('r1');
    await flushPromises();
    expect(calls).toEqual(['GET /requests', 'POST /requests/r1/approve', 'GET /requests']);
    expect(plugins.state.pending).toEqual([]);
    vi.unstubAllGlobals();
  });
});
