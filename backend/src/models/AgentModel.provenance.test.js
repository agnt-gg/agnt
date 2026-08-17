/**
 * Saving an agent must not forget what the row already knew.
 *
 * WHY THIS EXISTS
 * ---------------
 * AgentModel.createOrUpdate wrote the row with `INSERT OR REPLACE`. In SQLite
 * that is not an update — it DELETES the conflicting row and INSERTs a new one,
 * so every column the statement does not name silently reverts to its schema
 * DEFAULT. The statement named 20 of the 25 columns on `agents`. The five it
 * missed were exactly the ones nothing in the payload carries, because they are
 * not user input — they are the row's provenance:
 *
 *   created_at       -> reset to now. An agent made in 2026-07 reported today.
 *   source_plugin    -> NULL. A plugin-installed agent forgot who installed it.
 *   is_user_modified -> 0. The PRD-057 "user has touched this" flag.
 *   insight_version  -> 0. The evolution counter AgentApplicator increments.
 *   deleted_at       -> NULL. A soft-deleted agent came back from the dead.
 *
 * Two of those did more than lose data, they disabled a feature outright:
 *
 *   1. AgentService flips the PRD-057 flag right after saving, with
 *      `UPDATE agents SET is_user_modified = 1 WHERE id = ? AND source_plugin
 *      IS NOT NULL`. The save had just nulled source_plugin, so the WHERE could
 *      never match and the flag could never be set. The statement meant to
 *      record the edit was defeated by the edit.
 *   2. AgentApplicator._applySkillRecommendation saves the agent and then does
 *      `insight_version = COALESCE(insight_version, 0) + 1`. Zeroed first,
 *      incremented second — so the counter was pinned at 1 forever. Observed on
 *      a live install: every agent row read insight_version = 0.
 *
 * THE FIX is not "name the other five columns". That is the same trap with a
 * longer fuse: `agents` has gained columns by migration five times, and each
 * one silently joins the forgotten set. The statement is now an UPSERT
 * (INSERT ... ON CONFLICT(id) DO UPDATE SET ...), which touches ONLY the
 * columns it names. Unnamed columns are left alone by construction, so a future
 * migration cannot re-open this hole.
 *
 * The last test in this file is a ratchet: it enumerates the live schema and
 * fails when a new column is neither written nor consciously preserved.
 *
 * Runs against a throwaway AGNT_HOME — never touches the user's database.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';

let db;
let AgentModel;
let TMP;
const savedEnv = {};

const USER = 'user-prov-1';

const getRow = (id) => new Promise((resolve, reject) => {
  db.get('SELECT * FROM agents WHERE id = ?', [id], (err, row) => (err ? reject(err) : resolve(row)));
});

const getResources = (id) => new Promise((resolve, reject) => {
  db.get('SELECT * FROM agent_resources WHERE agent_id = ?', [id], (err, row) => (err ? reject(err) : resolve(row)));
});

const run = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function (err) { return err ? reject(err) : resolve(this.changes); });
});

const columnsOf = (table) => new Promise((resolve, reject) => {
  db.all(`PRAGMA table_info(${table})`, [], (err, rows) => (err ? reject(err) : resolve(rows.map((r) => r.name))));
});

const agentPayload = (over = {}) => ({
  name: 'Annie',
  description: 'personal assistant',
  status: 'active',
  icon: null,
  category: 'Personal',
  assignedTools: ['buzz_whoami'],
  assignedWorkflows: [],
  provider: 'Claude-Code',
  model: 'claude-opus-5',
  systemPrompt: 'Be helpful.',
  assignedSkills: [],
  toolAccessMode: 'restricted',
  fallbackProviders: [],
  fallbackEnabled: false,
  routingMode: null,
  creditLimit: 1000,
  creditsUsed: 0,
  ...over,
});

/** Create a row, then stamp the provenance a real install would carry. */
const seedAgent = async (id, provenance = {}) => {
  await AgentModel.createOrUpdate(id, agentPayload(), USER);
  const {
    created_at = '2026-07-26 14:18:07',
    source_plugin = null,
    is_user_modified = 0,
    insight_version = 0,
    deleted_at = null,
  } = provenance;
  await run(
    `UPDATE agents SET created_at = ?, source_plugin = ?, is_user_modified = ?, insight_version = ?, deleted_at = ?
     WHERE id = ?`,
    [created_at, source_plugin, is_user_modified, insight_version, deleted_at, id]
  );
};

