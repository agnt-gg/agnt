import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import {
  getWorkspaceRoot,
  saveWorkspaceRoot,
  ensureWorkspaceRoot,
  defaultRootFor,
  DEFAULT_WORKSPACE_ROOT,
  USER_WORKSPACES_DIR,
  SETTINGS_FILE,
} from './workspaceRoot.js';
import { withToolActor } from '../services/security/toolRunAuthority.js';

/**
 * Per-account workspaces, against the REAL module (PathManager sandboxes
 * SETTINGS_FILE under the vitest temp dir; never the user's real settings).
 *
 * The bug this guards: one install-wide workspaceRoot meant a second AGNT
 * account on the same computer opened Library > Files and saw — and had Annie
 * write into — the first account's project folders.
 */

const OWNER = 'owner-user-1';
const OTHER = 'second-user-2';
const readSettings = async () => JSON.parse(await fs.readFile(SETTINGS_FILE, 'utf-8'));
let scratch;

beforeEach(async () => {
  await fs.rm(SETTINGS_FILE, { force: true }).catch(() => {});
  scratch = await fs.mkdtemp(path.join(path.dirname(SETTINGS_FILE), 'wsroot-peruser-'));
});
afterEach(async () => {
  await fs.rm(SETTINGS_FILE, { force: true }).catch(() => {});
  await fs.rm(scratch, { recursive: true, force: true }).catch(() => {});
  await fs.rm(USER_WORKSPACES_DIR, { recursive: true, force: true }).catch(() => {});
});

async function configureInstall(root, extra = {}) {
  await fs.mkdir(path.dirname(SETTINGS_FILE), { recursive: true });
  await fs.writeFile(SETTINGS_FILE, JSON.stringify({ workspaceRoot: root, ...extra }, null, 2), 'utf-8');
}

describe('per-account workspace roots', () => {
  it('the first account to resolve keeps the existing install folder (upgrade moves nothing)', async () => {
    const existing = path.join(scratch, 'existing-projects');
    await configureInstall(existing);
    expect(await getWorkspaceRoot(OWNER)).toBe(path.resolve(existing));
    expect((await readSettings()).workspaceRootOwner).toBe(OWNER);
  });

  it('a second account gets its own empty folder, never the owner\'s', async () => {
    const existing = path.join(scratch, 'existing-projects');
    await configureInstall(existing, { workspaceRootOwner: OWNER });
    const other = await getWorkspaceRoot(OTHER);
    expect(other).toBe(path.join(USER_WORKSPACES_DIR, OTHER));
    expect(other).not.toBe(path.resolve(existing));
    expect(await getWorkspaceRoot(OWNER)).toBe(path.resolve(existing));
  });

  it('two accounts can pick two different folders on the same computer', async () => {
    await configureInstall(path.join(scratch, 'owner-ws'), { workspaceRootOwner: OWNER });
    const otherPick = path.join(scratch, 'second-ws');
    await saveWorkspaceRoot(otherPick, OTHER);
    expect(await getWorkspaceRoot(OTHER)).toBe(path.resolve(otherPick));
    expect(await getWorkspaceRoot(OWNER)).toBe(path.resolve(path.join(scratch, 'owner-ws')));
    const s = await readSettings();
    expect(s.workspaceRoot).toBe(path.join(scratch, 'owner-ws')); // owner's folder untouched
    expect(s.workspaceRoots[OTHER]).toBe(otherPick);
  });

  it('the owner changing their folder updates the install folder, not a per-user entry', async () => {
    await configureInstall(path.join(scratch, 'old'), { workspaceRootOwner: OWNER });
    await saveWorkspaceRoot(path.join(scratch, 'new'), OWNER);
    const s = await readSettings();
    expect(s.workspaceRoot).toBe(path.join(scratch, 'new'));
    expect(s.workspaceRoots?.[OWNER]).toBeUndefined();
  });

  it('callers without a user still get the install folder (boot diagnostics, legacy)', async () => {
    const existing = path.join(scratch, 'existing-projects');
    await configureInstall(existing, { workspaceRootOwner: OWNER });
    expect(await getWorkspaceRoot()).toBe(path.resolve(existing));
  });

  it('with no settings at all, the first account gets the default folder', async () => {
    expect(await getWorkspaceRoot(OWNER)).toBe(DEFAULT_WORKSPACE_ROOT);
    expect(await getWorkspaceRoot(OTHER)).toBe(path.join(USER_WORKSPACES_DIR, OTHER));
  });

  it('concurrent first requests from two accounts claim the install folder exactly once', async () => {
    const existing = path.join(scratch, 'existing-projects');
    await configureInstall(existing);
    const [a, b] = await Promise.all([getWorkspaceRoot(OWNER), getWorkspaceRoot(OTHER)]);
    const owner = (await readSettings()).workspaceRootOwner;
    expect([OWNER, OTHER]).toContain(owner);
    const ownerRoot = owner === OWNER ? a : b;
    const otherRoot = owner === OWNER ? b : a;
    expect(ownerRoot).toBe(path.resolve(existing));
    expect(otherRoot).not.toBe(path.resolve(existing));
  });

  it('tool code resolves the acting user without being told (withToolActor)', async () => {
    await configureInstall(path.join(scratch, 'owner-ws'), { workspaceRootOwner: OWNER });
    const inTool = await withToolActor(OTHER, () => getWorkspaceRoot());
    expect(inTool).toBe(path.join(USER_WORKSPACES_DIR, OTHER));
  });

  it('ensureWorkspaceRoot creates the account\'s own folder', async () => {
    await configureInstall(path.join(scratch, 'owner-ws'), { workspaceRootOwner: OWNER });
    const root = await ensureWorkspaceRoot(OTHER);
    expect((await fs.stat(root)).isDirectory()).toBe(true);
  });

  it('user ids cannot escape the workspaces folder', async () => {
    await configureInstall(path.join(scratch, 'owner-ws'), { workspaceRootOwner: OWNER });
    const root = await getWorkspaceRoot('../../evil');
    expect(path.dirname(root)).toBe(USER_WORKSPACES_DIR);
  });

  it('defaultRootFor reports the per-account default for non-owners', async () => {
    await configureInstall(path.join(scratch, 'owner-ws'), { workspaceRootOwner: OWNER });
    expect(await defaultRootFor(OWNER)).toBe(DEFAULT_WORKSPACE_ROOT);
    expect(await defaultRootFor(OTHER)).toBe(path.join(USER_WORKSPACES_DIR, OTHER));
  });

  it('preserves unrelated settings keys through the claim and saves', async () => {
    await configureInstall(path.join(scratch, 'owner-ws'), { theme: 'dark' });
    await getWorkspaceRoot(OWNER);
    await saveWorkspaceRoot(path.join(scratch, 'x'), OTHER);
    expect((await readSettings()).theme).toBe('dark');
  });
});
