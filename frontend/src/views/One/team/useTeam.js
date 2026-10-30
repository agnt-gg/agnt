import { reactive, computed, readonly } from 'vue';
import { teamRequest } from '@/utils/teamClient.js';
import { instanceTeam, rememberInstanceTeam } from '@/utils/teamScopeTransport.js';
import { currentTeamScope } from '@/composables/useSpaces.js';
import { getRealtimeSocket } from '@/composables/useRealtimeSync.js';
import { toPeople, unreadCount } from './teamModel.js';

/**
 * THE TEAM THIS PAGE IS IN, shared by the rail badge, the spaces drawer and
 * every team page, so they can never disagree.
 *
 * A team is its own cloud instance: the page is in a team when it is served by
 * that team's instance (or opened with ?team=). The server is the authority on
 * every read and write; this only remembers what it said.
 *
 * Fresh data arrives two ways: a realtime "this changed" signal from the
 * server (team:space / team:inbox), and a slow poll as the safety net for a
 * missed socket event. Pages register what they are showing with `watch()`.
 */

const POLL_MS = 30_000;

const state = reactive({
  loaded: false,
  loading: false,
  error: '',
  team: null,
  teams: [],
  me: null,
  members: [],
  spaces: [],
  inbox: [],
  version: 0, // bumped on every realtime signal; pages refetch what they show
  lastSignal: null,
});