beforeAll(async () => {
  TMP = await fsp.mkdtemp(path.join(os.tmpdir(), 'agnt-prov-'));
  for (const k of ['AGNT_HOME', 'USER_DATA_PATH', 'DOCKER_CONTAINER']) savedEnv[k] = process.env[k];
  delete process.env.USER_DATA_PATH;
  delete process.env.DOCKER_CONTAINER;
  process.env.AGNT_HOME = TMP;

  // Pre-create an empty agnt.db: the bootstrap treats "AGNT_HOME set but no
  // agnt.db" as a fresh install that should inherit an orphaned database, and
  // would try to copy the developer's real database into temp.
  const dataDir = path.join(TMP, '.agnt', 'data');
  await fsp.mkdir(dataDir, { recursive: true });
  await fsp.writeFile(path.join(dataDir, 'agnt.db'), '');

  const dbMod = await import('./database/index.js');
  db = dbMod.default;
  await dbMod.dbReady;

  AgentModel = (await import('./AgentModel.js')).default;

  await run('INSERT INTO users (id, email) VALUES (?, ?)', [USER, `${USER}@test.local`]);
}, 120000);

afterAll(async () => {
  await new Promise((r) => db.close(r));
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await fsp.rm(TMP, { recursive: true, force: true }).catch(() => {});
});

describe('an edit preserves the row provenance', () => {
  it('keeps created_at — editing an agent is not creating one', async () => {
    const id = 'prov-created-at';
    await seedAgent(id, { created_at: '2026-07-26 14:18:07' });

    await AgentModel.createOrUpdate(id, agentPayload({ model: 'claude-sonnet-5' }), USER);

    expect((await getRow(id)).created_at).toBe('2026-07-26 14:18:07');
  });

  it('keeps source_plugin — an edit does not orphan a plugin-installed agent', async () => {
    const id = 'prov-source-plugin';
    await seedAgent(id, { source_plugin: 'buzz-cli-plugin' });

    await AgentModel.createOrUpdate(id, agentPayload({ name: 'renamed' }), USER);

    expect((await getRow(id)).source_plugin).toBe('buzz-cli-plugin');
  });

  it('lets the PRD-057 flag actually be set after a save', async () => {
    // The exact statement AgentService runs after createOrUpdate. It is guarded
    // by source_plugin, which the old save had just erased — so this UPDATE
    // matched zero rows and the flag stayed 0 forever.
    const id = 'prov-prd057';
    await seedAgent(id, { source_plugin: 'buzz-cli-plugin', is_user_modified: 0 });

    await AgentModel.createOrUpdate(id, agentPayload({ name: 'user renamed me' }), USER);
    const changes = await run(
      'UPDATE agents SET is_user_modified = 1 WHERE id = ? AND source_plugin IS NOT NULL',
      [id]
    );

    expect(changes).toBe(1);
    expect((await getRow(id)).is_user_modified).toBe(1);
  });

  it('keeps is_user_modified once it is set', async () => {
    const id = 'prov-user-modified';
    await seedAgent(id, { source_plugin: 'buzz-cli-plugin', is_user_modified: 1 });

    await AgentModel.createOrUpdate(id, agentPayload({ description: 'edited again' }), USER);

    expect((await getRow(id)).is_user_modified).toBe(1);
  });

  it('keeps insight_version — the evolution counter is not reset by a save', async () => {
    const id = 'prov-insight';
    await seedAgent(id, { insight_version: 7 });

    // What AgentApplicator._applySkillRecommendation does: save, then increment.
    await AgentModel.createOrUpdate(id, agentPayload({ assignedSkills: ['s1'] }), USER);
    await run('UPDATE agents SET insight_version = COALESCE(insight_version, 0) + 1 WHERE id = ?', [id]);

    expect((await getRow(id)).insight_version).toBe(8);
  });

  it('does not resurrect a soft-deleted agent', async () => {
    const id = 'prov-deleted';
    await seedAgent(id, { deleted_at: '2026-08-01 09:00:00' });

    await AgentModel.createOrUpdate(id, agentPayload(), USER);

    expect((await getRow(id)).deleted_at).toBe('2026-08-01 09:00:00');
  });
});

