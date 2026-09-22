import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import TeamProjects from './TeamProjects.vue';

const wrappers = [];
afterEach(() => { wrappers.splice(0).forEach(w => w.unmount()); vi.unstubAllGlobals(); });

function setup(role = 'admin', { publishFails = false } = {}) {
  const calls = [];
  let items = [{ id: 'a1', kind: 'agent', name: 'Researcher', status: 'draft' }, { id: 'w1', kind: 'workflow', name: 'Triage', status: 'changed' }];
  vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET' });
    const reply = (body, ok = true, status = 200) => ({ ok, status, json: async () => body });
    if (url.endsWith('/t/workspaces')) return reply([{ id: 'p1', name: 'General', is_default: true }]);
    if (url.endsWith('/native')) return reply(items);
    if (url.endsWith('/agent/a1/publish')) {
      if (publishFails) return reply({ error: 'Connect anthropic for the team first (Team \u2192 Connections)', code: 'connection_required', provider: 'anthropic' }, false, 409);
      items = items.map(i => (i.id === 'a1' ? { ...i, status: 'published' } : i));
      return reply({ approvedRevision: 1 });
    }
    if (url.endsWith('/workflow/w1/run')) return reply({ status: 'completed', result: { content: 'Filed 3 issues.' } });
    return reply({});
  }));
  const w = mount(TeamProjects, { props: { team: { id: 't', name: 'Acme', role }, onTeamInstance: true } });
  wrappers.push(w);
  return { w, calls };
}
const openAutomations = async w => { await flushPromises(); await w.findAll('button').find(b => b.text() === 'Automations').trigger('click'); await flushPromises(); };
const button = (w, text) => w.findAll('button').find(b => b.text() === text);

describe('project automations', () => {
  it('shows each item as draft, published or changed since publish', async () => {
    const { w } = setup();
    await openAutomations(w);
    expect(w.text()).toContain('Draft');
    expect(w.text()).toContain('Changed since publish');
    expect(button(w, 'Publish')).toBeTruthy();
    expect(button(w, 'Publish changes')).toBeTruthy();
  });

  it('publishing approves the item and makes it runnable', async () => {
    const { w, calls } = setup();
    await openAutomations(w);
    await button(w, 'Publish').trigger('click');
    await flushPromises();
    expect(calls.some(c => c.url.endsWith('/native/agent/a1/publish') && c.method === 'POST')).toBe(true);
    expect(w.text()).toContain('Published');
  });

  it('a missing team connection says what to connect and links there', async () => {
    const { w } = setup('admin', { publishFails: true });
    await openAutomations(w);
    await button(w, 'Publish').trigger('click');
    await flushPromises();
    expect(w.find('.notice').text()).toContain('Connect anthropic for the team first');
    await w.find('.notice button').trigger('click');
    expect(w.emitted('go-connections')).toHaveLength(1);
  });

  it('members run published work and see the result, but cannot publish', async () => {
    const { w } = setup('member');
    await openAutomations(w);
    expect(button(w, 'Publish')).toBeUndefined();
    await button(w, 'Run').trigger('click');
    await flushPromises();
    expect(w.text()).toContain('Filed 3 issues.');
  });

  it('guests can look but not run', async () => {
    const { w } = setup('viewer');
    await openAutomations(w);
    expect(button(w, 'Run')).toBeUndefined();
    expect(button(w, 'Publish')).toBeUndefined();
  });
});
