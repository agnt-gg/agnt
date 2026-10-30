import { broadcastToUser } from '../utils/realtimeSync.js';

/**
 * Teammates see teamspace changes live.
 *
 * Every member's socket is already in its own verified `user:<id>` room (the
 * socket identity comes from the bearer token, never the client's claim), so a
 * change is delivered by sending a small "this changed" signal to each member;
 * the client refetches through the normal authorized routes. The signal carries
 * ids only, never message or card content, so a stale membership list can at
 * worst tell a removed member that something changed, not what.
 *
 * The member list comes from the cloud (the authority), cached briefly per team.
 */
const TTL_MS = 60_000;

export function createTeamSpaceRealtime({ cloud, send = broadcastToUser, now = Date.now } = {}) {
  const cache = new Map();

  async function members(teamId, authorization) {
    const hit = cache.get(teamId);
    if (hit && hit.until > now()) return hit.ids;
    const list = await cloud.request(authorization, '/' + encodeURIComponent(teamId) + '/members');
    const ids = Array.isArray(list) ? list.map((m) => m?.user_id || m?.userId).filter((id) => typeof id === 'string') : [];
    cache.set(teamId, { ids, until: now() + TTL_MS });
    return ids;
  }

  return {
    members,
    /** Tell every member a teamspace changed. Best effort: delivery never fails the write. */
    async space(teamId, authorization, signal) {
      try {
        for (const id of await members(teamId, authorization)) send(id, 'team:space', { teamId, ...signal });
      } catch (error) {
        console.warn('[Teamspaces] realtime fan-out skipped:', error.message);
      }
    },
    /** Tell specific people their inbox changed. */
    inbox(teamId, userIds) {
      for (const id of new Set(userIds)) if (id) send(id, 'team:inbox', { teamId });
    },
  };
}