describe('an edit still edits', () => {
  it('writes every field the caller supplied', async () => {
    const id = 'prov-still-writes';
    await seedAgent(id);

    await AgentModel.createOrUpdate(id, agentPayload({
      name: 'New Name',
      description: 'new description',
      status: 'inactive',
      category: 'Work',
      provider: 'GrokAI',
      model: 'grok-4.5',
      systemPrompt: 'new prompt',
      assignedTools: ['x', 'y'],
      assignedWorkflows: ['wf1'],
      assignedSkills: ['sk1'],
      toolAccessMode: 'open',
      fallbackEnabled: true,
      fallbackProviders: [{ provider: 'Cursor', model: 'cursor-grok-4.5-high' }],
    }), USER);

    const row = await getRow(id);
    expect(row.name).toBe('New Name');
    expect(row.description).toBe('new description');
    expect(row.status).toBe('inactive');
    expect(row.category).toBe('Work');
    expect(row.provider).toBe('GrokAI');
    expect(row.model).toBe('grok-4.5');
    expect(row.system_prompt).toBe('new prompt');
    expect(JSON.parse(row.tools)).toEqual(['x', 'y']);
    expect(JSON.parse(row.workflows)).toEqual(['wf1']);
    expect(JSON.parse(row.skills)).toEqual(['sk1']);
    expect(row.tool_access_mode).toBe('open');
    expect(row.fallback_enabled).toBe(1);
    expect(JSON.parse(row.fallback_providers)).toEqual([{ provider: 'Cursor', model: 'cursor-grok-4.5-high' }]);
  });

  it('moves updated_at', async () => {
    const id = 'prov-updated-at';
    await seedAgent(id);
    await run("UPDATE agents SET updated_at = '2020-01-01 00:00:00' WHERE id = ?", [id]);

    await AgentModel.createOrUpdate(id, agentPayload({ name: 'touched' }), USER);

    expect((await getRow(id)).updated_at).not.toBe('2020-01-01 00:00:00');
  });

  it('still updates the resource row', async () => {
    const id = 'prov-resources-update';
    await seedAgent(id);

    await AgentModel.createOrUpdate(id, agentPayload({ creditLimit: 4321, creditsUsed: 99 }), USER);

    const res = await getResources(id);
    expect(res.credit_limit).toBe(4321);
    expect(res.credits_used).toBe(99);
  });
});

describe('a brand new agent', () => {
  it('gets a created_at of its own', async () => {
    const id = 'prov-new';
    await AgentModel.createOrUpdate(id, agentPayload(), USER);

    const row = await getRow(id);
    expect(row.created_at).toBeTruthy();
    // Same statement sets both on insert.
    expect(row.created_at).toBe(row.updated_at);
  });

  it('starts with clean provenance', async () => {
    const id = 'prov-new-clean';
    await AgentModel.createOrUpdate(id, agentPayload(), USER);

    const row = await getRow(id);
    expect(row.source_plugin).toBeNull();
    expect(row.deleted_at).toBeNull();
    expect(row.is_user_modified).toBe(0);
    expect(row.insight_version).toBe(0);
  });
});

describe('agent_resources has the same shape of bug', () => {
  it('keeps the columns the save does not carry', async () => {
    const id = 'prov-resources';
    await seedAgent(id);
    await run(
      "UPDATE agent_resources SET reset_period = 'monthly', last_reset = '2026-08-01 00:00:00' WHERE agent_id = ?",
      [id]
    );

    await AgentModel.createOrUpdate(id, agentPayload({ creditsUsed: 5 }), USER);

    const res = await getResources(id);
    expect(res.credits_used).toBe(5);
    expect(res.reset_period).toBe('monthly');
    expect(res.last_reset).toBe('2026-08-01 00:00:00');
  });
});

/**
 * RATCHET — the point of the whole file.
 *
 * This bug was not a typo, it was drift: `agents` gained columns by migration
 * and the write statement was never revisited. Enumerating the live schema
 * here means the next migration cannot quietly re-open the hole — a new column
 * must be listed as written or preserved, which forces the author to decide
 * which it is.
 */
describe('every column is accounted for', () => {
  // Columns the save legitimately writes from the caller's payload.
  const WRITTEN = new Set([
    'id', 'name', 'description', 'status', 'icon', 'category', 'tools', 'workflows',
    'provider', 'model', 'created_by', 'last_active', 'success_rate', 'system_prompt',
    'skills', 'tool_access_mode', 'fallback_providers', 'fallback_enabled',
    'routing_mode', 'updated_at',
  ]);

  // Columns that belong to the row, not the payload. A save must leave them be.
  const PRESERVED = new Set([
    'created_at', 'deleted_at', 'insight_version', 'source_plugin', 'is_user_modified',
  ]);

  it('agents: no column is neither written nor preserved', async () => {
    const unknown = (await columnsOf('agents')).filter((c) => !WRITTEN.has(c) && !PRESERVED.has(c));
    expect(unknown, `New column(s) on 'agents' that AgentModel.createOrUpdate neither writes nor preserves: ${unknown.join(', ')}. Add each to WRITTEN (and to the UPSERT's SET list) or to PRESERVED.`).toEqual([]);
  });

  it('agent_resources: no column is neither written nor preserved', async () => {
    const WRITTEN_RES = new Set(['agent_id', 'credit_limit', 'credits_used']);
    const PRESERVED_RES = new Set(['reset_period', 'last_reset']);
    const unknown = (await columnsOf('agent_resources')).filter((c) => !WRITTEN_RES.has(c) && !PRESERVED_RES.has(c));
    expect(unknown, `New column(s) on 'agent_resources' unaccounted for: ${unknown.join(', ')}.`).toEqual([]);
  });
});