function currentUserId(store) {
  const user = store?.state?.userAuth?.user;
  if (user?.id || user?.userId) return String(user.id || user.userId);
  try {
    const payload = JSON.parse(atob((localStorage.getItem('token') || '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload?.id || payload?.userId || null;
  } catch {
    return null;
  }
}

/** Which of my teams this page belongs to: the instance's own team, else the scope it was opened with. */
export function pickTeam(teams, { origin = window.location.origin, scope = currentTeamScope(), own = instanceTeam() } = {}) {
  const byOrigin = teams.find((t) => { try { return t.tenantUrl && new URL(t.tenantUrl).origin === origin; } catch { return false; } });
  return byOrigin || teams.find((t) => t.id === own?.teamId) || teams.find((t) => t.id === scope?.teamId) || null;
}

let socketBound = null;
let pollTimer = null;

function bindRealtime() {
  const socket = getRealtimeSocket();
  if (!socket || socketBound === socket) return;
  socketBound = socket;
  socket.on('team:space', (signal) => {
    if (signal?.teamId !== state.team?.id) return;
    state.lastSignal = signal;
    state.version++;
  });
  socket.on('team:inbox', (signal) => {
    if (signal?.teamId !== state.team?.id) return;
    loadInbox();
  });
}

async function loadInbox() {
  if (!state.team) return;
  try {
    state.inbox = await teamRequest('/' + state.team.id + '/inbox');
  } catch (error) {
    console.warn('[team] inbox:', error.message);
  }
}

async function loadSpaces() {
  if (!state.team) return;
  state.spaces = await teamRequest('/' + state.team.id + '/workspaces');
}

async function load(store, { force = false } = {}) {
  if (state.loading || (state.loaded && !force)) return;
  state.loading = true;
  state.error = '';
  try {
    state.me = currentUserId(store);
    const teams = await teamRequest('');
    state.teams = Array.isArray(teams) ? teams : [];
    state.team = pickTeam(state.teams);
    if (state.team && state.team.tenantUrl) {
      try { if (new URL(state.team.tenantUrl).origin === window.location.origin) rememberInstanceTeam(state.team); } catch { /* malformed url: label only */ }
    }
    if (state.team) {
      const [members] = await Promise.all([
        teamRequest('/' + state.team.id + '/members').catch((error) => { console.warn('[team] members:', error.message); return []; }),
        loadSpaces().catch((error) => { state.error = error.message; }),
        loadInbox(),
      ]);
      state.members = toPeople(members, state.me);
    }
    state.loaded = true;
  } catch (error) {
    state.error = error.message;
    console.warn('[team] load:', error.message);
  } finally {
    state.loading = false;
  }
  bindRealtime();
  if (!pollTimer) {
    pollTimer = setInterval(() => {
      if (document.visibilityState !== 'visible' || !state.team) return;
      bindRealtime();
      loadInbox();
      state.version++;
    }, POLL_MS);
  }
}

/** Path helper: every call for this team goes through the team router on this instance. */
const path = (suffix) => '/' + encodeURIComponent(state.team.id) + suffix;
const space = (workspaceId, suffix = '') => path('/workspaces/' + encodeURIComponent(workspaceId) + suffix);
const json = (method, body) => ({ method, body: JSON.stringify(body ?? {}) });

export const teamApi = {
  messages: (ws) => teamRequest(space(ws, '/messages')),
  postMessage: (ws, body, mentions) => teamRequest(space(ws, '/messages'), json('POST', { body, mentions })),
  deleteMessage: (ws, id) => teamRequest(space(ws, '/messages/' + encodeURIComponent(id)), { method: 'DELETE' }),
  tasks: (ws) => teamRequest(space(ws, '/tasks')),
  task: (ws, id) => teamRequest(space(ws, '/tasks/' + encodeURIComponent(id))),
  createTask: (ws, input) => teamRequest(space(ws, '/tasks'), json('POST', input)),
  updateTask: (ws, id, input) => teamRequest(space(ws, '/tasks/' + encodeURIComponent(id)), json('PATCH', input)),
  deleteTask: (ws, id) => teamRequest(space(ws, '/tasks/' + encodeURIComponent(id)), { method: 'DELETE' }),
  comment: (ws, id, body, mentions) => teamRequest(space(ws, '/tasks/' + encodeURIComponent(id) + '/comments'), json('POST', { body, mentions })),
  approve: (ws, id, input = {}) => teamRequest(space(ws, '/tasks/' + encodeURIComponent(id) + '/approve'), json('POST', input)),
  sendBack: (ws, id, note) => teamRequest(space(ws, '/tasks/' + encodeURIComponent(id) + '/send-back'), json('POST', { note })),
  docs: (ws) => teamRequest(space(ws, '/docs')),
  doc: (ws, id) => teamRequest(space(ws, '/docs/' + encodeURIComponent(id))),
  createDoc: (ws, name, content = '') => teamRequest(space(ws, '/docs'), json('POST', { name, content })),
  saveDoc: (ws, id, input) => teamRequest(space(ws, '/docs/' + encodeURIComponent(id)), json('PUT', input)),
  deleteDoc: (ws, id) => teamRequest(space(ws, '/docs/' + encodeURIComponent(id)), { method: 'DELETE' }),
  people: (ws) => teamRequest(space(ws, '/people')),
  native: (ws) => teamRequest(space(ws, '/native')),
  publish: (ws, kind, id) => teamRequest(space(ws, '/native/' + kind + '/' + encodeURIComponent(id) + '/publish'), json('POST', {})),
  createSpace: (name) => teamRequest(path('/workspaces'), json('POST', { name })),
  markRead: (id) => teamRequest(path('/inbox/' + encodeURIComponent(id) + '/read'), json('POST', {})),
  markAllRead: () => teamRequest(path('/inbox/read-all'), json('POST', {})),
};

export function useTeam(store) {
  load(store);
  return {
    state: readonly(state),
    unread: computed(() => unreadCount(state.inbox)),
    reload: () => load(store, { force: true }),
    loadInbox,
    loadSpaces,
    /** Optimistic local inbox update after marking read; the server stays the authority. */
    markLocalRead(ids) { for (const item of state.inbox) if (!ids || ids.includes(item.id)) item.read = true; },
  };
}

/** For tests: reset the shared state. */
export function _resetTeamState() {
  Object.assign(state, { loaded: false, loading: false, error: '', team: null, teams: [], me: null, members: [], spaces: [], inbox: [], version: 0, lastSignal: null });
  socketBound = null;
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}
