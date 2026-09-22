/**
 * Roles are what people choose; capabilities are what the cloud enforces.
 *
 * The cloud stores per-project capability grants and checks them on every
 * request. People should never have to reason about those eight strings, so a
 * role maps to a baseline set, and the rare exception is recorded as an
 * explicit per-project override that survives later role changes.
 */
export const CAPABILITIES = Object.freeze(['resources.read', 'resources.write', 'files.read', 'files.write', 'runs.execute', 'runs.read', 'connections.use', 'access.manage']);

export const ROLE_CAPABILITIES = Object.freeze({
  owner: Object.freeze([...CAPABILITIES]),
  admin: Object.freeze([...CAPABILITIES]),
  member: Object.freeze(CAPABILITIES.filter(capability => capability !== 'access.manage')),
  viewer: Object.freeze(['resources.read', 'files.read', 'runs.read']),
});

/** Role baseline, then overrides: granted adds, revoked removes. Unknown roles get nothing. */
export function effectiveCapabilities(role, overrides = []) {
  const result = new Set(ROLE_CAPABILITIES[role] || []);
  for (const { capability, granted } of overrides) {
    if (!CAPABILITIES.includes(capability)) continue;
    if (granted) result.add(capability); else result.delete(capability);
  }
  // The owner can never lock themselves out of their own project.
  if (role === 'owner') for (const capability of CAPABILITIES) result.add(capability);
  return result;
}

const path = (teamId, tenantSlug, workspaceId) => '/' + encodeURIComponent(teamId) + '/instances/' + encodeURIComponent(tenantSlug) + '/workspaces/' + encodeURIComponent(workspaceId);

/**
 * Reconciles the cloud's grants with roles + overrides. Grant and revoke are
 * idempotent on the cloud, so the full target set is written rather than diffed
 * against a read that could already be stale.
 */
export async function syncProjectAccess({ cloud, authorization, team, workspaceIds, members, overridesFor }) {
  const failures = [];
  for (const workspaceId of workspaceIds) {
    const base = path(team.id, team.tenantSlug, workspaceId);
    for (const member of members) {
      const userId = member.user_id || member.userId;
      if (!userId) continue;
      const target = effectiveCapabilities(member.role, await overridesFor(workspaceId, userId));
      for (const capability of CAPABILITIES) {
        try {
          await cloud.request(authorization, base + '/members/' + encodeURIComponent(userId) + '/capabilities/' + capability, { method: target.has(capability) ? 'PUT' : 'DELETE', body: '{}' });
        } catch (error) {
          // Keep going: one member without a seat must not block everyone else.
          failures.push({ workspaceId, userId, capability, error: error.message });
        }
      }
    }
  }
  return { synced: workspaceIds.length * members.length, failures };
}
