import { it, expect, beforeEach, afterEach } from 'vitest';
import sqlite3 from 'sqlite3';
import { databaseRepository } from './ScopeRepository.js';
import { recordCreator, creatorOf, recordRunActor, runActorOf, recordTeamRunner, asRecordedRunner } from './ResourceCreators.js';
import { withScopeRequest } from './ScopeRequestContext.js';
import { currentToolActor, currentToolAuthorization } from '../security/toolRunAuthority.js';
import { vi } from 'vitest';
import { inspectOwnershipInventory } from './OwnershipInventory.js';

let db, repository;
beforeEach(() => { db = new sqlite3.Database(':memory:'); repository = databaseRepository(db); });
afterEach(() => new Promise((resolve, reject) => db.close((error) => (error ? reject(error) : resolve()))));

it('remembers who created a resource', async () => {
  await recordCreator(repository, 'agents', 'a1', 'member-2');
  expect(await creatorOf(repository, 'agents', 'a1')).toBe('member-2');
});

it('keeps the first creator: a later save by someone else does not claim it', async () => {
  await recordCreator(repository, 'agents', 'a1', 'member-2');
  await recordCreator(repository, 'agents', 'a1', 'member-3');
  expect(await creatorOf(repository, 'agents', 'a1')).toBe('member-2');
});

it('answers null for an unrecorded resource, and keys by table as well as id', async () => {
  await recordCreator(repository, 'agents', 'a1', 'member-2');
  expect(await creatorOf(repository, 'agents', 'unknown')).toBeNull();
  expect(await creatorOf(repository, 'workflows', 'a1')).toBeNull();
});

// Startup refuses any table the ownership inventory does not classify (OwnershipMigration). This table
// is created lazily, on the first teamspace agent, so a live instance ran fine until its next restart.
it('the table it creates is classified, so the next startup migration accepts it', async () => {
  await recordCreator(repository, 'agents', 'a1', 'member-2');
  const { tables } = await inspectOwnershipInventory(repository);
  expect(tables.find((entry) => entry.table === 'scope_resource_creators')).toMatchObject({ kind: 'system', status: 'classified' });
});

it('remembers who last switched a teamspace item on; the latest wins', async () => {
  await recordRunActor(repository, 'workflows', 'w1', 'owner-1');
  await recordRunActor(repository, 'workflows', 'w1', 'member-2');
  expect(await runActorOf(repository, 'workflows', 'w1')).toBe('member-2');
  expect(await runActorOf(repository, 'goals', 'w1')).toBeNull();
  const { tables } = await inspectOwnershipInventory(repository);
  expect(tables.find((entry) => entry.table === 'scope_run_actors')).toMatchObject({ kind: 'system', status: 'classified' });
});

it('records the verified person behind a teamspace change, never a guess', async () => {
  await withScopeRequest({}, { actorId: 'member-2', resourceOwnerId: 'scope:w' }, () => recordTeamRunner(repository, 'goals', 'g1', 'scope:w'));
  await recordTeamRunner(repository, 'goals', 'g2', 'scope:w');
  await recordTeamRunner(repository, 'goals', 'g3', 'member-2');
  expect([await runActorOf(repository, 'goals', 'g1'), await runActorOf(repository, 'goals', 'g2'), await runActorOf(repository, 'goals', 'g3')]).toEqual(['member-2', null, null]);
});

it("runs work with no request (a schedule, a resume) as the recorded teammate, with that teammate's run token", async () => {
  vi.stubEnv('AGNT_TENANT_SLUG', 'bravo'); vi.stubEnv('AGNT_TENANT_OWNER', 'owner-1'); vi.stubEnv('AGNT_TENANT_MEMBERS', 'owner-1,member-2'); vi.stubEnv('JWT_SECRET', 'x'.repeat(64));
  try {
    await recordRunActor(repository, 'goals', 'g1', 'member-2');
    const seen = await asRecordedRunner(repository, 'goals', 'g1', 'scope:w', () => [currentToolActor(), currentToolAuthorization()]);
    expect(seen[0]).toBe('member-2');
    expect(seen[1]).toMatch(/^Bearer agnt-tool\./);
    expect(await asRecordedRunner(repository, 'goals', 'unrecorded', 'scope:w', () => currentToolActor() ?? 'unchanged')).toBe('unchanged');
    expect(await asRecordedRunner(repository, 'goals', 'g1', 'member-2', () => currentToolActor() ?? 'unchanged')).toBe('unchanged');
  } finally { vi.unstubAllEnvs(); }
});

it('records nothing without an actor', async () => {
  await recordCreator(repository, 'agents', 'a1', '');
  expect(await creatorOf(repository, 'agents', 'a1')).toBeNull();
});
