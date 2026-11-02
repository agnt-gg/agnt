/**
 * teamFolders — the teamspace Files a person's tools may use, mounted into their hosted tool sandbox.
 *
 * A teamspace's Files live in /app/data/workspace-files/<sha256(teamId, tenant, workspaceId)> (the
 * same folder WorkspaceFileService serves to the Files tab). On a hosted instance each one the caller
 * may use is bind-mounted into their sandbox at <their folder>/Teamspaces/<teamspace name>, read-only or
 * read-write. Nothing else from the instance enters: the database, secrets and credential store stay out
 * exactly as before (scripts/agnt-tool-run.py validates every mount it is handed).
 *
 * Who may use which (from the teams database, the authority teamspace chat, tasks and docs use):
 *   - a teamspace with access 'team' is everyone's on the team; 'invited' is its members' (and the
 *     team's owner and admins);
 *   - owner/admin/member may write; a viewer reads;
 *   - the team owner's "Team files with AI" setting caps it: off (no team folders), read, or write.
 *
 * Mounts are fixed when a sandbox starts, so they are worked out asynchronously before each tool call
 * (nopeService.checkAction) and read synchronously when the sandbox is planned (toolProcess.sandboxPlan).
 */
import { createHash } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';

export const TEAM_FILES_ROOT = '/app/data/workspace-files';
export const TEAM_FOLDER_DIR = 'Teamspaces';
export const AI_FILE_MODES = Object.freeze(['off', 'read', 'write']);
export const DEFAULT_AI_FILE_MODE = 'write';
const WRITERS = new Set(['owner', 'admin', 'member']);
const MANAGERS = new Set(['owner', 'admin']);
const CACHE_MS = 30_000;

/** The storage folder of one teamspace's Files (WorkspaceFileService's key, byte for byte). */
export function teamFolderSource(teamId, tenantSlug, workspaceId, root = TEAM_FILES_ROOT) {
  const key = createHash('sha256').update(JSON.stringify([teamId, tenantSlug, workspaceId])).digest('hex');
  return path.posix.join(root, key);
}

/** A folder name from a teamspace name: letters, digits, space, dot, dash, underscore; never empty or dotted. */
export function folderName(name, fallback) {
  const clean = String(name || '').replace(/[^A-Za-z0-9 ._-]/g, '').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').slice(0, 60);
  return clean || fallback;
}

export async function ensureAiFilePolicyTable(repo) {
  await repo.run('CREATE TABLE IF NOT EXISTS team_ai_file_policy(team_id TEXT PRIMARY KEY, mode TEXT NOT NULL, updated_by TEXT, updated_at TEXT)');
}
export async function aiFileMode(repo, teamId) {
  await ensureAiFilePolicyTable(repo);
  const row = await repo.get('SELECT mode FROM team_ai_file_policy WHERE team_id=?', [teamId]);
  return AI_FILE_MODES.includes(row?.mode) ? row.mode : DEFAULT_AI_FILE_MODE;
}
export async function setAiFileMode(repo, teamId, user, mode) {
  if (!AI_FILE_MODES.includes(mode)) throw Object.assign(new Error('Pick off, read or write'), { status: 400 });
  await ensureAiFilePolicyTable(repo);
  await repo.run('INSERT INTO team_ai_file_policy(team_id,mode,updated_by,updated_at) VALUES(?,?,?,?) ON CONFLICT(team_id) DO UPDATE SET mode=excluded.mode, updated_by=excluded.updated_by, updated_at=excluded.updated_at', [teamId, mode, user, new Date().toISOString()]);
  invalidateTeamFolders();
  return mode;
}

/**
 * The teamspace folders `userId` may use: [{ teamId, workspaceId, name, source, writable }].
 * A folder not created yet is created for someone who may write there (so the agent can put the first
 * file in an empty teamspace), and skipped for a reader.
 */
export async function teamFoldersFor(repo, userId, { tenantSlug = process.env.AGNT_TENANT_SLUG, root = TEAM_FILES_ROOT, exists = (p) => fs.existsSync(p), create = (p) => fs.mkdirSync(p, { recursive: true, mode: 0o700 }) } = {}) {
  if (!userId || !tenantSlug) return [];
  const memberships = await repo.all('SELECT team_id, role FROM team_members WHERE user_id=?', [userId]);
  const out = [];
  for (const { team_id: teamId, role } of memberships) {
    const mode = await aiFileMode(repo, teamId);
    if (mode === 'off') continue;
    const spaces = await repo.all('SELECT id, name, access FROM shared_workspaces WHERE team_id=? AND archived_at IS NULL ORDER BY created_at', [teamId]);
    const invited = new Set((await repo.all('SELECT m.workspace_id FROM shared_workspace_members m JOIN shared_workspaces w ON w.id=m.workspace_id WHERE w.team_id=? AND m.user_id=?', [teamId, userId])).map((r) => r.workspace_id));
    for (const space of spaces) {
      const inSpace = space.access !== 'invited' || invited.has(space.id) || MANAGERS.has(role);
      if (!inSpace) continue;
      const source = teamFolderSource(teamId, tenantSlug, space.id, root);
      const writable = mode === 'write' && WRITERS.has(role);
      if (!exists(source)) {
        if (!writable) continue;
        create(source);
      }
      out.push({ teamId, workspaceId: space.id, name: space.name, source, writable });
    }
  }
  // Unique folder names inside Teamspaces/.
  const used = new Set();
  return out.map((folder) => {
    // At most 60 characters even with a " 12" suffix: the launcher refuses longer names.
    const base = folderName(folder.name, 'Teamspace').slice(0, 56).trimEnd() || 'Teamspace';
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n += 1) name = `${base} ${n}`;
    used.add(name.toLowerCase());
    return { ...folder, folder: name };
  });
}

const cache = new Map(); // userId -> { at, folders }
let repoFactory = null;
/** The teams database, wired by the server (TeamRoutes.getTeamRepository); null in tests and desktop. */
export function useTeamRepository(factory) { repoFactory = factory; }
export function invalidateTeamFolders() { cache.clear(); }

/** Work out (and cache briefly) `userId`'s team folders. Never throws: no team folders on any failure. */
export async function refreshTeamFolders(userId) {
  if (!userId || !repoFactory) return [];
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.folders;
  try {
    const folders = await teamFoldersFor(repoFactory(), userId);
    cache.set(userId, { at: Date.now(), folders });
    return folders;
  } catch (error) {
    console.warn('[teamFolders] could not resolve team folders:', error?.message || error);
    cache.set(userId, { at: Date.now(), folders: [] });
    return [];
  }
}
/** The last answer for `userId` (sync, for sandbox planning). */
export function cachedTeamFolders(userId) { return cache.get(userId)?.folders || []; }

/** The mounts the launcher is handed: source -> <root>/Teamspaces/<folder>. */
export function teamMounts(folders, root) {
  return folders.map((f) => ({ source: f.source, target: path.posix.join(root, TEAM_FOLDER_DIR, f.folder), rw: Boolean(f.writable) }));
}
