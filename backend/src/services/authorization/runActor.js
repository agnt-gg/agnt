import { currentScopeRequest } from './ScopeRequestContext.js';
import { currentToolActor, currentToolAuthorization } from '../security/toolRunAuthority.js';

/** A team workspace's storage principal (ScopeRepository.scopeOwnerId), not a person. */
export const isWorkspacePrincipal = (userId) => typeof userId === 'string' && userId.startsWith('scope:');

/**
 * WHO IS RUNNING THIS, as opposed to whose data it is.
 *
 * A teamspace's agents and workflows are stored under the workspace principal (scope:…), and its runs
 * use the workspace's connections (credentialUserId resolves the principal to the instance owner).
 * That principal is not a person, and judging a run by it judged every teammate's run as the OWNER's:
 * memberIsolation, HostedToolAuthority and the owner's team policy all waved it through. That is why
 * members could not run anything directly.
 *
 * The acting person is, in order: the explicit actor; the enclosing tool actor (a node or sub-workflow
 * inside a member's run); the verified scope request's actor (ScopeApiMiddleware). With none of these the
 * run is the owner's own background work and stays the workspace, as before. Only workspace principals
 * are resolved: a person's own runs act as that person, always.
 *
 * Use it for isolation, team policy and audit. Never for data or credentials: those stay on userId.
 */
export function runActorFor(userId, explicitActor = null) {
  if (typeof explicitActor === 'string' && explicitActor) return explicitActor;
  if (!isWorkspacePrincipal(userId)) return userId;
  const enclosing = currentToolActor();
  if (enclosing && enclosing !== userId) return enclosing;
  const request = currentScopeRequest();
  if (request?.actorId && request.resourceOwnerId === userId) return request.actorId;
  return userId;
}

/**
 * The authorization that proves the actor runActorFor chose: the caller's own when given, else the
 * enclosing tool run's (a member's run carries a run-scoped token for that member).
 */
export function runAuthorizationFor(authorization, actor, userId) {
  if (authorization) return authorization;
  return actor !== userId && actor === currentToolActor() ? currentToolAuthorization() : authorization;
}
