import sqlite3 from 'sqlite3';
import {
  afterEach,
  beforeEach,
  describe,
  it,
  expect
} from 'vitest';
import {
  TeamRepository
} from './TeamRepository.js';
let db, repo, team;
beforeEach(async () => {
  db = new sqlite3.Database(':memory:');
  repo = new TeamRepository(db);
  await repo.ready;
  team = await repo.create('owner', 'owner@example.com', 'Engineering')
});
afterEach(async () => {
  await repo.queue;
  await new Promise((r, j) => db.close(e => e ? j(e) : r()))
});
async function member(id = 'editor', role = 'member') {
  const invite = await repo.invite(team.id, 'owner', id + '@example.com', role);
  await repo.accept(id, id + '@example.com', invite.token);
  return invite
}
describe('team library authorization and persistence', () => {
  it('lists only teams containing the authenticated member', async () => {
    expect(await repo.list('outsider')).toEqual([]);
    expect(await repo.list('owner')).toHaveLength(1);
    await expect(repo.assets(team.id, 'outsider')).rejects.toMatchObject({
      status: 404
    })
  });
  it('requires invited identity, one-time token and expiry', async () => {
    const inv = await repo.invite(team.id, 'owner', 'viewer@example.com', 'viewer');
    await expect(repo.accept('wrong', 'wrong@example.com', inv.token)).rejects.toMatchObject({
      status: 403
    });
    await repo.accept('viewer', 'viewer@example.com', inv.token);
    await expect(repo.accept('again', 'viewer@example.com', inv.token)).rejects.toMatchObject({
      status: 404
    });
    const inv2 = await repo.invite(team.id, 'owner', 'late@example.com', 'viewer');
    await repo.run('UPDATE team_invites SET expires_at=0 WHERE id=?', [inv2.id]);
    await expect(repo.accept('late', 'late@example.com', inv2.token)).rejects.toMatchObject({
      status: 404
    })
  });
  it('stores only token hash and refuses duplicate pending invites', async () => {
    const inv = await repo.invite(team.id, 'owner', 'x@example.com', 'member');
    const row = await repo.get('SELECT * FROM team_invites WHERE id=?', [inv.id]);
    expect(JSON.stringify(row)).not.toContain(inv.token);
    await expect(repo.invite(team.id, 'owner', 'x@example.com', 'member')).rejects.toMatchObject({
      status: 409
    })
  });
  it('restricts invitations and revocation to admins', async () => {
    await member('editor');
    await expect(repo.invite(team.id, 'editor', 'x@example.com', 'admin')).rejects.toMatchObject({
      status: 403
    });
    const inv = await repo.invite(team.id, 'owner', 'x@example.com', 'admin');
    await repo.revoke(team.id, 'owner', inv.id);
    await expect(repo.accept('x', 'x@example.com', inv.token)).rejects.toMatchObject({
      status: 404
    })
  });
  it('allows viewers to read but not edit or administer', async () => {
    await member('viewer', 'viewer');
    const asset = await repo.save(team.id, 'owner', {
      name: 'Brief',
      kind: 'markdown',
      content: '# Shared'
    });
    expect((await repo.asset(team.id, 'viewer', asset.id)).content).toBe('# Shared');
    await expect(repo.save(team.id, 'viewer', {
      name: 'No',
      kind: 'text',
      content: 'x'
    })).rejects.toMatchObject({
      status: 403
    });
    await expect(repo.removeMember(team.id, 'viewer', 'owner')).rejects.toMatchObject({
      status: 403
    })
  });
  it('keeps immutable versions and rejects stale writes', async () => {
    await member();
    const a = await repo.save(team.id, 'owner', {
      name: 'One',
      kind: 'text',
      content: 'v1'
    });
    await repo.save(team.id, 'editor', {
      id: a.id,
      name: 'Two',
      kind: 'text',
      content: 'v2',
      expectedRevision: 1
    });
    expect((await repo.asset(team.id, 'owner', a.id, 1)).content).toBe('v1');
    expect((await repo.asset(team.id, 'owner', a.id)).content).toBe('v2');
    await expect(repo.save(team.id, 'owner', {
      id: a.id,
      name: 'Three',
      kind: 'text',
      content: 'lost',
      expectedRevision: 1
    })).rejects.toMatchObject({
      status: 409
    });
    expect((await repo.asset(team.id, 'owner', a.id)).content).toBe('v2')
  });
  it('has exactly one winner on concurrent edits', async () => {
    const a = await repo.save(team.id, 'owner', {
      name: 'A',
      kind: 'text',
      content: 'v1'
    });
    const results = await Promise.allSettled(['first', 'second'].map(content => repo.save(team.id, 'owner', {
      id: a.id,
      name: 'A',
      kind: 'text',
      content,
      expectedRevision: 1
    })));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(r => r.status === 'rejected').reason.status).toBe(409);
    expect((await repo.asset(team.id, 'owner', a.id)).revision).toBe(2)
  });
  it('revokes access immediately while retaining shared resources', async () => {
    await member();
    const a = await repo.save(team.id, 'editor', {
      name: 'Owned by team',
      kind: 'text',
      content: 'kept'
    });
    await repo.removeMember(team.id, 'owner', 'editor');
    await expect(repo.asset(team.id, 'editor', a.id)).rejects.toMatchObject({
      status: 404
    });
    expect((await repo.asset(team.id, 'owner', a.id)).content).toBe('kept');
    await expect(repo.removeMember(team.id, 'owner', 'owner')).rejects.toMatchObject({
      status: 409
    })
  });
  it('cannot cross team boundaries using a known asset ID', async () => {
    const second = await repo.create('second', 'second@example.com', 'Another');
    const a = await repo.save(team.id, 'owner', {
      name: 'Secret',
      kind: 'text',
      content: 'private'
    });
    await expect(repo.asset(second.id, 'second', a.id)).rejects.toMatchObject({
      status: 404
    });
    await expect(repo.save(second.id, 'second', {
      id: a.id,
      expectedRevision: 1,
      name: 'Overwrite',
      kind: 'text',
      content: 'x'
    })).rejects.toMatchObject({
      status: 404
    })
  });
  it('rejects arbitrary file references, invalid roles and oversized payloads', async () => {
    await expect(repo.save(team.id, 'owner', {
      name: 'File',
      kind: 'file-path',
      content: 'C:/secret'
    })).rejects.toMatchObject({
      status: 400
    });
    await expect(repo.save(team.id, 'owner', {
      name: 'Huge',
      kind: 'text',
      content: 'x'.repeat(200001)
    })).rejects.toMatchObject({
      status: 400
    });
    await expect(repo.invite(team.id, 'owner', 'x@example.com', 'owner')).rejects.toMatchObject({
      status: 400
    })
  });
  it('records attributable changes and never leaks content into event log', async () => {
    const a = await repo.save(team.id, 'owner', {
      name: 'Secret',
      kind: 'text',
      content: 'secret-token'
    });
    const events = await repo.history(team.id, 'owner');
    expect(events.some(e => e.actor_id === 'owner' && e.target_id === a.id)).toBe(true);
    expect(JSON.stringify(events)).not.toContain('secret-token')
  });
});
