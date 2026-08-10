import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import fssync from 'fs';
import path from 'path';
import {
  getWorkspaceRoot,
  saveWorkspaceRoot,
  ensureWorkspaceRoot,
  DEFAULT_WORKSPACE_ROOT,
  SETTINGS_FILE,
} from './workspaceRoot.js';

/**
 * Tests for the REAL workspace-root functions — the ones the routes call.
 *
 * The previous incarnation of this coverage (workspaceRootSafety.test.js)
 * reimplemented ensureWorkspaceRoot's decision inline and asserted against
 * the copy, which would keep passing no matter what happened to the
 * production code. These tests import the production module. If it
 * regresses, they fail. That is the entire point of their existence.
 *
 * PathManager sandboxes all paths under the per-run vitest temp dir, so
 * SETTINGS_FILE here is never the user's real code-settings.json.
 */

const ORIGINAL_APP_PATH = process.env.APP_PATH;

/** Packaged-layout APP_PATH for a given install root (see installDirGuard). */
const packagedAppPath = (root) => path.join(root, 'resources', 'app.asar');

/** Point the settings file at a specific workspace root. */
async function configureWorkspace(root) {
  await fs.mkdir(path.dirname(SETTINGS_FILE), { recursive: true });
  await fs.writeFile(SETTINGS_FILE, JSON.stringify({ workspaceRoot: root }, null, 2), 'utf-8');
}

let scratch;

beforeEach(async () => {
  delete process.env.APP_PATH;
  scratch = await fs.mkdtemp(path.join(path.dirname(SETTINGS_FILE), 'wsroot-test-'));
});

afterEach(async () => {
  if (ORIGINAL_APP_PATH === undefined) delete process.env.APP_PATH;
  else process.env.APP_PATH = ORIGINAL_APP_PATH;
  await fs.rm(SETTINGS_FILE, { force: true }).catch(() => {});
  await fs.rm(scratch, { recursive: true, force: true }).catch(() => {});
});

describe('getWorkspaceRoot', () => {
  it('falls back to the default when no settings file exists', async () => {
    expect(await getWorkspaceRoot()).toBe(DEFAULT_WORKSPACE_ROOT);
  });

  it('returns the configured root, resolved', async () => {
    const configured = path.join(scratch, 'my-workspace');
    await configureWorkspace(configured);
    expect(await getWorkspaceRoot()).toBe(path.resolve(configured));
  });

  it('survives a corrupt settings file', async () => {
    await fs.mkdir(path.dirname(SETTINGS_FILE), { recursive: true });
    await fs.writeFile(SETTINGS_FILE, 'not json at all', 'utf-8');
    expect(await getWorkspaceRoot()).toBe(DEFAULT_WORKSPACE_ROOT);
  });
});

describe('saveWorkspaceRoot', () => {
  it('persists the pointer and getWorkspaceRoot reads it back', async () => {
    const configured = path.join(scratch, 'saved-workspace');
    await saveWorkspaceRoot(configured);
    expect(await getWorkspaceRoot()).toBe(path.resolve(configured));
  });

  it('preserves unrelated settings keys', async () => {
    await fs.mkdir(path.dirname(SETTINGS_FILE), { recursive: true });
    await fs.writeFile(SETTINGS_FILE, JSON.stringify({ theme: 'dark' }), 'utf-8');
    await saveWorkspaceRoot(path.join(scratch, 'ws'));
    const settings = JSON.parse(await fs.readFile(SETTINGS_FILE, 'utf-8'));
    expect(settings.theme).toBe('dark');
    expect(settings.workspaceRoot).toContain('ws');
  });
});

describe('ensureWorkspaceRoot — the REAL function, post-wipe behaviour', () => {
  it('does NOT re-create a workspace inside the install directory', async () => {
    const install = path.join(scratch, 'AGNT');
    await fs.mkdir(path.join(install, 'resources'), { recursive: true });
    process.env.APP_PATH = packagedAppPath(install);

    // The post-update state: the configured workspace no longer exists.
    const doomed = path.join(install, 'projects');
    await configureWorkspace(doomed);
    expect(fssync.existsSync(doomed)).toBe(false);

    const returned = await ensureWorkspaceRoot();

    expect(returned).toBe(path.resolve(doomed));
    expect(fssync.existsSync(doomed)).toBe(false); // still absent — evidence preserved
  });

  it('creates a safe workspace root that is missing', async () => {
    const install = path.join(scratch, 'AGNT');
    await fs.mkdir(path.join(install, 'resources'), { recursive: true });
    process.env.APP_PATH = packagedAppPath(install);

    const safe = path.join(scratch, 'projects');
    await configureWorkspace(safe);

    await ensureWorkspaceRoot();

    expect(fssync.existsSync(safe)).toBe(true);
  });

  it('creates normally in development, where no install dir is knowable', async () => {
    process.env.APP_PATH = path.join(scratch, 'checkout'); // not a packaged layout
    const ws = path.join(scratch, 'checkout', 'projects');
    await configureWorkspace(ws);

    await ensureWorkspaceRoot();

    expect(fssync.existsSync(ws)).toBe(true);
  });

  it('leaves an EXISTING doomed workspace and its contents untouched', async () => {
    const install = path.join(scratch, 'AGNT');
    await fs.mkdir(path.join(install, 'resources'), { recursive: true });
    process.env.APP_PATH = packagedAppPath(install);

    const doomed = path.join(install, 'projects');
    await fs.mkdir(doomed, { recursive: true });
    await fs.writeFile(path.join(doomed, 'work.txt'), 'important');
    await configureWorkspace(doomed);

    await ensureWorkspaceRoot();

    expect(await fs.readFile(path.join(doomed, 'work.txt'), 'utf-8')).toBe('important');
  });
});
