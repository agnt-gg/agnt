import { reactive, computed, readonly } from 'vue';
import { teamRequest } from '@/utils/teamClient.js';
import { API_CONFIG } from '@/tt.config.js';
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
    // Someone was added to or removed from a teamspace: the drawer's list of spaces may have changed.
    if (signal.kind === 'people') loadSpaces().catch((error) => console.warn('[team] spaces:', error.message));
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
  /** Replies being written right now (Annie streaming), as full chat messages. */
  liveMessages: (ws) => teamRequest(space(ws, '/messages/live')),
  postMessage: (ws, body, mentions, spaceName) => teamRequest(space(ws, '/messages'), json('POST', { body, mentions, spaceName })),
  deleteMessage: (ws, id) => teamRequest(space(ws, '/messages/' + encodeURIComponent(id)), { method: 'DELETE' }),
  /** The teamspace board, or with { private: true } the caller's own My Space cards in that workspace. */
  tasks: (ws, { private: own = false } = {}) => teamRequest(space(ws, own ? '/tasks?private=1' : '/tasks')),
  task: (ws, id) => teamRequest(space(ws, '/tasks/' + encodeURIComponent(id))),
  createTask: (ws, input) => teamRequest(space(ws, '/tasks'), json('POST', input)),
  updateTask: (ws, id, input) => teamRequest(space(ws, '/tasks/' + encodeURIComponent(id)), json('PATCH', input)),
  deleteTask: (ws, id) => teamRequest(space(ws, '/tasks/' + encodeURIComponent(id)), { method: 'DELETE' }),
  /** "Visible to": another teamspace (`to`), or private to you (`private`, in your home teamspace). */
  moveTask: (ws, id, { to, private: isPrivate = false, expectedRevision }) => teamRequest(space(ws, '/tasks/' + encodeURIComponent(id) + '/move'), json('POST', { to, private: isPrivate, expectedRevision })),
  comment: (ws, id, body, mentions) => teamRequest(space(ws, '/tasks/' + encodeURIComponent(id) + '/comments'), json('POST', { body, mentions })),
  approve: (ws, id, input = {}) => teamRequest(space(ws, '/tasks/' + encodeURIComponent(id) + '/approve'), json('POST', input)),
  sendBack: (ws, id, note) => teamRequest(space(ws, '/tasks/' + encodeURIComponent(id) + '/send-back'), json('POST', { note })),
  docs: (ws) => teamRequest(space(ws, '/docs')),
  doc: (ws, id) => teamRequest(space(ws, '/docs/' + encodeURIComponent(id))),
  createDoc: (ws, name, content = '') => teamRequest(space(ws, '/docs'), json('POST', { name, content })),
  saveDoc: (ws, id, input) => teamRequest(space(ws, '/docs/' + encodeURIComponent(id)), json('PUT', input)),
  deleteDoc: (ws, id) => teamRequest(space(ws, '/docs/' + encodeURIComponent(id)), { method: 'DELETE' }),
  people: (ws) => teamRequest(space(ws, '/people')),
  /** Who is in a teamspace: { access: 'team'|'invited', isDefault, memberIds }. */
  spaceMembers: (ws) => teamRequest(space(ws, '/members')),
  setSpaceMember: (ws, userId, member) => teamRequest(space(ws, '/members/' + encodeURIComponent(userId)), member ? json('PUT', {}) : { method: 'DELETE' }),
  native: (ws) => teamRequest(space(ws, '/native')),
  publish: (ws, kind, id) => teamRequest(space(ws, '/native/' + kind + '/' + encodeURIComponent(id) + '/publish'), json('POST', {})),
  /** "Visible to" for a team agent or routine: it moves to teamspace `to` (owners and admins). */
  moveNative: (ws, kind, id, to) => teamRequest(space(ws, '/native/' + kind + '/' + encodeURIComponent(id) + '/move'), json('POST', { to })),
  createSpace: (name) => teamRequest(path('/workspaces'), json('POST', { name })),
  markRead: (id) => teamRequest(path('/inbox/' + encodeURIComponent(id) + '/read'), json('POST', {})),
  markAllRead: () => teamRequest(path('/inbox/read-all'), json('POST', {})),
};

/**
 * A teamspace's Files, on this instance's workspace-files service (the cloud
 * authorises every call per teamspace: files.read / files.write).
 */
async function filesFetch(teamId, workspaceId, suffix, init = {}) {
  const response = await fetch(`${API_CONFIG.BASE_URL}/workspace-files/${encodeURIComponent(teamId)}/${encodeURIComponent(workspaceId)}${suffix}`, {
    ...init, headers: { Authorization: 'Bearer ' + (localStorage.getItem('token') || ''), ...(init.headers || {}) },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw Object.assign(new Error(body.error || 'Files are unavailable right now'), { status: response.status });
  }
  return response;
}
export const teamFiles = {
  list: async (teamId, ws) => (await filesFetch(teamId, ws, '/files')).json(),
  upload: (teamId, ws, name, blob) => filesFetch(teamId, ws, '/content?path=' + encodeURIComponent(name), { method: 'PUT', body: blob, headers: { 'Content-Type': 'application/octet-stream' } }),
  download: async (teamId, ws, name) => (await filesFetch(teamId, ws, '/content?path=' + encodeURIComponent(name))).blob(),
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
