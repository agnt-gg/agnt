/**
 * Node attribution on real ledger rows.
 *
 * ledgerContracts GUARD 8 is a source scan — it proves the code SAYS the right
 * thing. This proves the column actually receives it, which is the half a
 * static scan cannot reach: a parameter list and a VALUES list that drift by
 * one produce code that reads correctly and writes the wrong column.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import db, { dbReady } from '../../models/database/index.js';
import { recordLlmCall } from './LedgerRecorder.js';
import { getNodeId } from '../cluster/nodeIdentity.js';
import generateUUID from '../../utils/generateUUID.js';

const dbGet = (sql, params = []) =>
  new Promise((resolve, reject) => db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row))));

const dbRun = (sql, params = []) =>
  new Promise((resolve, reject) =>
    db.run(sql, params, function (err) {
      return err ? reject(err) : resolve(this);
    })
  );

const USER = 'user-ledger-node';

const usage = { inputTokens: 100, outputTokens: 50 };

beforeAll(async () => {
  await dbReady;
  await dbRun(`INSERT OR IGNORE INTO users (id, email, name) VALUES (?, ?, ?)`, [
    USER,
    `${USER}@test.local`,
    USER,
  ]);
});

describe('recordLlmCall', () => {
  it('stamps this node by default', async () => {
    const id = await recordLlmCall({
      userId: USER,
      origin: 'orchestrator',
      provider: 'anthropic',
      model: 'claude-sonnet-4-5-20250929',
      usage,
    });

    const row = await dbGet(`SELECT node_id, cost_usd FROM llm_calls WHERE id = ?`, [id]);
    expect(row.node_id).toBe(getNodeId());
    // Sanity: the row is a normal, priced ledger row and not a degenerate one
    // that happens to carry a node id.
    expect(row.cost_usd).toBeGreaterThan(0);
  });

  it('honours an explicit node id, so a primary can record a worker\u2019s spend', async () => {
    // The case that makes nodeId a parameter rather than a hard-coded call:
    // when a worker reports usage, the PRIMARY writes the row for money that
    // was spent somewhere else.
    const id = await recordLlmCall({
      userId: USER,
      origin: 'goal_task',
      originId: generateUUID(),
      provider: 'anthropic',
      model: 'claude-sonnet-4-5-20250929',
      usage,
      nodeId: 'node_remote_worker',
    });

    const row = await dbGet(`SELECT node_id FROM llm_calls WHERE id = ?`, [id]);
    expect(row.node_id).toBe('node_remote_worker');
    expect(row.node_id).not.toBe(getNodeId());
  });

  it('does not disturb the columns the ledger already guarantees', async () => {
    const id = await recordLlmCall({
      userId: USER,
      origin: 'orchestrator',
      provider: 'definitely-not-a-real-provider',
      model: 'unpriceable',
      usage,
    });

    const row = await dbGet(`SELECT cost_usd, uncached_cost_usd, is_notional FROM llm_calls WHERE id = ?`, [id]);
    // NULL, never 0 — adding a column must not shift the VALUES list and turn
    // "unknown price" into "free", which is the exact defect this table was
    // created to fix.
    expect(row.cost_usd).toBeNull();
    expect(row.uncached_cost_usd).toBeNull();
    expect(row.is_notional).toBe(0);
  });
});

describe('findByOriginSince — what a worker reports upstream', () => {
  it('returns only rows for that origin, after that instant', async () => {
    const goalId = generateUUID();
    const before = new Date().toISOString().replace('T', ' ').slice(0, 19);

    await recordLlmCall({
      userId: USER,
      origin: 'goal_task',
      originId: goalId,
      provider: 'anthropic',
      model: 'claude-sonnet-4-5-20250929',
      usage,
    });
    // A different goal must not be swept into this task's report.
    await recordLlmCall({
      userId: USER,
      origin: 'goal_task',
      originId: generateUUID(),
      provider: 'anthropic',
      model: 'claude-sonnet-4-5-20250929',
      usage,
    });

    const LlmCallModel = (await import('../../models/LlmCallModel.js')).default;
    const rows = await LlmCallModel.findByOriginSince(USER, 'goal_task', goalId, before);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ provider: 'anthropic', input_tokens: 100, output_tokens: 50 });
  });

  it('returns nothing for a window that has not happened yet', async () => {
    const LlmCallModel = (await import('../../models/LlmCallModel.js')).default;
    const future = new Date(Date.now() + 86400000).toISOString().replace('T', ' ').slice(0, 19);
    expect(await LlmCallModel.findByOriginSince(USER, 'goal_task', 'anything', future)).toEqual([]);
  });
});
