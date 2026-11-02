import { describe, it, expect, beforeEach } from 'vitest';
import sqlite3 from 'sqlite3';
import { createHash } from 'node:crypto';
import { TeamRepository } from '../TeamRepository.js';
import { initializeTeamWorkspaces } from '../TeamWorkspaceRepository.js';
import { teamFoldersFor, teamFolderSource, teamMounts, setAiFileMode, aiFileMode, folderName, rememberCloudMembership } from './teamFolders.js';

const SLUG = 'bravo';
let repo;
const made = new Set();
const opts = { tenantSlug: SLUG, root: '/app/data/workspace-files', exists: (p) => made.has(p), create: (p) => made.add(p) };

async function seed() {
  repo = new TeamRepository(new sqlite3.Database(':memory:'));
  await repo.initialize();
  await initializeTeamWorkspaces(repo);
  await repo.run("INSERT INTO teams(id,name,owner_id,created_at) VALUES('t1','Bravo','owner',datetime())");
  for (const [user, role] of [['owner', 'owner'], ['ana', 'member'], ['vic', 'viewer'], ['zed', 'member']]) {
    await repo.run('INSERT INTO team_members(team_id,user_id,role) VALUES(?,?,?)', ['t1', user, role]);
  }
  await repo.run("INSERT INTO shared_workspaces(id,team_id,name,created_by,access) VALUES('general','t1','General','owner','team')");
  await repo.run("INSERT INTO shared_workspaces(id,team_id,name,created_by,access) VALUES('sales','t1','Sales / NA','owner','invited')");
  await repo.run("INSERT INTO shared_workspace_members(workspace_id,user_id,added_by) VALUES('sales','ana','owner')");
}
beforeEach(async () => { made.clear(); await seed(); });

describe('the teamspace Files a person\'s tools may use', () => {
  it('uses the exact folder the Files tab stores them in', () => {
    const key = createHash('sha256').update(JSON.stringify(['t1', SLUG, 'general'])).digest('hex');
    expect(teamFolderSource('t1', SLUG, 'general')).toBe(`/app/data/workspace-files/${key}`);
  });
  it('a member gets every team-wide space and the invite-only ones they are in, read-write', async () => {
    const folders = await teamFoldersFor(repo, 'ana', opts);
    expect(folders.map((f) => [f.workspaceId, f.folder, f.writable])).toEqual([['general', 'General', true], ['sales', 'Sales NA', true]]);
    // A writer's empty teamspace gets its folder, so the agent can save the first file.
    expect(made.size).toBe(2);
  });
  it('an invite-only space is not mounted for a member outside it', async () => {
    expect((await teamFoldersFor(repo, 'zed', opts)).map((f) => f.workspaceId)).toEqual(['general']);
  });
  it('a viewer reads only, and is never given a folder that does not exist yet', async () => {
    expect(await teamFoldersFor(repo, 'vic', opts)).toEqual([]);
    made.add(teamFolderSource('t1', SLUG, 'general'));
    expect((await teamFoldersFor(repo, 'vic', opts)).map((f) => [f.workspaceId, f.writable])).toEqual([['general', false]]);
  });
  it('the owner\'s setting caps it: read makes every folder read-only; off mounts nothing', async () => {
    expect(await aiFileMode(repo, 't1')).toBe('write');
    await setAiFileMode(repo, 't1', 'owner', 'read');
    expect((await teamFoldersFor(repo, 'ana', opts)).every((f) => !f.writable)).toBe(true);
    await setAiFileMode(repo, 't1', 'owner', 'off');
    expect(await teamFoldersFor(repo, 'ana', opts)).toEqual([]);
    await expect(setAiFileMode(repo, 't1', 'owner', 'everything')).rejects.toMatchObject({ status: 400 });
  });
  it('someone on no team gets nothing', async () => {
    expect(await teamFoldersFor(repo, 'stranger', opts)).toEqual([]);
  });
  // Bravo: teams.db has the team and its teamspaces, but membership is the cloud's (no member rows).
  it('on a cloud instance the owner gets every teamspace, and a member the role the cloud gave them', async () => {
    await repo.run('DELETE FROM team_members');
    const cloudOpts = { ...opts, owner: 'boss' };
    expect((await teamFoldersFor(repo, 'boss', cloudOpts)).map((f) => [f.workspaceId, f.writable])).toEqual([['general', true], ['sales', true]]);
    expect(await teamFoldersFor(repo, 'cara', cloudOpts)).toEqual([]);
    rememberCloudMembership('cara', { teamId: 't1', role: 'viewer' });
    made.add(teamFolderSource('t1', SLUG, 'general'));
    expect((await teamFoldersFor(repo, 'cara', cloudOpts)).map((f) => [f.workspaceId, f.writable])).toEqual([['general', false]]);
    rememberCloudMembership('cara', { teamId: 't1', role: 'member' });
    expect((await teamFoldersFor(repo, 'cara', cloudOpts)).map((f) => [f.workspaceId, f.writable])).toEqual([['general', true]]);
    rememberCloudMembership('cara', null);
    expect(await teamFoldersFor(repo, 'cara', cloudOpts)).toEqual([]);
  });
  it('mount targets sit directly under <their folder>/Teamspaces, with names the launcher accepts', async () => {
    const mounts = teamMounts(await teamFoldersFor(repo, 'ana', opts), '/app/data/workspaces/ana');
    expect(mounts[0]).toEqual({ source: teamFolderSource('t1', SLUG, 'general'), target: '/app/data/workspaces/ana/Teamspaces/General', rw: true });
    for (const m of mounts) expect(m.target.split('/').pop()).toMatch(/^[A-Za-z0-9 _-][A-Za-z0-9 ._-]{0,59}$/);
    expect(folderName('../../etc', 'x')).toBe('etc');
    expect(folderName('🙂', 'Teamspace')).toBe('Teamspace');
  });
});
