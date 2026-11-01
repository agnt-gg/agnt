import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import CopyToTeamButton from './CopyToTeamButton.vue';
import VisibleToSelect from './VisibleToSelect.vue';

/**
 * "Visible to" on a personal item: Only you, or a COPY into a teamspace the person can add
 * to, through the Copy to team dialog (preview, credentials stripped, original untouched).
 */
const wrappers = [];
afterEach(() => { wrappers.splice(0).forEach(w => w.unmount()); vi.unstubAllGlobals(); sessionStorage.clear(); document.body.innerHTML = ''; });

// CustomSelect, as a native <select>: the same props and event, so a choice is one `setValue`.
const CustomSelect = {
  props: ['modelValue', 'options', 'disabled'],
  emits: ['update:modelValue'],
  template: '<select class="cs" :value="modelValue" :disabled="disabled" @change="$emit(\'update:modelValue\', $event.target.value)"><option v-for="o in options" :key="o.value" :value="o.value">{{ o.label }}</option></select>',
};

function setup({ links = [], spacesFail = false } = {}) {
  const calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
    let body = {};
    let ok = true;
    if (url.includes('/share/links')) body = links;
    else if (url.endsWith('/teams')) body = [{ id: 'acme', name: 'Acme', role: 'member', tenantUrl: 'https://acme.agnt.gg' }, { id: 'look', name: 'Lookers', role: 'viewer', tenantUrl: 'https://look.agnt.gg' }];
    else if (url.endsWith('/share/team/acme/spaces')) { if (spacesFail) { ok = false; body = { error: 'Team instance unreachable' }; } else body = [{ id: 'general', name: 'General', is_default: true }, { id: 'sales', name: 'Sales' }]; }
    else if (url.endsWith('/share/preview')) body = { items: [{ kind: 'agent', id: 'a1', name: 'Researcher', dependency: false }, { kind: 'tool', id: 't1', name: 'Summarize', dependency: true }], dependencies: [], needs: [{ provider: 'github', reason: 'connection' }], removed: 1 };
    else if (url.endsWith('/share/team/acme')) body = { team: { id: 'acme', name: 'Acme' }, projectId: 'sales', installed: [{ kind: 'agent', id: 'x' }], needs: [], removed: 1 };
    return { ok, status: ok ? 200 : 502, json: async () => body };
  }));
  const w = mount(CopyToTeamButton, { attachTo: document.body, props: { kind: 'agent', id: 'a1', name: 'Researcher' }, global: { stubs: { CustomSelect } } });
  wrappers.push(w);
  return { w, calls };
}
const dialog = () => document.querySelector('.copy-dialog');
const labels = (w) => w.findAll('[data-testid="visible-to"] option').map(o => o.text());
const pick = async (w, value) => { await w.find('[data-testid="visible-to"]').setValue(value); await flushPromises(); };

describe('Visible to, on a personal item', () => {
  it('is Only you, then each teamspace you can add to; guests\' teams are not offered', async () => {
    const { w } = setup();
    await flushPromises();
    expect(w.find('[data-testid="visible-to"]').element.value).toBe('private');
    expect(labels(w)).toEqual(['Only you', 'Acme › 💬 General (copy)', 'Acme › 💼 Sales (copy)']);
  });

  it('a teamspace opens the copy preview, and Copy sends exactly this item into exactly that teamspace', async () => {
    const { w, calls } = setup();
    await flushPromises();
    await pick(w, 'acme|sales');
    const text = dialog().textContent;
    expect(text).toContain('Into the Sales teamspace');
    expect(text).toContain('Your credentials are never copied');
    expect(text).toMatch(/1 value that looked like a credential or a file on this computer was removed/);
    expect(text).toContain('Your original stays yours');
    [...dialog().querySelectorAll('button')].find(b => b.textContent.trim() === 'Copy to Acme').click();
    await flushPromises();
    expect(calls.find(c => c.url.endsWith('/share/team/acme'))).toMatchObject({ method: 'POST', body: { items: ['agent:a1'], includeDependencies: true, projectId: 'sales' } });
    // The item itself stays private: the control is still bound to Only you.
    expect(w.findComponent(VisibleToSelect).props('modelValue')).toBe('private');
  });

  it('shows where copies are, and offers to update one that is out of date', async () => {
    const { w } = setup({ links: [{ kind: 'agent', id: 'a1', teamId: 'acme', projectId: 'sales', stale: true }] });
    await flushPromises();
    expect(labels(w)).toContain('Acme › 💼 Sales (update copy)');
    expect(w.text()).toContain('Copies in Acme › 💼 Sales.');
    expect(w.text()).toContain('Changed since you copied it');
  });

  it('a team whose teamspaces cannot be read is still offered, into its default space', async () => {
    const { w, calls } = setup({ spacesFail: true });
    await flushPromises();
    expect(labels(w)).toEqual(['Only you', 'Acme (copy)']);
    await pick(w, 'acme|');
    [...dialog().querySelectorAll('button')].find(b => b.textContent.trim() === 'Copy to Acme').click();
    await flushPromises();
    expect(calls.find(c => c.url.endsWith('/share/team/acme')).body).not.toHaveProperty('projectId');
  });

  it('is not offered inside a team space', async () => {
    sessionStorage.setItem('agnt.teamScope', JSON.stringify({ teamId: 'acme' }));
    const { w, calls } = setup();
    await flushPromises();
    expect(w.find('[data-testid="visible-to"]').exists()).toBe(false);
    expect(calls).toHaveLength(0);
  });
});
