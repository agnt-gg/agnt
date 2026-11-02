import { it, expect, beforeEach, afterEach } from 'vitest';
import sqlite3 from 'sqlite3';
import { databaseRepository } from './ScopeRepository.js';
import { recordCreator, creatorOf } from './ResourceCreators.js';
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

it('records nothing without an actor', async () => {
  await recordCreator(repository, 'agents', 'a1', '');
  expect(await creatorOf(repository, 'agents', 'a1')).toBeNull();
});
