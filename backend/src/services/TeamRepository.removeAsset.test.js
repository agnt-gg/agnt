import sqlite3 from 'sqlite3';
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { TeamRepository } from './TeamRepository.js';

// bravo smoke test, Nov 2026: DELETE/PATCH/archive on /teams/:id/assets/:assetId were all 404,
// so anything put in the team library stayed forever.
let db, repo, team;
beforeEach(async () => {
  db = new sqlite3.Database(':memory:');
  repo = new TeamRepository(db);
  await repo.ready;
  team = await repo.create('owner', 'owner@example.com', 'Engineering');
});
afterEach(async () => {
  await repo.queue;
  await new Promise((resolve, reject) => db.close((error) => (error ? reject(error) : resolve())));
});
async function join(id, role = 'member') {
  const invite = await repo.invite(team.id, 'owner', id + '@example.com', role);
  await repo.accept(id, id + '@example.com', invite.token);
}
const save = (author, name = 'Brief') => repo.save(team.id, author, { name, kind: 'markdown', content: '# ' + name });

describe('deleting a team library asset', () => {
  it('its creator deletes it, with every revision, and the deletion is in the activity log', async () => {
    await join('editor');
    const asset = await save('editor');
    await repo.save(team.id, 'owner', { id: asset.id, name: 'Brief', kind: 'markdown', content: 'v2', expectedRevision: 1 });
    expect(await repo.removeAsset(team.id, 'editor', asset.id)).toEqual({ deleted: true, id: asset.id });
    await expect(repo.asset(team.id, 'editor', asset.id)).rejects.toMatchObject({ status: 404 });
    expect(await repo.all('SELECT * FROM team_asset_versions WHERE asset_id=?', [asset.id])).toEqual([]);
    expect((await repo.history(team.id, 'owner')).map((event) => event.action)).toContain('asset.deleted');
  });

  it("a member may not delete a teammate's asset, even one they have edited", async () => {
    await join('editor');
    await join('other');
    const asset = await save('other');
    await repo.save(team.id, 'editor', { id: asset.id, name: 'Brief', kind: 'markdown', content: 'edit', expectedRevision: 1 });
    await expect(repo.removeAsset(team.id, 'editor', asset.id)).rejects.toMatchObject({ status: 403 });
    expect((await repo.assets(team.id, 'owner')).map((row) => row.id)).toContain(asset.id);
  });

  it('owners and admins delete any asset; viewers and outsiders none', async () => {
    await join('editor');
    await join('boss', 'admin');
    await join('reader', 'viewer');
    const first = await save('editor', 'One');
    const second = await save('editor', 'Two');
    await expect(repo.removeAsset(team.id, 'reader', first.id)).rejects.toMatchObject({ status: 403 });
    await expect(repo.removeAsset(team.id, 'outsider', first.id)).rejects.toMatchObject({ status: 404 });
    await repo.removeAsset(team.id, 'boss', first.id);
    await repo.removeAsset(team.id, 'owner', second.id);
    expect(await repo.assets(team.id, 'owner')).toEqual([]);
  });

  it('cannot reach another team, a missing asset, or a teamspace doc', async () => {
    const asset = await save('owner');
    const otherTeam = await repo.create('owner', 'owner@example.com', 'Other');
    await expect(repo.removeAsset(otherTeam.id, 'owner', asset.id)).rejects.toMatchObject({ status: 404 });
    await expect(repo.removeAsset(team.id, 'owner', 'missing')).rejects.toMatchObject({ status: 404 });
    await repo.run('INSERT INTO space_docs VALUES(?,?,?,?)', [asset.id, 'ws', 'owner', new Date().toISOString()]);
    await expect(repo.removeAsset(team.id, 'owner', asset.id)).rejects.toMatchObject({ status: 404 });
  });

  it("refuses the published copy of a teamspace item instead of orphaning what runs it", async () => {
    const asset = await save('owner');
    await repo.run('CREATE TABLE IF NOT EXISTS team_native_resources(scope_id TEXT NOT NULL,kind TEXT NOT NULL,resource_id TEXT NOT NULL,asset_id TEXT NOT NULL REFERENCES team_assets(id),content_hash TEXT NOT NULL,PRIMARY KEY(scope_id,kind,resource_id))');
    await repo.run('INSERT INTO team_native_resources VALUES(?,?,?,?,?)', ['workspace:w', 'agent', 'a1', asset.id, 'hash']);
    await expect(repo.removeAsset(team.id, 'owner', asset.id)).rejects.toMatchObject({ status: 409 });
    expect((await repo.asset(team.id, 'owner', asset.id)).id).toBe(asset.id);
  });
});
