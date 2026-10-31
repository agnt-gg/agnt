import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sqlite3 from 'sqlite3';
import { NativeTeamResources } from './NativeTeamResources.js';

// Bravo, 2026-10-30: eight agents deleted on Oct 8 (deleted_at set) still showed
// in the team's agent list, because the team listing never read deleted_at.
let db, resources;
const scope = { id: 'workspace:1', resourceOwnerId: 'scope:team' };
const run = (sql, p = []) => new Promise((res, rej) => db.run(sql, p, (e) => (e ? rej(e) : res())));
const nativeOf = (d) => ({
  all: (sql, p) => new Promise((res, rej) => d.all(sql, p, (e, r) => (e ? rej(e) : res(r)))),
  get: (sql, p) => new Promise((res, rej) => d.get(sql, p, (e, r) => (e ? rej(e) : res(r)))),
});
// Only what list() reads from the team store; nothing here is published.
const teams = { run: async () => {}, get: async () => undefined };

beforeEach(async () => {
  db = new sqlite3.Database(':memory:');
  await run('CREATE TABLE agents(id TEXT, name TEXT, created_by TEXT, system_prompt TEXT, tools TEXT, workflows TEXT, skills TEXT, provider TEXT, model TEXT, deleted_at TEXT)');
  await run('CREATE TABLE workflows(id TEXT, name TEXT, user_id TEXT, workflow_data TEXT, deleted_at TEXT)');
  await run('CREATE TABLE tools(id TEXT, title TEXT, created_by TEXT, config TEXT, code TEXT, base TEXT)');
  await run("INSERT INTO agents(id,name,created_by,tools,workflows) VALUES('a1','Research Analyst','scope:team','[]','[]')");
  await run("INSERT INTO agents(id,name,created_by,tools,workflows,deleted_at) VALUES('a2','[sweep] agent','scope:team','[]','[]','2026-10-08 05:11:08')");
  await run(`INSERT INTO workflows(id,name,user_id,workflow_data) VALUES('w1','Live flow','scope:team','{"nodes":[]}')`);
  await run(`INSERT INTO workflows(id,name,user_id,workflow_data,deleted_at) VALUES('w2','Deleted flow','scope:team','{"nodes":[]}','2026-10-08')`);
  await run("INSERT INTO tools(id,title,created_by,config) VALUES('t1','A tool','scope:team','{}')");
  resources = new NativeTeamResources(nativeOf(db), teams);
});
afterEach(() => new Promise((res) => db.close(() => res())));

describe('deleted items are gone for the team too', () => {
  it('the team list shows only live agents and workflows', async () => {
    const names = (await resources.list(scope)).map((r) => r.name).sort();
    expect(names).toEqual(['A tool', 'Live flow', 'Research Analyst']);
  });
  it('a deleted agent or workflow cannot be looked up or published', async () => {
    await expect(resources.hints(scope, 'agent', 'a2')).rejects.toMatchObject({ status: 404 });
    await expect(resources.hints(scope, 'workflow', 'w2')).rejects.toMatchObject({ status: 404 });
    await expect(resources.snapshot('team', 'owner', scope, 'agent', 'a2')).rejects.toMatchObject({ status: 404 });
    await expect(resources.hints(scope, 'agent', 'a1')).resolves.toMatchObject({ provider: null });
  });
});
