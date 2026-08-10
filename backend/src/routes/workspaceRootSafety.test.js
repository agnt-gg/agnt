import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import fssync from 'fs';
import os from 'os';
import path from 'path';
import { describeUnsafeRoot } from '../utils/installDirGuard.js';

/**
 * The behaviour that turned data loss into "AGNT corrupted my folder".
 *
 * After the updater erased $INSTDIR, the very next file-tree load called
 * ensureWorkspaceRoot(), which mkdir'd the workspace back into existence. The
 * user opened a real, present, EMPTY directory and reasonably concluded AGNT
 * had wiped his files in place — when in fact the installer had removed the
 * whole tree and AGNT had just re-created the container.
 *
 * ensureWorkspaceRoot must therefore refuse to re-create a root that lives
 * inside the install directory. This test pins that decision against the
 * guard directly, so it holds regardless of how the route file is wired.
 */

const ORIGINAL_APP_PATH = process.env.APP_PATH;
let sandbox;

const packagedAppPath = (root) => path.join(root, 'resources', 'app.asar');

/** The production shape of ensureWorkspaceRoot's decision. */
async function ensureWorkspaceRoot(root) {
  if (describeUnsafeRoot(root)) return { root, created: false };
  try {
    await fs.mkdir(root, { recursive: true });
  } catch {
    /* non-fatal */
  }
  return { root, created: fssync.existsSync(root) };
}

beforeEach(async () => {
  sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'agnt-wsroot-'));
});

afterEach(async () => {
  if (ORIGINAL_APP_PATH === undefined) delete process.env.APP_PATH;
  else process.env.APP_PATH = ORIGINAL_APP_PATH;
  await fs.rm(sandbox, { recursive: true, force: true }).catch(() => {});
});

describe('ensureWorkspaceRoot — never re-create a doomed folder', () => {
  it('does NOT re-create a workspace inside the install directory', async () => {
    const install = path.join(sandbox, 'AGNT');
    await fs.mkdir(path.join(install, 'resources'), { recursive: true });
    process.env.APP_PATH = packagedAppPath(install);

    // Simulate the post-wipe state: the workspace no longer exists.
    const workspace = path.join(install, 'projects');
    expect(fssync.existsSync(workspace)).toBe(false);

    const result = await ensureWorkspaceRoot(workspace);

    expect(result.created).toBe(false);
    expect(fssync.existsSync(workspace)).toBe(false);
  });

  it('still creates a safe workspace root', async () => {
    const install = path.join(sandbox, 'AGNT');
    await fs.mkdir(path.join(install, 'resources'), { recursive: true });
    process.env.APP_PATH = packagedAppPath(install);

    const workspace = path.join(sandbox, 'projects');
    const result = await ensureWorkspaceRoot(workspace);

    expect(result.created).toBe(true);
    expect(fssync.existsSync(workspace)).toBe(true);
  });

  it('creates normally in development, where no install dir is known', async () => {
    process.env.APP_PATH = path.join(sandbox, 'checkout');

    const workspace = path.join(sandbox, 'checkout', 'projects');
    const result = await ensureWorkspaceRoot(workspace);

    expect(result.created).toBe(true);
  });

  it('leaves an EXISTING unsafe workspace untouched and readable', async () => {
    const install = path.join(sandbox, 'AGNT');
    await fs.mkdir(path.join(install, 'resources'), { recursive: true });
    process.env.APP_PATH = packagedAppPath(install);

    // The dangerous-but-still-populated case: warn, never destroy or hide.
    const workspace = path.join(install, 'projects');
    await fs.mkdir(workspace, { recursive: true });
    await fs.writeFile(path.join(workspace, 'work.txt'), 'important');

    await ensureWorkspaceRoot(workspace);

    expect(fssync.existsSync(path.join(workspace, 'work.txt'))).toBe(true);
  });
});

describe('GET /settings — the verdict the UI renders', () => {
  it('reports a verdict for a doomed root', async () => {
    const install = path.join(sandbox, 'AGNT');
    await fs.mkdir(path.join(install, 'resources'), { recursive: true });
    process.env.APP_PATH = packagedAppPath(install);

    const verdict = describeUnsafeRoot(path.join(install, 'projects'));

    expect(verdict).toMatchObject({ code: 'workspace_inside_install_dir' });
    expect(verdict.workspaceRoot).toContain('projects');
    expect(verdict.installRoot).toBe(install);
  });

  it('reports null for a safe root, so no banner is shown', async () => {
    const install = path.join(sandbox, 'AGNT');
    await fs.mkdir(path.join(install, 'resources'), { recursive: true });
    process.env.APP_PATH = packagedAppPath(install);

    expect(describeUnsafeRoot(path.join(sandbox, 'projects'))).toBeNull();
  });
});
