import fs from 'fs/promises';
import { readFileSync } from 'fs';
import path from 'path';
import PathManager from './PathManager.js';
import { describeUnsafeRoot } from './installDirGuard.js';
import { currentToolActor } from '../services/security/toolRunAuthority.js';
import { credentialUserId, isTenantInstance, tenantOwnerId } from '../services/auth/tenantOwnership.js';

/**
 * The workspace root: where AGNT reads and writes the user's project files.
 *
 * Lives in its own module for one reason above all: so the REAL functions
 * are importable by tests. The first regression test for this logic
 * reimplemented the decision inline and asserted against the copy — which
 * passes forever no matter what the production code does. Never again;
 * this module is the single implementation and the tests import it.
 *
 * No side effects at import. warnIfWorkspaceUnsafe is exported and invoked
 * by the routes module, which is the process-lifetime glue layer.
 */

export const DEFAULT_WORKSPACE_ROOT = PathManager.getPath('projects');
export const SETTINGS_FILE = PathManager.getPath('code-settings.json');
/** Parent of the per-account default folders: <AGNT>/workspaces/<userId>. */
export const USER_WORKSPACES_DIR = PathManager.getPath('workspaces');

/*
 * Per-account workspaces.
 *
 * code-settings.json: {
 *   workspaceRoot:      the install's folder (pre-existing setting, unchanged meaning),
 *   workspaceRootOwner: the account that folder belongs to,
 *   workspaceRoots:     { [userId]: folder }  for every other account that picked one.
 * }
 *
 * The install folder belongs to the first account that resolves a workspace after
 * this change shipped (on a single-user install: its only user, so nothing moves).
 * Any other account gets its own empty <AGNT>/workspaces/<userId> until it picks a
 * folder. Callers with no user (boot diagnostics) get the install folder, as before.
 *
 * userId defaults to the acting user of the current tool run / workflow node
 * (toolRunAuthority.withToolActor wraps both), so tool code needs no plumbing.
 */

const asSettings = (parsed) => (parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {});

async function readSettings() {
  try {
    return asSettings(JSON.parse(await fs.readFile(SETTINGS_FILE, 'utf-8')));
  } catch {
    return {}; // missing or invalid: defaults
  }
}

function readSettingsSync() {
  try {
    return asSettings(JSON.parse(readFileSync(SETTINGS_FILE, 'utf-8')));
  } catch {
    return {};
  }
}

/*
 * Hosted (tenant) instances.
 *
 * The platform names the instance owner (AGNT_TENANT_OWNER), so the install folder is theirs by
 * definition: "first to ask" is a desktop rule, and on a tenant the first to ask can be a teamspace's
 * storage principal (scope:…) running a workflow before the owner ever opens a chat. That is what
 * pushed bravo's owner out of /app/data/projects into a folder the tool sandbox refuses.
 *
 * The tool sandbox mounts exactly one folder per run, so on a hosted instance a root is only ever the
 * install folder (or a folder inside it) for the owner, and <AGNT>/workspaces/<id> for anyone else.
 */
function pinnedOwner() {
  if (!isTenantInstance()) return '';
  const owner = tenantOwnerId();
  return owner && !owner.includes('@') ? owner : '';
}
/** A teamspace storage principal is not a person: it works in the instance owner's folder. */
const isScopePrincipal = (userId) => typeof userId === 'string' && userId.startsWith('scope:');
const principalFor = (userId) => (userId ? credentialUserId(userId) : userId);
const memberRoot = (userId) => path.join(USER_WORKSPACES_DIR, folderNameFor(userId));
const isInside = (child, parent) => child === parent || child.startsWith(parent + path.sep);

/**
 * The root for an account, from settings alone: no claiming, no writes. Shared by the async resolver
 * and the sync one the tool sandbox uses, so the two can never disagree about where code may run.
 */
function rootFromSettings(settings, userId, owner) {
  if (!userId) return installRoot(settings);
  if (owner) return userId === owner ? installRoot(settings) : memberRoot(userId);
  if (isTenantInstance() && isScopePrincipal(userId)) return installRoot(settings);
  const own = settings.workspaceRoots?.[userId];
  if (own) return path.resolve(own);
  if (settings.workspaceRootOwner === userId) return installRoot(settings);
  return memberRoot(userId);
}

