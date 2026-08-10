import fs from 'fs/promises';
import path from 'path';
import PathManager from './PathManager.js';
import { describeUnsafeRoot } from './installDirGuard.js';

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

/** Current workspace root: the settings pointer, or the default. */
export async function getWorkspaceRoot() {
  try {
    const raw = await fs.readFile(SETTINGS_FILE, 'utf-8');
    const settings = JSON.parse(raw);
    if (settings.workspaceRoot) {
      return path.resolve(settings.workspaceRoot);
    }
  } catch {
    // Settings file doesn't exist or is invalid — use default
  }
  return DEFAULT_WORKSPACE_ROOT;
}

/** Persist a new workspace root. Callers validate BEFORE calling this. */
export async function saveWorkspaceRoot(rootPath) {
  let settings = {};
  try {
    const raw = await fs.readFile(SETTINGS_FILE, 'utf-8');
    settings = JSON.parse(raw);
  } catch {
    // Start fresh
  }
  settings.workspaceRoot = rootPath;
  await fs.mkdir(path.dirname(SETTINGS_FILE), { recursive: true });
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
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
export async function ensureWorkspaceRoot() {
  const root = await getWorkspaceRoot();
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
