import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import MkDrawer from './MkDrawer.vue';

vi.mock('@/composables/useSpaces.js', () => ({ openTeam: vi.fn(), openPersonal: vi.fn() }));

const mountDrawer = (props, slots) => mount(MkDrawer, { props, slots, global: { directives: { tooltip: {} } } });
const team = (role) => ({ id: 't', name: 'bravo', role, tenantUrl: 'https://bravo.t1.agnt.gg' });

// The approved mockup always has + beside "Teamspaces". The server decides who may create
// one; a client-side role check once hid the button for anyone whose role was not literally 'owner'.
describe('drawer: Teamspaces +', () => {
  it.each(['owner', 'admin', 'member', undefined])('shows + beside Teamspaces for role %s and asks for a new teamspace', async (role) => {
    const wrapper = mountDrawer({ team: team(role), teams: [team(role)], spaces: [] });
    const plus = wrapper.find('[data-testid="new-teamspace"]');
    expect(plus.exists()).toBe(true);
    expect(plus.element.closest('.d-head').textContent).toContain('Teamspaces');
    await plus.trigger('click');
    expect(wrapper.emitted('new-space')).toHaveLength(1);
    expect(wrapper.text()).toContain('No teamspaces yet. Add one with +.');
  });

  it('a teamspace with stopped work, or at its limit, says so beside its name; a calm one shows nothing', () => {
    const spaces = [{ id: 'sales', name: 'Sales' }, { id: 'ops', name: 'Ops' }, { id: 'mkt', name: 'Marketing' }];
    const wrapper = mountDrawer({ team: team('member'), teams: [team('member')], spaces, marks: { sales: '1 stopped', ops: 'At limit' } });
    expect(wrapper.get('[data-testid="space-mark-sales"]').text()).toBe('1 stopped');
    expect(wrapper.get('[data-testid="space-mark-ops"]').text()).toBe('At limit');
    expect(wrapper.find('[data-testid="space-mark-mkt"]').exists()).toBe(false);
  });

  it('personal workspace has no Teamspaces group, so no +', () => {
    const wrapper = mountDrawer({ team: null, teams: [], spaces: [] });
    expect(wrapper.find('[data-testid="new-teamspace"]').exists()).toBe(false);
  });
});

