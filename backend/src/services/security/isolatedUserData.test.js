import { it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sqlite3 from 'sqlite3';
import { isolatedUserDataFor, closeIsolatedUserData, usesIsolatedUserData } from './isolatedUserData.js';

// The database step builds SQL around a caller-written condition. For a teamspace or a teammate it runs
// against an isolated per-owner file with ATTACH disabled, so no query can reach the instance database.
const roots = [];
const tempRoot = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-isolated-')); roots.push(dir); return dir; };
const run = (db, sql, args = []) => new Promise((resolve, reject) => db.run(sql, args, (error) => (error ? reject(error) : resolve())));
afterEach(async () => { await closeIsolatedUserData(); for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

it('refuses to attach any other database, so the instance database is unreachable', async () => {
  const store = await isolatedUserDataFor('scope:w', { root: tempRoot() });
  await expect(store.run("ATTACH DATABASE 'anything.db' AS other")).rejects.toThrow(/too many attached databases/);
});

it('keeps each owner in its own file, and copies an owner\'s existing rows over once', async () => {
  const instance = new sqlite3.Database(':memory:');
  await run(instance, 'CREATE TABLE user_data (id TEXT PRIMARY KEY, user_id TEXT, table_name TEXT, data JSON, created_at DATETIME, updated_at DATETIME)');
  await run(instance, "INSERT INTO user_data VALUES ('r1','scope:w','leads','{\"name\":\"Ada\"}',NULL,NULL),('r2','someone-else','leads','{\"name\":\"Bob\"}',NULL,NULL)");
  const root = tempRoot();
  const team = await isolatedUserDataFor('scope:w', { root, instanceDb: instance });
  expect((await team.all('SELECT id FROM user_data')).map((row) => row.id)).toEqual(['r1']);
  const other = await isolatedUserDataFor('scope:other', { root, instanceDb: instance });
  expect(await other.all('SELECT id FROM user_data')).toEqual([]);
  expect(team.file).not.toBe(other.file);
  await new Promise((resolve) => instance.close(resolve));
});

it('isolates teamspace data and teammates, never the owner\'s own data', () => {
  process.env.AGNT_TENANT_SLUG = 'bravo'; process.env.AGNT_TENANT_OWNER = 'owner-1'; process.env.AGNT_TENANT_MEMBERS = 'owner-1,member-2';
  try {
    expect(usesIsolatedUserData('scope:w', 'owner-1')).toBe(true);
    expect(usesIsolatedUserData('member-2', 'member-2')).toBe(true);
    expect(usesIsolatedUserData('owner-1', 'owner-1')).toBe(false);
  } finally { delete process.env.AGNT_TENANT_SLUG; delete process.env.AGNT_TENANT_OWNER; delete process.env.AGNT_TENANT_MEMBERS; }
});
