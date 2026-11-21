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

// One sidebar for the drawer and the chats (Focused v2): one search, New chat,
// the Main chat, in a team My tasks and Teamspaces, then the chats OneShell
// passes in. The rail reaches every page, so the sidebar never repeats it.
describe('the one sidebar', () => {
  beforeEach(() => localStorage.clear());
  const spaces = [{ id: 'sales', name: 'Sales' }, { id: 'ops', name: 'Ops' }];
  const sidebar = (extra = {}, slots) => mountDrawer({ team: team('owner'), teams: [team('owner')], spaces, counts: { agents: 5, routines: 4, tasks: 2 }, ...extra }, slots);
  const search = (w) => w.get('[data-testid="one-sidebar-search"]');

  it('never repeats the rail: no My agents, My routines or My files rows', () => {
    for (const w of [sidebar(), mountDrawer({ team: null, teams: [], spaces: [], counts: { agents: 5, files: 3 } })]) {
      expect(w.text()).not.toMatch(/My agents|My routines|My files/);
    }
  });

  it('New chat is one full-width button, with nothing else to start from here', async () => {
    const w = sidebar();
    expect(w.get('[data-testid="one-new-chat"]').text()).toBe('New chat');
    expect(w.find('[data-testid="one-new-menu"]').exists()).toBe(false);
    await w.get('[data-testid="one-new-chat"]').trigger('click');
    expect(w.emitted('new-chat')).toHaveLength(1);
  });

  it('the Main chat row says what it is, opens the Main chat, and its eraser clears it, never while a reply streams', async () => {
    const w = sidebar({ mainChat: { open: true, unread: false, streaming: false } });
    const row = w.get('[data-testid="main-chat-row"]');
    expect(row.classes()).toContain('is-active');
    expect(row.find('.main-text b').text()).toBe('Main chat');
    expect(row.find('.main-text small').text()).toBe('Your everyday chat with Annie');
    await row.trigger('click');
    expect(w.emitted('open-main')).toHaveLength(1);
    await w.get('[data-testid="main-chat-clear"]').trigger('click');
    expect(w.emitted('clear-main')).toHaveLength(1);
    expect(w.emitted('open-main')).toHaveLength(1); // the eraser does not also open it
    await w.setProps({ mainChat: { open: false, unread: false, streaming: true } });
    expect(w.get('[data-testid="main-chat-row"]').classes()).not.toContain('is-active');
    expect(w.get('[data-testid="main-chat-clear"]').attributes('disabled')).toBeDefined();
  });

  it('one search filters the sidebar in place and hands over to Find anything; asking is the composer\'s', async () => {
    const w = sidebar();
    expect(search(w).attributes('placeholder')).toBe('Search');
    await search(w).setValue('  sal ');
    expect(w.find('[data-testid="main-chat-row"]').exists()).toBe(false);
    expect(w.text()).toContain('Sales');
    expect(w.text()).not.toContain('Ops');
    expect(w.find('[data-testid="one-sidebar-ask"]').exists()).toBe(false);
    expect(w.get('[data-testid="one-sidebar-find"]').text()).toContain('Find “sal” everywhere');

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

  it('in a team, Mine holds My tasks; it folds by its name and stays folded, and a search still looks inside it', async () => {
    const w = sidebar();
    expect(w.text()).toContain('My tasks2');
    await w.get('[data-testid="fold-mine"]').trigger('click');
    expect(w.text()).not.toContain('My tasks');
    expect(w.get('[data-testid="fold-mine"]').attributes('aria-expanded')).toBe('false');
    expect(JSON.parse(localStorage.getItem('agnt:one-sidebar:folded'))).toEqual({ mine: true, spaces: false });
    w.unmount();

    const again = sidebar();
    expect(again.text()).not.toContain('My tasks');
    expect(again.text()).toContain('Sales'); // Teamspaces did not fold with it
    await search(again).setValue('tasks');
    expect(again.text()).toContain('My tasks');
  });

  it('collapses from the button beside the switcher, as in Studio', async () => {
    const w = sidebar();
    const collapse = w.get('.drawer-head [data-testid="one-sidebar-collapse"]');
    expect(collapse.attributes('aria-label')).toBe('Collapse sidebar');
    expect(collapse.find('.fa-angle-double-left').exists()).toBe(true);
    await collapse.trigger('click');
    expect(w.emitted('collapse')).toHaveLength(1);
  });

  it('a personal workspace: no Mine section and no explainer note; the switcher says it is private', () => {
    const w = mountDrawer({ team: null, teams: [], spaces: [], counts: {} });
    expect(w.text()).not.toContain('My tasks');
    expect(w.find('[data-testid="fold-mine"]').exists()).toBe(false);
    expect(w.find('.d-note').exists()).toBe(false);
    expect(w.get('[data-testid="ot-switcher"]').text()).toContain('Only you');
  });
});
