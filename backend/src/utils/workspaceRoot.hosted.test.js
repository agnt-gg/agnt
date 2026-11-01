import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import {
  getWorkspaceRoot,
  getWorkspaceRootSync,
  saveWorkspaceRoot,
  defaultRootFor,
  DEFAULT_WORKSPACE_ROOT,
  USER_WORKSPACES_DIR,
  SETTINGS_FILE,
} from './workspaceRoot.js';

/**
 * Hosted (tenant) instances: the install folder belongs to the instance owner the platform names
 * (AGNT_TENANT_OWNER), never to whichever principal happens to ask first.
 *
 * Bravo, 2026-10-31: a teamspace workflow ran as its storage principal (scope:5a8e…) before the owner
 * opened a chat, claimed /app/data/projects, and pushed the owner and every member into
 * /app/data/workspaces/<id>, a folder the tool sandbox refuses. Every chat code tool failed with
 * "Hosted tools must execute inside the workspace".
 */

const OWNER = 'add4b3d4e2536a142bc0c89a585eda3e';
const MEMBER = '83a32f6daaaf5bfaa6b8fca4efd29ad0';
const SCOPE = 'scope:5a8e6b69861b9f0df885d2f330d815f76a2250750b35c3b0f35fe9e3759378c6';
const readSettings = async () => JSON.parse(await fs.readFile(SETTINGS_FILE, 'utf-8'));
const writeSettings = async (settings) => {
  await fs.mkdir(path.dirname(SETTINGS_FILE), { recursive: true });
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
};
const saved = {};

beforeEach(async () => {
  for (const key of ['AGNT_TENANT_SLUG', 'AGNT_TENANT_OWNER']) saved[key] = process.env[key];
  process.env.AGNT_TENANT_SLUG = 'bravo';
  process.env.AGNT_TENANT_OWNER = OWNER;
  await fs.rm(SETTINGS_FILE, { force: true }).catch(() => {});
});
afterEach(async () => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  await fs.rm(SETTINGS_FILE, { force: true }).catch(() => {});
  await fs.rm(USER_WORKSPACES_DIR, { recursive: true, force: true }).catch(() => {});
});

describe('hosted workspace roots', () => {
  it('a teamspace principal asking first never takes the install folder from the owner', async () => {
    expect(await getWorkspaceRoot(SCOPE)).toBe(DEFAULT_WORKSPACE_ROOT);
    expect(await getWorkspaceRoot(OWNER)).toBe(DEFAULT_WORKSPACE_ROOT);
    expect(await getWorkspaceRoot(MEMBER)).toBe(path.join(USER_WORKSPACES_DIR, MEMBER));
  });

  it('a member asking first never takes the install folder from the owner', async () => {
    expect(await getWorkspaceRoot(MEMBER)).toBe(path.join(USER_WORKSPACES_DIR, MEMBER));
    expect(await getWorkspaceRoot(OWNER)).toBe(DEFAULT_WORKSPACE_ROOT);
  });

  it('repairs an install whose folder was already claimed by the wrong principal (bravo)', async () => {
    await writeSettings({ workspaceRootOwner: SCOPE });
    expect(await getWorkspaceRoot(OWNER)).toBe(DEFAULT_WORKSPACE_ROOT);
    expect((await readSettings()).workspaceRootOwner).toBe(OWNER);
  });

  it('the sync resolver used by the sandbox agrees with the async one, and never writes', async () => {
    await writeSettings({ workspaceRootOwner: SCOPE, theme: 'dark' });
    expect(getWorkspaceRootSync(OWNER)).toBe(DEFAULT_WORKSPACE_ROOT);
    expect(getWorkspaceRootSync(SCOPE)).toBe(DEFAULT_WORKSPACE_ROOT);
    expect(getWorkspaceRootSync(MEMBER)).toBe(path.join(USER_WORKSPACES_DIR, MEMBER));
    expect(getWorkspaceRootSync(undefined)).toBe(DEFAULT_WORKSPACE_ROOT);
    expect((await readSettings()).workspaceRootOwner).toBe(SCOPE);
  });

  it('a member folder picked earlier is ignored: the sandbox can only mount the member\'s own folder', async () => {
    await writeSettings({ workspaceRootOwner: OWNER, workspaceRoots: { [MEMBER]: DEFAULT_WORKSPACE_ROOT } });
    expect(await getWorkspaceRoot(MEMBER)).toBe(path.join(USER_WORKSPACES_DIR, MEMBER));
    expect(getWorkspaceRootSync(MEMBER)).toBe(path.join(USER_WORKSPACES_DIR, MEMBER));
  });

  it('refuses to save a member folder, and an owner folder outside the projects folder', async () => {
    await expect(saveWorkspaceRoot(DEFAULT_WORKSPACE_ROOT, MEMBER)).rejects.toMatchObject({ code: 'hosted_workspace_fixed' });
    await expect(saveWorkspaceRoot(path.dirname(DEFAULT_WORKSPACE_ROOT), OWNER)).rejects.toMatchObject({ code: 'hosted_workspace_fixed' });
    await saveWorkspaceRoot(path.join(DEFAULT_WORKSPACE_ROOT, 'client-a'), OWNER);
    expect(await getWorkspaceRoot(OWNER)).toBe(path.join(DEFAULT_WORKSPACE_ROOT, 'client-a'));
  });

  it('defaultRootFor names the owner\'s and members\' folders without consulting who asked first', async () => {
    await writeSettings({ workspaceRootOwner: SCOPE });
    expect(await defaultRootFor(OWNER)).toBe(DEFAULT_WORKSPACE_ROOT);
    expect(await defaultRootFor(MEMBER)).toBe(path.join(USER_WORKSPACES_DIR, MEMBER));
  });

  it('with no owner named, a hosted instance still never lets a teamspace principal claim the folder', async () => {
    delete process.env.AGNT_TENANT_OWNER;
    expect(await getWorkspaceRoot(SCOPE)).toBe(DEFAULT_WORKSPACE_ROOT);
    expect((await readSettings().catch(() => ({}))).workspaceRootOwner).toBeUndefined();
  });
});
