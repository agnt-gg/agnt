import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createStore } from 'vuex';

// The team API, recorded. Every page goes through teamRequest, so this is the whole server surface.
const calls = [];
let routes = {};
vi.mock('@/utils/teamClient.js', () => ({
  teamRequest: vi.fn(async (path, options = {}) => {
    const method = options.method || 'GET';
    calls.push({ path, method, body: options.body ? JSON.parse(options.body) : undefined });
    const handler = routes[method + ' ' + path] ?? routes[path];
    if (typeof handler === 'function') return handler(options.body ? JSON.parse(options.body) : undefined);
    if (handler instanceof Error) throw handler;
    return handler ?? {};
  }),
  roleLabel: (role) => role,
}));
vi.mock('@/composables/useRealtimeSync.js', () => ({ getRealtimeSocket: () => null }));
vi.mock('@/views/_components/team/TeamMembers.vue', () => ({ default: { template: '<div data-testid="members"></div>', props: ['team'] } }));
vi.mock('@/views/_components/team/team.css', () => ({}));
vi.mock('@/tt.config.js', () => ({ API_CONFIG: { BASE_URL: 'http://api' } }));

// Checkpoints (tasks in chat) are the person's own API, outside the team router.
let checkpointsWaiting = [];
global.fetch = vi.fn(async (url) => ({ ok: true, json: async () => (String(url).includes('/checkpoints') ? checkpointsWaiting : []) }));

const { default: OneTeamPage } = await import('./OneTeamPage.vue');
const { _resetTeamState } = await import('./useTeam.js');
const { _resetCheckpoints } = await import('@/composables/useCheckpoints.js');

const TEAM = { id: 'acme', name: 'Acme', role: 'member', tenantUrl: window.location.origin };
const MEMBERS = [{ user_id: 'me', name: 'Nathan W', email: 'n@acme.co' }, { user_id: 'jess', name: 'Jess Park', email: 'j@acme.co' }];
const SPACE = { id: 'sales', name: 'Sales', is_default: 1 };
const AGENT = { id: 'proposal', name: 'Proposal Agent', status: 'published' };

function baseRoutes() {
  return {
    '': [TEAM],
    '/acme/members': MEMBERS,
    '/acme/workspaces': [SPACE],
    '/acme/inbox': [],
    '/acme/workspaces/sales/people': { memberIds: ['me', 'jess'], agents: [AGENT] },
    '/acme/workspaces/sales/messages': [],
    '/acme/workspaces/sales/tasks': [],
    '/acme/workspaces/sales/docs': [],
  };
}

function mountPage(location) {
  const nav = { go: vi.fn(), ask: vi.fn(), toast: vi.fn(), confirm: vi.fn(async () => true), prompt: vi.fn(async () => null), openConversation: vi.fn(), chat: vi.fn(), openScreen: vi.fn() };
  const store = createStore({ state: { userAuth: { user: { id: 'me' } } } });
  const wrapper = mount(OneTeamPage, { props: { location }, global: { plugins: [store], provide: { focusedNav: nav } } });
  mounted.push(wrapper);
  return { wrapper, nav };
}
// The team state is shared app-wide by design; a page left mounted would keep reacting to the next test's data.
const mounted = [];
afterEach(() => { while (mounted.length) mounted.pop().unmount(); });
const loc = (over) => ({ view: 'home', space: null, tab: 'chat', task: null, doc: null, ...over });

beforeEach(() => {
  calls.length = 0;
  routes = baseRoutes();
  _resetTeamState();
  _resetCheckpoints();
  checkpointsWaiting = [];
  localStorage.setItem('token', 'header.' + btoa(JSON.stringify({ id: 'me' })) + '.sig');
});

describe('teamspace chat', () => {
  it('sends with the people and agents it names, resolved to ids', async () => {
    routes['POST /acme/workspaces/sales/messages'] = { id: 'm1' };
    const { wrapper } = mountPage(loc({ view: 'space', space: 'sales', tab: 'chat' }));
    await flushPromises();
    await wrapper.find('textarea[aria-label="Message"]').setValue('@Proposal Agent draft it, @Jess FYI');
    await wrapper.find('form.composer').trigger('submit');
    await flushPromises();
    const sent = calls.find((c) => c.method === 'POST' && c.path.endsWith('/messages'));
    expect(sent.body).toEqual({ body: '@Proposal Agent draft it, @Jess FYI', mentions: [{ kind: 'agent', id: 'proposal' }, { kind: 'person', id: 'jess' }] });
  });

  it('renders message text as text, never HTML', async () => {
    routes['/acme/workspaces/sales/messages'] = [{ id: 'm1', author: { kind: 'person', id: 'jess' }, body: '<img src=x onerror=alert(1)> hi @Jess', mentions: [], createdAt: new Date().toISOString() }];
    const { wrapper } = mountPage(loc({ view: 'space', space: 'sales', tab: 'chat' }));
    await flushPromises();
    expect(wrapper.find('.msg-text img').exists()).toBe(false);
    expect(wrapper.find('.msg-text').text()).toContain('<img src=x onerror=alert(1)>');
    expect(wrapper.find('.mention').text()).toBe('@Jess');
  });
});