// One sidebar for the drawer and the chats (2026-11): one search, New chat,
// the Main chat, My Space, Teamspaces, then the chats OneShell passes in.
describe('the one sidebar', () => {
  beforeEach(() => localStorage.clear());
  const spaces = [{ id: 'sales', name: 'Sales' }, { id: 'ops', name: 'Ops' }];
  const sidebar = (extra = {}, slots) => mountDrawer({ team: team('owner'), teams: [team('owner')], spaces, counts: { agents: 5, routines: 4 }, ...extra }, slots);
  const search = (w) => w.get('[data-testid="one-sidebar-search"]');

  it('New chat starts a chat; its chevron holds the rest of New…', async () => {
    const w = sidebar();
    await w.get('[data-testid="one-new-chat"]').trigger('click');
    expect(w.emitted('new-chat')).toHaveLength(1);
    await w.get('[data-testid="one-new-menu"]').trigger('click');
    const items = w.findAll('.new-menu [role="menuitem"]');
    expect(items.map((b) => b.text())).toEqual(['Task', 'Doc', 'Agent', 'Routine']);
    await items[0].trigger('click');
    expect(w.emitted('pick')).toEqual([['new-task']]);
    expect(w.find('.new-menu').exists()).toBe(false);
  });

  it('the Main chat row opens the Main chat; its eraser clears it, and never while a reply streams', async () => {
    const w = sidebar({ mainChat: { open: true, unread: false, streaming: false } });
    const row = w.get('[data-testid="main-chat-row"]');
    expect(row.classes()).toContain('is-active');
    expect(row.text()).toContain('Main chat');
    await row.trigger('click');
    expect(w.emitted('open-main')).toHaveLength(1);
    await w.get('[data-testid="main-chat-clear"]').trigger('click');
    expect(w.emitted('clear-main')).toHaveLength(1);
    expect(w.emitted('open-main')).toHaveLength(1); // the eraser does not also open it
    await w.setProps({ mainChat: { open: false, unread: false, streaming: true } });
    expect(w.get('[data-testid="main-chat-row"]').classes()).not.toContain('is-active');
    expect(w.get('[data-testid="main-chat-clear"]').attributes('disabled')).toBeDefined();
  });

  it('one search filters the sidebar in place, then hands over to Annie or to Find anything', async () => {
    const w = sidebar();
    await search(w).setValue('  sal ');
    expect(w.find('[data-testid="one-new-chat"]').exists()).toBe(false);
    expect(w.find('[data-testid="main-chat-row"]').exists()).toBe(false);
    expect(w.text()).not.toContain('My agents');
    expect(w.text()).toContain('Sales');
    expect(w.text()).not.toContain('Ops');
    expect(w.get('[data-testid="one-sidebar-ask"]').text()).toBe('Ask Annie about “sal”');
    await w.get('[data-testid="one-sidebar-ask"]').trigger('click');
    expect(w.emitted('ask')).toEqual([['sal']]);
    expect(search(w).element.value).toBe('');

    await search(w).setValue('quarterly');
    await search(w).trigger('keydown', { key: 'Enter' });
    expect(w.emitted('find')).toEqual([['quarterly']]);
    expect(search(w).element.value).toBe('');

    await search(w).setValue('x');
    await search(w).trigger('keydown', { key: 'Escape' });
    expect(search(w).element.value).toBe('');
    expect(w.find('[data-testid="one-new-chat"]').exists()).toBe(true);
  });

  it('hands the search to the chats, inside the sidebar', async () => {
    const w = sidebar({}, { chats: '<template #chats="{ query }"><span class="chats-probe">[{{ query }}]</span></template>' });
    const probe = () => w.get('[data-testid="one-chat-sidebar"] .chats-probe');
    expect(probe().text()).toBe('[]');
    await search(w).setValue('  northwind ');
    expect(probe().text()).toBe('[northwind]');
  });

  it('a section folds by its name and stays folded; a search still looks inside it', async () => {
    const w = sidebar();
    expect(w.text()).toContain('My agents5');
    await w.get('[data-testid="fold-mine"]').trigger('click');
    expect(w.text()).not.toContain('My agents');
    expect(w.get('[data-testid="fold-mine"]').attributes('aria-expanded')).toBe('false');
    expect(JSON.parse(localStorage.getItem('agnt:one-sidebar:folded'))).toEqual({ mine: true, spaces: false });
    w.unmount();

    const again = sidebar();
    expect(again.text()).not.toContain('My agents');
    expect(again.text()).toContain('Sales'); // Teamspaces did not fold with it
    await search(again).setValue('agents');
    expect(again.text()).toContain('My agents');
  });

  it('collapses from its foot, as in Studio', async () => {
    const w = sidebar();
    const collapse = w.get('[data-testid="one-sidebar-collapse"]');
    expect(collapse.attributes('aria-label')).toBe('Collapse sidebar');
    expect(collapse.text()).toBe('Collapse');
    expect(collapse.find('.fa-angle-double-left').exists()).toBe(true);
    await collapse.trigger('click');
    expect(w.emitted('collapse')).toHaveLength(1);
  });

  it('a personal workspace: no My tasks, and the note in place of Teamspaces', () => {
    const w = mountDrawer({ team: null, teams: [], spaces: [], counts: {} });
    expect(w.text()).not.toContain('My tasks');
    expect(w.text()).toContain('My agents');
    // It read "private.Set up a team": the space was dropped with the branch's leading whitespace.
    expect(w.get('.d-note').text()).toBe('This is your personal workspace: everything here is private. Set up a team to work with others.');
    const withTeam = mountDrawer({ team: null, teams: [team('member')], spaces: [], counts: {} });
    expect(withTeam.get('.d-note').text()).toBe('This is your personal workspace: everything here is private. Teamspaces live in bravo.');
  });
});
