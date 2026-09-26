import { computed, onBeforeUnmount, ref } from 'vue';
import { tenantRequest } from '@/utils/teamClient.js';
import { instanceTeam } from '@/utils/teamScopeTransport.js';
import { API_CONFIG } from '@/tt.config.js';

const HOME_KEY = 'agnt.homeOrigin';
const isLoopback = hostname => ['localhost', '127.0.0.1', '[::1]'].includes(hostname);

/**
 * Spaces: Personal and each team, each its own isolated connection.
 *
 * In the desktop app every space is a separate session partition held by the
 * main process, so switching is instant and nothing (tokens, storage, sockets)
 * crosses between them. In a plain browser there is no such host, so switching
 * to a team is an ordinary navigation to that team's instance.
 */
const bridge = () => (typeof window !== 'undefined' ? window.electron?.spaces : null);
export const hasSpaceHost = () => Boolean(bridge());
export const teamSpaceId = teamId => 'team:' + teamId;

/** The team scope this page runs in, if any. Mirrors teamScopeTransport.resolveTeamScope. */
export function currentTeamScope(host = typeof window !== 'undefined' ? window : null) {
  if (!host) return null;
  const params = new URLSearchParams(host.location.search);
  const teamId = params.get('team');
  const own = instanceTeam(host);
  if (own && (!teamId || teamId === own.teamId)) return { teamId: own.teamId, workspaceId: params.get('workspace') || null };
  if (teamId) return { teamId, workspaceId: params.get('workspace') || null };
  try { return JSON.parse(host.sessionStorage.getItem('agnt.teamScope') || 'null'); } catch { return null; }
}

/** Is this page a team's own instance? Then it has no personal mode at all. */
export const onTeamInstance = (host = window) => Boolean(instanceTeam(host));

const SIGN_IN_CODE = /^[A-Za-z0-9_-]{43}$/;

/**
 * The address to open another cloud instance at, carrying a one-time sign-in
 * code for it after `#`, so it opens as the same user.
 *
 * Without it the other instance opened as whoever last signed in THERE, since a
 * browser keeps a separate sign-in per site (measured: a different account).
 * The code is minted by api.agnt.gg for that one instance, works once, for a
 * minute; the fragment never reaches any server's logs. Every failure falls
 * back to the plain address: the worst case is being asked to sign in.
 */
export async function signedInUrl(target, host = window) {
  const url = new URL(target);
  try {
    if (url.origin === host.location.origin || url.protocol !== 'https:' || !url.hostname.endsWith('.agnt.gg')) return url.href;
    const token = host.localStorage.getItem('token');
    if (!token) return url.href;
    const slug = url.hostname.split('.')[0];
    const response = await host.fetch(API_CONFIG.REMOTE_URL + '/tenants/' + encodeURIComponent(slug) + '/signin-code', { method: 'POST', headers: { Authorization: 'Bearer ' + token } });
    if (!response.ok) return url.href;
    const { code } = await response.json();
    if (SIGN_IN_CODE.test(code || '')) url.hash = 'agnt-signin=' + code;
  } catch (error) {
    console.warn('[spaces] could not carry your sign-in over:', error.message);
  }
  return url.href;
}

/**
 * Is `candidate` somewhere "Personal" may send this tab? Returns its origin or null.
 *
 * Only a SIBLING instance on this page's own fleet domain (goku.t1.agnt.gg from
 * bravo.t1.agnt.gg), over https, and never this page itself. The value arrives in
 * a URL anyone can craft, so it must not be able to send the user anywhere else.
 */
export function acceptableHome(candidate, host = window) {
  try {
    const here = new URL(host.location.href);
    const home = new URL(candidate);
    if (home.origin === here.origin) return null;
    if (isLoopback(here.hostname)) return isLoopback(home.hostname) ? home.origin : null;
    if (home.protocol !== 'https:') return null;
    const labels = here.hostname.split('.');
    const parent = labels.slice(1).join('.');
    if (labels.length < 3) return null; // no fleet domain to be a sibling on
    const sibling = home.hostname.endsWith('.' + parent) && home.hostname.split('.').length === labels.length;
    return sibling ? home.origin : null;
  } catch {
    return null;
  }
}

/** The instance this tab came from, if it is known and acceptable. */
export function homeOrigin(host = window) {
  try { return acceptableHome(host.sessionStorage.getItem(HOME_KEY), host); } catch { return null; }
}

