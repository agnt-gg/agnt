/**
 * The free plan makes FREE_LIMITS.agents agents and FREE_LIMITS.workflows
 * workflows; a paid plan or the referral trial lifts both.
 *
 * Counted against a real (throwaway) database, because the count IS the rule:
 * what counts (live rows the account made) and what does not (deleted rows,
 * plugin installs, the built-in orchestrator row, other accounts) has to be
 * proven on the real schema, not a mock of it.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

let db;
let creationLimit;
let FREE_LIMITS;
let TMP;
const savedEnv = {};

const run = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, (err) => (err ? reject(err) : resolve())));
const agent = (id, owner, extra = {}) =>
  run(
    `INSERT INTO agents (id, name, status, created_by, source_plugin, deleted_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, id, extra.status || 'active', owner, extra.sourcePlugin || null, extra.deletedAt || null]
  );
const workflow = (id, owner, extra = {}) =>
  run(`INSERT INTO workflows (id, workflow_data, user_id, source_plugin, deleted_at) VALUES (?, '{}', ?, ?, ?)`, [id, owner, extra.sourcePlugin || null, extra.deletedAt || null]);

const free = { liftsLimits: async () => false };
const lifted = { liftsLimits: async () => true };

beforeAll(async () => {
  TMP = await fsp.mkdtemp(path.join(os.tmpdir(), 'agnt-create-limit-'));
  for (const k of ['AGNT_HOME', 'USER_DATA_PATH', 'DOCKER_CONTAINER']) savedEnv[k] = process.env[k];
  delete process.env.USER_DATA_PATH;
  delete process.env.DOCKER_CONTAINER;
  process.env.AGNT_HOME = TMP;
  // An empty agnt.db, so the bootstrap does not treat this as a fresh install
  // that should inherit the developer's real database (AgentModel.provenance.test.js).
  const dataDir = path.join(TMP, '.agnt', 'data');
  await fsp.mkdir(dataDir, { recursive: true });
  await fsp.writeFile(path.join(dataDir, 'agnt.db'), '');
  const dbModule = await import('../../models/database/index.js');
  db = dbModule.default;
  await dbModule.dbReady;
  creationLimit = await import('./creationLimit.js');
  ({ FREE_LIMITS } = await import('./planLimits.js'));
});

afterAll(async () => {
  await new Promise((resolve) => db.close(() => resolve()));
  for (const [k, v] of Object.entries(savedEnv)) (v === undefined ? delete process.env[k] : (process.env[k] = v));
  await fsp.rm(TMP, { recursive: true, force: true }).catch(() => {});
});

beforeEach(async () => {
  delete process.env.ENFORCE_PLAN_GATES;
  await run('DELETE FROM agent_resources');
  await run('DELETE FROM agents');
  await run('DELETE FROM workflows');
  // agents.created_by and workflows.user_id reference users(id).
  for (const id of ['u1', 'u2', 'u-no-licence']) await run('INSERT OR IGNORE INTO users (id, email) VALUES (?, ?)', [id, `${id}@test.local`]);
});

describe('what counts', () => {
  it('live agents the account made; never deleted, plugin-installed, system or other accounts', async () => {
    await agent('a1', 'u1');
    await agent('a2', 'u1');
    await agent('gone', 'u1', { deletedAt: '2026-11-01' });
    await agent('from-pack', 'u1', { sourcePlugin: 'sales-pack' });
    await agent('orchestrator', 'u1', { status: 'system' });
    await agent('theirs', 'u2');
    expect(await creationLimit.countOwned('agent', 'u1')).toBe(2);
  });
  it('live workflows the account made; never deleted, plugin-installed or other accounts', async () => {
    await workflow('w1', 'u1');
    await workflow('gone', 'u1', { deletedAt: '2026-11-01' });
    await workflow('from-pack', 'u1', { sourcePlugin: 'sales-pack' });
    await workflow('theirs', 'u2');
    expect(await creationLimit.countOwned('workflow', 'u1')).toBe(1);
  });
});

describe('the free plan', () => {
  it(`makes ${'agents'} up to the cap, then refuses the next with a 403 upgrade reason`, async () => {
    for (let i = 0; i < FREE_LIMITS.agents - 1; i++) await agent(`a${i}`, 'u1');
    await expect(creationLimit.assertCanCreate('agent', 'u1', free)).resolves.toBeUndefined();
    await agent('last', 'u1');
    await expect(creationLimit.assertCanCreate('agent', 'u1', free)).rejects.toMatchObject({ code: 'PLAN_LIMIT', limit: 'agents', status: 403 });
  });
  it('refuses a workflow past the cap the same way', async () => {
    for (let i = 0; i < FREE_LIMITS.workflows; i++) await workflow(`w${i}`, 'u1');
    await expect(creationLimit.assertCanCreate('workflow', 'u1', free)).rejects.toMatchObject({ code: 'PLAN_LIMIT', limit: 'workflows', status: 403 });
  });
  it('deleting one frees a slot', async () => {
    for (let i = 0; i < FREE_LIMITS.agents; i++) await agent(`a${i}`, 'u1');
    await run(`UPDATE agents SET deleted_at = '2026-11-02' WHERE id = 'a0'`);
    await expect(creationLimit.assertCanCreate('agent', 'u1', free)).resolves.toBeUndefined();
  });
  it('a plugin bringing its own agents never blocks the account from making its own', async () => {
    for (let i = 0; i < 10; i++) await agent(`pack-${i}`, 'u1', { sourcePlugin: 'big-pack' });
    await expect(creationLimit.assertCanCreate('agent', 'u1', free)).resolves.toBeUndefined();
  });
  it('an import of several at once is checked as a whole', async () => {
    await expect(creationLimit.assertCanCreate('workflow', 'u1', { ...free, count: FREE_LIMITS.workflows + 1 })).rejects.toMatchObject({ code: 'PLAN_LIMIT' });
  });
});

describe('paid and trial', () => {
  it('a paid plan or the referral trial makes as many as it likes', async () => {
    for (let i = 0; i < FREE_LIMITS.agents + 5; i++) await agent(`a${i}`, 'u1');
    await expect(creationLimit.assertCanCreate('agent', 'u1', lifted)).resolves.toBeUndefined();
  });
  it('the plan is only asked once the account is at the cap (no licence lookup per save)', async () => {
    let asked = 0;
    await creationLimit.assertCanCreate('agent', 'u1', { liftsLimits: async () => (asked++, false) });
    expect(asked).toBe(0);
  });
  it('with no verified licence at all, the free cap applies (unknown is never paid)', async () => {
    for (let i = 0; i < FREE_LIMITS.agents; i++) await agent(`a${i}`, 'u-no-licence');
    // The real liftsFreeLimits: no licence on disk and no session to fetch one.
    await expect(creationLimit.assertCanCreate('agent', 'u-no-licence')).rejects.toMatchObject({ code: 'PLAN_LIMIT' });
  });
  it('ENFORCE_PLAN_GATES=false (development) refuses nothing', async () => {
    process.env.ENFORCE_PLAN_GATES = 'false';
    for (let i = 0; i < FREE_LIMITS.agents; i++) await agent(`a${i}`, 'u1');
    await expect(creationLimit.assertCanCreate('agent', 'u1', free)).resolves.toBeUndefined();
  });
});

describe('the HTTP answer', () => {
  it('is a 403 with requiredFeature, the shape the app turns into an upgrade prompt', () => {
    const error = Object.assign(new Error('The free plan makes 3 agents.'), { code: 'PLAN_LIMIT', limit: 'agents' });
    expect(creationLimit.isPlanLimitError(error)).toBe(true);
    expect(creationLimit.planLimitResponse(error)).toEqual({ error: 'Upgrade required', message: 'The free plan makes 3 agents.', code: 'PLAN_LIMIT', limit: 'agents', requiredFeature: 'agents' });
    expect(creationLimit.isPlanLimitError(new Error('disk full'))).toBe(false);
  });
});
