/**
 * The spaces this desktop can switch between.
 *
 * `primary` is implicit: it is whatever electron/connectionConfig.js resolves
 * (this computer, or a remote personal instance) and is never stored here, so
 * the existing connection logic stays the single authority for it. Everything
 * else is a team space: a team's own cloud instance, opened in its own session
 * partition.
 *
 * Every entry originates in the renderer, so every entry is validated here. A
 * space's URL decides which origin receives the user's clicks, so only https
 * instance addresses are accepted (plaintext only for loopback development).
 */
import fs from 'fs';
import path from 'path';
import { normalizeRemoteUrl } from '../connectionConfig.js';

export const PRIMARY_SPACE_ID = 'primary';
const FILE = 'spaces.json';
const ID = /^[A-Za-z0-9_-]{1,100}$/;
const MAX_TEAMS = 50;

export function teamSpaceId(teamId) { return 'team:' + teamId; }

/**
 * May this origin be handed the personal session when the user switches to it?
 *
 * Only AGNT-hosted instances. A team view signs in against the same issuer
 * (api.agnt.gg) for the same user either way; handing the session over just
 * spares the second sign-in. Anything else, loopback included, signs in itself.
 */
export function isIdentityOrigin(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname.endsWith('.agnt.gg');
  } catch {
    return false;
  }
}

/** Returns a clean team space or null. Never throws on hostile input. */
export function validateTeam(input) {
  if (!input || typeof input !== 'object') return null;
  const { id, name, tenantUrl } = input;
  if (typeof id !== 'string' || !ID.test(id)) return null;
  if (typeof name !== 'string' || !name.trim() || name.length > 100) return null;
  const check = normalizeRemoteUrl(tenantUrl);
  if (!check.ok) return null;
  const url = new URL(check.url);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !loopback) return null;
  return { id: teamSpaceId(id), kind: 'team', teamId: id, label: name.trim(), url: url.origin };
}

export class SpaceRegistry {
  constructor(userDataDir, { fsImpl = fs } = {}) {
    this.file = path.join(userDataDir, FILE);
    this.fs = fsImpl;
    this.spaces = this.read();
  }

  read() {
    try {
      const parsed = JSON.parse(this.fs.readFileSync(this.file, 'utf8'));
      const spaces = Array.isArray(parsed?.spaces) ? parsed.spaces : [];
      // Re-validate on read: a hand-edited or older file cannot smuggle in an origin,
      // nor grant identity sharing to one that does not qualify for it.
      return spaces
        .map(s => {
          const space = validateTeam({ id: s.teamId, name: s.label, tenantUrl: s.url });
          return space && { ...space, sharesIdentity: s.sharesIdentity === true && isIdentityOrigin(space.url) };
        })
        .filter(Boolean)
        .slice(0, MAX_TEAMS);
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn('[spaces] ignoring unreadable ' + FILE + ':', error.message);
      return [];
    }
  }

  write() {
    const temporary = this.file + '.tmp';
    this.fs.writeFileSync(temporary, JSON.stringify({ version: 1, spaces: this.spaces }, null, 2));
    this.fs.renameSync(temporary, this.file);
  }

  list() { return this.spaces.map(space => ({ ...space })); }
  get(id) { return this.spaces.find(space => space.id === id) || null; }
  has(id) { return id === PRIMARY_SPACE_ID || Boolean(this.get(id)); }

  /**
   * Adds or updates teams. With `replace`, the given list is the complete set of
   * teams the user belongs to, and any team no longer in it is removed: losing
   * membership removes the space. Returns the ids that were removed.
   *
   * `trusted` says the list came from the personal window, whose team list is
   * the user's own account. Only such a list can mark a team as sharing the
   * personal session. A team view is a shared remote page: anything running in
   * it could otherwise register `https://<its-own>.t1.agnt.gg` as a team and be
   * handed the user's session on the next switch. So an untrusted list may keep
   * the flag on a team whose address it leaves unchanged, and never grant it.
   */
  syncTeams(teams, { replace = false, trusted = false } = {}) {
    if (!Array.isArray(teams)) return { changed: false, removed: [] };
    const previous = new Map(this.spaces.map(space => [space.id, space]));
    const incoming = teams.map(validateTeam).filter(Boolean).map(space => {
      const known = previous.get(space.id);
      const granted = trusted || (known?.sharesIdentity === true && known.url === space.url);
      return { ...space, sharesIdentity: granted && isIdentityOrigin(space.url) };
    });
    const before = JSON.stringify(this.spaces);
    const byId = new Map((replace ? [] : this.spaces).map(space => [space.id, space]));
    for (const space of incoming) byId.set(space.id, space);
    const next = [...byId.values()].slice(0, MAX_TEAMS);
    const removed = this.spaces.filter(space => !next.some(n => n.id === space.id)).map(space => space.id);
    this.spaces = next;
    const changed = JSON.stringify(this.spaces) !== before;
    if (changed) this.write();
    return { changed, removed };
  }
}
