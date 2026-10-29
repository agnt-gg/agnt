import fs from 'fs/promises';
import path from 'path';
import PathManager from './PathManager.js';
import { describeUnsafeRoot } from './installDirGuard.js';
import { currentToolActor } from '../services/security/toolRunAuthority.js';

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

async function readSettings() {
  try {
    const parsed = JSON.parse(await fs.readFile(SETTINGS_FILE, 'utf-8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {}; // missing or invalid: defaults
  }
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
  if (!userId) return DEFAULT_WORKSPACE_ROOT;
  const settings = await readSettings();
  if (!settings.workspaceRootOwner || settings.workspaceRootOwner === userId) return DEFAULT_WORKSPACE_ROOT;
  return path.join(USER_WORKSPACES_DIR, folderNameFor(userId));
}

/** Current workspace root for an account (default: the acting user, if any). */
export async function getWorkspaceRoot(userId = currentToolActor()) {
  const settings = await readSettings();
  if (!userId) return installRoot(settings);
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
