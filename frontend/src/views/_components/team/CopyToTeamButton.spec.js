import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import CopyToTeamButton from './CopyToTeamButton.vue';

const wrappers = [];
afterEach(() => { wrappers.splice(0).forEach(w => w.unmount()); vi.unstubAllGlobals(); sessionStorage.clear(); document.body.innerHTML = ''; });

function setup({ links = [] } = {}) {
  const calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
    let body = {};
    if (url.includes('/share/links')) body = links;
    else if (url.endsWith('/teams')) body = [{ id: 'acme', name: 'Acme', role: 'member', tenantUrl: 'https://acme.agnt.gg' }, { id: 'look', name: 'Lookers', role: 'viewer', tenantUrl: 'https://look.agnt.gg' }];
    else if (url.endsWith('/share/preview')) body = { items: [{ kind: 'agent', id: 'a1', name: 'Researcher', dependency: false, stripped: 1 }, { kind: 'tool', id: 't1', name: 'Summarize', dependency: true, stripped: 0 }], dependencies: [], needs: [{ provider: 'github', reason: 'connection' }], removed: 1 };
    else if (url.endsWith('/share/team/acme')) body = { team: { id: 'acme', name: 'Acme' }, projectId: 'general', installed: [{ kind: 'agent', id: 'x' }], needs: [{ provider: 'github', reason: 'connection' }], removed: 1 };
    return { ok: true, json: async () => body };
  }));
  const w = mount(CopyToTeamButton, { attachTo: document.body, props: { kind: 'agent', id: 'a1', name: 'Researcher' }, global: { stubs: { BaseButton: { template: '<button class="base-button" @click="$emit(\'click\')"><slot /></button>' } } } });
  wrappers.push(w);
  return { w, calls };
}
const dialog = () => document.querySelector('.copy-dialog');

describe('Copy to team', () => {
  it('previews what goes, what was removed, and promises the team uses its own connections', async () => {
    const { w } = setup();
    await flushPromises();
    await w.find('.base-button').trigger('click');
    await flushPromises();
    const text = dialog().textContent;
    expect(text).toContain('Researcher');
    expect(text).toContain('used by Researcher');
    expect(text).toContain('GitHub');
    expect(text).toContain('Your credentials are never copied');
    expect(text).toMatch(/1 value that looked like a credential or a file on this computer was removed/);
    // Guests are not offered as a destination.
    expect(text).not.toContain('Lookers');
  });

  it('copies exactly this item, with dependencies by default, and offers to open the team', async () => {
    const { w, calls } = setup();
    await flushPromises();
    await w.find('.base-button').trigger('click');
    await flushPromises();
    [...dialog().querySelectorAll('button')].find(b => b.textContent.trim() === 'Copy to Acme').click();
    await flushPromises();
    expect(calls.find(c => c.url.endsWith('/share/team/acme'))).toMatchObject({ method: 'POST', body: { items: ['agent:a1'], includeDependencies: true } });
    expect(dialog().textContent).toContain('Researcher is now in Acme');
    expect([...dialog().querySelectorAll('button')].some(b => b.textContent.includes('Open Acme'))).toBe(true);
  });

  it('says when the team copy is out of date', async () => {
    const { w } = setup({ links: [{ kind: 'agent', id: 'a1', teamId: 'acme', stale: true }] });
    await flushPromises();
    expect(w.text()).toContain('Update team copy');
  });

  it('is not offered inside a team space', async () => {
    sessionStorage.setItem('agnt.teamScope', JSON.stringify({ teamId: 'acme' }));
    const { w, calls } = setup();
    await flushPromises();
    expect(w.find('.base-button').exists()).toBe(false);
    expect(calls).toHaveLength(0);
  });
});
