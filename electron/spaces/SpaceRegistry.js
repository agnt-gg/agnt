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
      // Re-validate on read: a hand-edited or older file cannot smuggle in an origin.
      return spaces.map(s => validateTeam({ id: s.teamId, name: s.label, tenantUrl: s.url })).filter(Boolean).slice(0, MAX_TEAMS);
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
   */
  syncTeams(teams, { replace = false } = {}) {
    if (!Array.isArray(teams)) return { changed: false, removed: [] };
    const incoming = teams.map(validateTeam).filter(Boolean);
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