/**
 * The instance this account owns, when the tab was opened straight onto a team
 * (a bookmark, a typed address) and so never recorded where it came from.
 * Only an unambiguous answer counts.
 */
async function ownedInstance(host = window) {
  try {
    const { tenants = [] } = await tenantRequest('');
    const owned = tenants
      .filter(t => t.isOwner && t.status === 'active' && t.url)
      .map(t => acceptableHome(t.url, host))
      .filter(Boolean);
    return owned.length === 1 ? owned[0] : null;
  } catch (error) {
    console.warn('[spaces] could not look up your instance:', error.message);
    return null;
  }
}

function teamUrl(team, projectId) {
  const url = new URL(team.tenantUrl);
  url.searchParams.set('team', team.id);
  if (projectId) url.searchParams.set('workspace', projectId);
  // Leaving Personal: this page is home. Team to team: keep the home already known.
  const home = currentTeamScope() ? homeOrigin() : window.location.origin;
  if (home && home !== url.origin) url.searchParams.set('home', home);
  return url.href;
}

/** Open a team (optionally a specific project). Returns false when nothing could be opened. */
export async function openTeam(team, projectId = null) {
  if (!team?.tenantUrl) return false;
  const host = bridge();
  if (host) {
    await host.syncTeams([{ id: team.id, name: team.name, tenantUrl: team.tenantUrl }]);
    const result = await host.switch(teamSpaceId(team.id), { projectId });
    return result?.ok !== false;
  }
  window.location.assign(await signedInUrl(teamUrl(team, projectId)));
  return true;
}

/**
 * Go to Personal.
 *
 * In a browser, Personal is the user's OWN instance, not this one with the team
 * scope taken off. Stripping `?team` and staying put used to be all this did, so
 * "Personal" from a team kept the user on the team's instance: what they made
 * there was saved on the team's server and listed in its team view, and never
 * reached the instance they thought they were on.
 *
 * Returns false when there is no personal space to go to: on a team's own
 * instance there is no personal mode, so without a home of your own (your
 * personal cloud, or the desktop app) Personal is somewhere else entirely.
 */
export async function openPersonal() {
  const host = bridge();
  if (host) { await host.switch('primary'); return true; }
  const inTeam = Boolean(new URL(window.location.href).searchParams.has('team') || currentTeamScope());
  const home = homeOrigin() || (inTeam ? await ownedInstance() : null);
  if (home) {
    window.sessionStorage.removeItem('agnt.teamScope');
    window.sessionStorage.removeItem(HOME_KEY);
    window.location.assign(await signedInUrl(home + '/'));
    return true;
  }
  if (!inTeam) return true;
  if (onTeamInstance()) return false;
  // No instance of your own to go to: Personal is your own space on this one.
  const url = new URL(window.location.href);
  url.searchParams.delete('team'); url.searchParams.delete('workspace'); url.searchParams.delete('home');
  window.sessionStorage.removeItem('agnt.teamScope');
  window.location.assign(url.href);
  return true;
}

/** Reactive space list and active id. Teams come from /teams; the host adds its own Personal entries. */
export function useSpaces() {
  const spaces = ref([]);
  const activeId = ref(currentTeamScope() ? teamSpaceId(currentTeamScope().teamId) : 'primary');
  const host = bridge();
  let unsubscribe = null;
  async function refresh() {
    if (!host) return;
    const state = await host.list();
    spaces.value = state.spaces || [];
    activeId.value = state.selfId || state.activeId || activeId.value;
  }
  async function syncTeams(teams) {
    if (host) {
      await host.syncTeams(teams.filter(t => t.tenantUrl).map(t => ({ id: t.id, name: t.name, tenantUrl: t.tenantUrl })));
      await refresh();
      return;
    }
    spaces.value = [{ id: 'primary', kind: 'personal', label: 'Personal' }, ...teams.map(t => ({ id: teamSpaceId(t.id), kind: 'team', label: t.name, teamId: t.id, tenantUrl: t.tenantUrl }))];
  }
  if (host) {
    unsubscribe = host.onChanged(state => { spaces.value = state.spaces || spaces.value; });
    refresh().catch(error => console.warn('[spaces]', error.message));
  }
  onBeforeUnmount(() => unsubscribe?.());
  const active = computed(() => spaces.value.find(space => space.id === activeId.value) || null);
  return { spaces, activeId, active, refresh, syncTeams, hasHost: Boolean(host) };
}