describe('Home is the inbox', () => {
  it('a task waiting for your OK leads Needs you, and Review opens the chat it is in', async () => {
    checkpointsWaiting = [{ id: 'cp1', conversationId: 'conv', outputId: 'out-1', kind: 'plan', title: 'The plan · 3 steps', content: '…', taskTitle: 'Send the January price notice', state: 'pending', createdAt: new Date().toISOString() }];
    const { wrapper, nav } = mountPage(loc({ view: 'home' }));
    await flushPromises();
    const panel = wrapper.find('[data-testid="home-inbox"]');
    expect(panel.find('.tab.is-active').text()).toMatch(/^Needs you/);
    expect(panel.text()).toContain('Waiting for your OK');
    expect(panel.text()).toContain('Send the January price notice');
    expect(panel.text()).not.toMatch(/\bApprove\b/); // Review, never Approve: the whole card is in the chat
    await panel.findAll('button').find((b) => b.text() === 'Review').trigger('click');
    expect(nav.openConversation).toHaveBeenCalledWith('out-1');
  });

  it('an old inbox link opens Home', async () => {
    const { wrapper } = mountPage(loc({ view: 'inbox' }));
    await flushPromises();
    expect(wrapper.find('[data-testid="home-inbox"]').exists()).toBe(true);
    expect(wrapper.find('.greet').exists()).toBe(true);
  });

  it('opening a row marks it read and goes to the card', async () => {
    routes['/acme/inbox'] = [{ id: 'i1', kind: 'assigned', actor: { kind: 'person', id: 'jess' }, summary: 'Call Northwind', workspaceId: 'sales', target: { kind: 'task', id: 't1' }, read: false, createdAt: new Date().toISOString() }];
    routes['POST /acme/inbox/i1/read'] = { success: true };
    const { wrapper, nav } = mountPage(loc({ view: 'inbox' }));
    await flushPromises();
    await wrapper.find('.r.clickable').trigger('click');
    await flushPromises();
    expect(calls.some((c) => c.method === 'POST' && c.path === '/acme/inbox/i1/read')).toBe(true);
    expect(nav.go).toHaveBeenLastCalledWith({ page: 'team', view: 'space', space: 'sales', tab: 'board', task: 't1' });
    expect(wrapper.find('.unread').exists()).toBe(false);
  });
});

describe('card panel', () => {
  it('approves a waiting agent result', async () => {
    const task = { id: 't1', title: 'Draft proposal', status: 'review', agentState: 'waiting', result: 'The draft', assignee: { kind: 'agent', id: 'proposal' }, due: '', createdBy: 'me', revision: 3, comments: [] };
    routes['/acme/workspaces/sales/tasks/t1'] = task;
    routes['POST /acme/workspaces/sales/tasks/t1/approve'] = { task: { ...task, status: 'done', agentState: null }, doc: null };
    const { wrapper } = mountPage(loc({ view: 'space', space: 'sales', tab: 'board', task: 't1' }));
    await flushPromises();
    expect(wrapper.find('.tc-docprev').text()).toBe('The draft');
    await wrapper.findAll('.approve-box button').find((b) => b.text() === 'Approve').trigger('click');
    await flushPromises();
    expect(calls.find((c) => c.path.endsWith('/approve')).body).toEqual({ saveAsDoc: false });
  });
});

describe('board', () => {
  it('a drop sends the move with its revision, and reverts when a teammate got there first', async () => {
    routes['/acme/workspaces/sales/tasks'] = [{ id: 't1', title: 'Card', status: 'todo', assignee: null, revision: 2, due: '' }];
    routes['PATCH /acme/workspaces/sales/tasks/t1'] = Object.assign(new Error('changed'), { code: 'revision_conflict', status: 409 });
    const { wrapper, nav } = mountPage(loc({ view: 'space', space: 'sales', tab: 'board' }));
    await flushPromises();
    await wrapper.find('.tcard').trigger('dragstart');
    await wrapper.findAll('.col')[2].trigger('drop');
    await flushPromises();
    expect(calls.find((c) => c.method === 'PATCH').body).toEqual({ status: 'review', expectedRevision: 2 });
    expect(nav.toast).toHaveBeenCalledWith(expect.stringMatching(/teammate just changed/));
    expect(wrapper.findAll('.col')[0].find('.tcard').exists()).toBe(true);
  });
});

describe('home', () => {
  it('without a team, offers your teams instead of empty team widgets', async () => {
    routes[''] = [{ id: 'other', name: 'Globex', role: 'member', tenantUrl: 'https://globex.t1.agnt.gg' }];
    const { wrapper } = mountPage(loc({ view: 'home' }));
    await flushPromises();
    expect(wrapper.text()).toContain('This is your personal space');
    expect(wrapper.text()).toContain('Globex');
    expect(calls.some((c) => c.path.includes('/inbox'))).toBe(false);
  });
});
