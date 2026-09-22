import { computed, onBeforeUnmount, ref } from 'vue';

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

/** The team scope this page was opened with, if any. Mirrors teamScopeTransport. */
export function currentTeamScope(host = typeof window !== 'undefined' ? window : null) {
  if (!host) return null;
  const params = new URLSearchParams(host.location.search);
  const teamId = params.get('team');
  if (teamId) return { teamId, workspaceId: params.get('workspace') || null };
  try { return JSON.parse(host.sessionStorage.getItem('agnt.teamScope') || 'null'); } catch { return null; }
}

function teamUrl(team, projectId) {
  const url = new URL(team.tenantUrl);
  url.searchParams.set('team', team.id);
  if (projectId) url.searchParams.set('workspace', projectId);
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
  window.location.assign(teamUrl(team, projectId));
  return true;
}

export async function openPersonal() {
  const host = bridge();
  if (host) { await host.switch('primary'); return true; }
  const url = new URL(window.location.href);
  if (!url.searchParams.has('team') && !currentTeamScope()) return true;
  url.searchParams.delete('team'); url.searchParams.delete('workspace');
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