/** A wrong claim (left by the old first-come rule) is corrected the next time anyone resolves. */
async function repairHostedClaim(settings, owner) {
  if (settings.workspaceRootOwner === owner) return settings;
  console.warn(`[workspaceRoot] install folder was claimed by ${settings.workspaceRootOwner || 'nobody'}; it belongs to the instance owner ${owner}. Corrected.`);
  return updateSettings((s) => {
    if (s.workspaceRootOwner === owner) return false;
    s.workspaceRootOwner = owner;
    return true;
  });
}

// Read-modify-write is serialized in-process so two first requests cannot both
// claim the install folder, and the write is atomic (tmp + rename) so a crash
// never leaves a half-written settings file.
let settingsQueue = Promise.resolve();
function updateSettings(mutate) {
  const run = settingsQueue.then(async () => {
    const settings = await readSettings();
    const changed = mutate(settings);
    if (changed === false) return settings;
    await fs.mkdir(path.dirname(SETTINGS_FILE), { recursive: true });
    const tmp = `${SETTINGS_FILE}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(settings, null, 2), 'utf-8');
    await fs.rename(tmp, SETTINGS_FILE);
    return settings;
  });
  settingsQueue = run.catch(() => {});
  return run;
}

const installRoot = (settings) => (settings.workspaceRoot ? path.resolve(settings.workspaceRoot) : DEFAULT_WORKSPACE_ROOT);

/** User ids become folder names: keep them to a safe character set. */
function folderNameFor(userId) {
  const safe = String(userId).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
  if (!safe) throw new Error('invalid user id for workspace folder');
  return safe;
}

/** The folder an account gets before it picks one. */
export async function defaultRootFor(userId) {
  userId = principalFor(userId);
  if (!userId) return DEFAULT_WORKSPACE_ROOT;
  const owner = pinnedOwner();
  if (owner) return userId === owner ? DEFAULT_WORKSPACE_ROOT : memberRoot(userId);
  const settings = await readSettings();
  if (!settings.workspaceRootOwner || settings.workspaceRootOwner === userId) return DEFAULT_WORKSPACE_ROOT;
  return memberRoot(userId);
}

/**
 * The workspace root without touching the settings file. For synchronous callers (the tool sandbox
 * plans a launch synchronously). Never claims: an unclaimed install resolves as if unclaimed.
 */
/**
 * Inside the hosted tool sandbox the answer is fixed: the one folder the launcher mounted
 * (agnt-tool-run.py sets AGNT_TOOL_WORKSPACE_MOUNTED). The settings file and the acting user are not
 * visible there, and the install folder is not mounted for a member, so resolving from settings sent a
 * member's file tools to a folder that does not exist in their sandbox.
 */
export function sandboxMountedRoot(env = process.env) {
  return env.AGNT_TOOL_SANDBOX === '1' && env.AGNT_TOOL_WORKSPACE_MOUNTED ? path.resolve(env.AGNT_TOOL_WORKSPACE_MOUNTED) : null;
}

export function getWorkspaceRootSync(userId = currentToolActor()) {
  const mounted = sandboxMountedRoot();
  if (mounted) return mounted;
  userId = principalFor(userId);
  const settings = readSettingsSync();
  const owner = pinnedOwner();
  if (!owner && userId && !settings.workspaceRootOwner && !isScopePrincipal(userId) && !settings.workspaceRoots?.[userId]) {
    return installRoot(settings); // the first account would claim it; resolving must not.
  }
  return rootFromSettings(settings, userId, owner);
}

/** Current workspace root for an account (default: the acting user, if any). */
export async function getWorkspaceRoot(userId = currentToolActor()) {
  const mounted = sandboxMountedRoot();
  if (mounted) return mounted;
  userId = principalFor(userId);
  const owner = pinnedOwner();
  if (owner) {
    const settings = userId ? await repairHostedClaim(await readSettings(), owner) : await readSettings();
    return rootFromSettings(settings, userId, owner);
  }
  const settings = await readSettings();
  if (!userId) return installRoot(settings);
  // A teamspace principal never claims the install folder, with or without a named owner.
  if (isTenantInstance() && isScopePrincipal(userId)) return installRoot(settings);
  const own = settings.workspaceRoots?.[userId];
  if (own) return path.resolve(own);
  if (settings.workspaceRootOwner === userId) return installRoot(settings);
  if (!settings.workspaceRootOwner) {
    // First account on this install: it inherits the existing folder.
    const after = await updateSettings((s) => {
      if (s.workspaceRootOwner) return false;
      s.workspaceRootOwner = userId;
      return true;
    });
    if (after.workspaceRootOwner === userId) return installRoot(after);
    if (after.workspaceRoots?.[userId]) return path.resolve(after.workspaceRoots[userId]);
  }
  return path.join(USER_WORKSPACES_DIR, folderNameFor(userId));
}

/**
 * Persist a new workspace root for an account. Callers validate BEFORE calling.
 * Without a user it sets the install folder (legacy behaviour).
 */
export async function saveWorkspaceRoot(rootPath, userId = currentToolActor()) {
  userId = principalFor(userId);
  const owner = pinnedOwner();
  if (owner && userId) {
    // The tool sandbox mounts only these folders; a root anywhere else would break every code tool.
    if (userId !== owner) throw Object.assign(new Error('On a hosted instance each member works in their own fixed folder.'), { code: 'hosted_workspace_fixed', status: 400 });
    if (!isInside(path.resolve(rootPath), DEFAULT_WORKSPACE_ROOT)) throw Object.assign(new Error(`On a hosted instance the workspace must be inside ${DEFAULT_WORKSPACE_ROOT}.`), { code: 'hosted_workspace_fixed', status: 400 });
  }
  await updateSettings((settings) => {
    if (!userId) { settings.workspaceRoot = rootPath; return true; }
    if (!settings.workspaceRootOwner) settings.workspaceRootOwner = userId;
    if (settings.workspaceRootOwner === userId) {
      settings.workspaceRoot = rootPath;
      if (settings.workspaceRoots) delete settings.workspaceRoots[userId];
    } else {
      settings.workspaceRoots = { ...(settings.workspaceRoots || {}), [userId]: rootPath };
    }
    return true;
  });
}

/**
 * Ensure the workspace root exists — with ONE exception: a root inside the
 * install directory is never re-created.
 *
 * That exception is the difference between a user seeing "my folder is
 * gone" and "my folder is empty". After the updater erased $INSTDIR, the
 * very next tree load called this function, which cheerfully mkdir'd the
 * folder back into existence — so the user opened a real, present, empty
 * directory and concluded AGNT had wiped his files in place. Re-creating
 * the folder destroys the only evidence of what actually happened and
 * makes the product look like it corrupts data.
 *
 * When the folder still exists this changes nothing (mkdir -p on an
 * existing path is a no-op). It only bites when the folder is already
 * gone, which is exactly the case that must not be papered over.
 */
export async function ensureWorkspaceRoot(userId = currentToolActor()) {
  const root = await getWorkspaceRoot(userId);
  if (describeUnsafeRoot(root)) return root;
  try {
    await fs.mkdir(root, { recursive: true });
  } catch (err) {
    // Already exists or other non-fatal error
  }
  return root;
}

/**
 * Shout, once, at startup if the CONFIGURED workspace root is already
 * inside the install directory.
 *
 * The picker refuses to create this situation now, but installs configured
 * before the guard existed are already in it and lose everything on their
 * next update. They cannot be fixed silently — the folder is the user's,
 * and moving someone's files without asking is its own kind of data loss —
 * so the loudest thing we can do without touching their disk is say so on
 * every boot and flag it on the settings endpoint the UI already calls.
 */
export async function warnIfWorkspaceUnsafe() {
  try {
    const unsafe = describeUnsafeRoot(await getWorkspaceRoot());
    if (!unsafe) return;
    console.warn(
      '\n' +
        '='.repeat(72) + '\n' +
        '  WARNING: your workspace folder will be DELETED by the next update.\n' +
        `  Workspace: ${unsafe.workspaceRoot}\n` +
        `  AGNT install: ${unsafe.installRoot}\n` +
        '  Installing an AGNT update erases the install directory and\n' +
        '  everything inside it. Move your work and pick a different\n' +
        '  workspace folder BEFORE you install another update.\n' +
        '='.repeat(72) + '\n',
    );
  } catch {
    // Never let a diagnostic take the backend down.
  }
}
