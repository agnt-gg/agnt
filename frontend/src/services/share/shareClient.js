/**
 * Every share call the UI makes, routed to the right place for the space you
 * are in. Personal items are shared by the personal backend (/share). In a team
 * space the items belong to the team's project, so links and received copies
 * go through the team's own project routes, where the cloud checks your access.
 * Conversations are always your own, in either space.
 */
import { shareRequest, teamRequest } from '@/utils/teamClient.js';
import { currentTeamScope } from '@/composables/useSpaces.js';
import { isBundleKind } from './shareKinds.js';

const enc = encodeURIComponent;
const post = body => ({ method: 'POST', body: JSON.stringify(body) });
const itemRef = (kind, id) => kind + ':' + id;

const projects = new Map();
/** The team project this page is in: the one in the URL, or the team's default project. */
async function teamProject(scope) {
  if (scope.workspaceId) return scope.workspaceId;
  if (!projects.has(scope.teamId)) {
    const lookup = teamRequest('/' + enc(scope.teamId) + '/workspaces/default').then(project => project.id);
    lookup.catch(() => projects.delete(scope.teamId));
    projects.set(scope.teamId, lookup);
  }
  return projects.get(scope.teamId);
}
async function teamPath(scope, path) {
  return '/' + enc(scope.teamId) + '/workspaces/' + enc(await teamProject(scope)) + path;
}

export const inTeamSpace = () => Boolean(currentTeamScope());

/** What a link to this item would carry. Personal only: a team project's own items are previewed by the team. */
export async function previewItem({ kind, id, includeDependencies = true }) {
  if (!isBundleKind(kind) || currentTeamScope()) return null;
  return shareRequest('/preview', post({ items: [itemRef(kind, id)], includeDependencies }));
}

export async function createLink({ kind, id, includeDependencies = true }) {
  if (!isBundleKind(kind)) return shareRequest('/conversation-link', post({ outputId: id }));
  const scope = currentTeamScope();
  const body = { items: [itemRef(kind, id)], includeDependencies };
  if (scope) return teamRequest(await teamPath(scope, '/link'), post(body));
  return shareRequest('/link', post(body));
}

/** Live links for this item. Links made inside a team project are not tracked per person, so there are none to list. */
export async function listLinks({ kind, id }) {
  if (!isBundleKind(kind)) return shareRequest('/conversation-link?outputId=' + enc(id));
  if (currentTeamScope()) return [];
  return shareRequest('/link?items=' + enc(itemRef(kind, id)));
}

export const revokeLink = linkId => shareRequest('/link/' + enc(linkId), { method: 'DELETE' });

export async function previewReceived(link) {
  const scope = currentTeamScope();
  if (scope) return teamRequest(await teamPath(scope, '/receive/preview'), post({ link }));
  return shareRequest('/receive/preview', post({ link }));
}

export async function receive(link) {
  const scope = currentTeamScope();
  if (scope) return teamRequest(await teamPath(scope, '/receive'), post({ link }));
  return shareRequest('/receive', post({ link }));
}
