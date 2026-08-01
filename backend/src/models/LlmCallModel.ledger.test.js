/**
 * End-to-end integration gate for the execution ledger (PRD-122).
 *
 * The unit spec proves the recorder's logic. This proves the WIRING: real
 * sqlite3, real schema, real migrations, through the exact queries the
 * dashboard and the goal detail view call.
 *
 * It is the test that would have caught the two defects this PRD was filed
 * against — `0 as estimated_cost` in the activity rollup, and goal cost being
 * summed from evaluations only.
 *
 * Runs against a throwaway AGNT_HOME — never touches the user's database.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';

let db;
let ExecutionModel;
let LlmCallModel;
let AgentExecutionModel;
let recordLlmCall;
let getModelCost;

let TMP;
const savedEnv = {};

const dbRun = (sql, params = []) =>
  new Promise((res, rej) => db.run(sql, params, function (e) { e ? rej(e) : res(this); }));
const dbGet = (sql, params = []) =>
  new Promise((res, rej) => db.get(sql, params, (e, r) => (e ? rej(e) : res(r))));
const dbAll = (sql, params = []) =>
  new Promise((res, rej) => db.all(sql, params, (e, r) => (e ? rej(e) : res(r || []))));

const USER = 'user-ledger-e2e';
const WORKFLOW = 'wf-ledger';
const PRICED = { provider: 'anthropic', model: 'claude-sonnet-4-5-20250929' };
const UNPRICED = { provider: 'zzz-not-a-provider', model: 'nope-model' };

// Wide, date-only bounds. workflow_executions.start_time is an ISO string with
// a 'T'; llm_calls.ts is 'YYYY-MM-DD HH:MM:SS'. Space (0x20) sorts before 'T',
// so date-only bounds bracket both formats correctly.
const RANGE = ['2000-01-01', '2999-12-31'];

beforeAll(async () => {
  TMP = await fsp.mkdtemp(path.join(os.tmpdir(), 'agnt-ledger-'));
  for (const k of ['AGNT_HOME', 'USER_DATA_PATH', 'DOCKER_CONTAINER']) savedEnv[k] = process.env[k];
  delete process.env.USER_DATA_PATH;
  delete process.env.DOCKER_CONTAINER;
  process.env.AGNT_HOME = TMP;

  // Pre-create an empty agnt.db: the bootstrap treats "AGNT_HOME set but no
  // agnt.db" as a fresh install that should inherit an orphaned database, and
  // would try to copy the developer's real (large) database into temp.
  const dataDir = path.join(TMP, '.agnt', 'data');
  await fsp.mkdir(dataDir, { recursive: true });
  await fsp.writeFile(path.join(dataDir, 'agnt.db'), '');

  const dbMod = await import('./database/index.js');
  db = dbMod.default;
  await dbMod.dbReady;

  ExecutionModel = (await import('./ExecutionModel.js')).default;
  LlmCallModel = (await import('./LlmCallModel.js')).default;
  AgentExecutionModel = (await import('./AgentExecutionModel.js')).default;
  ({ recordLlmCall } = await import('../services/execution/LedgerRecorder.js'));
  ({ getModelCost } = await import('../services/ai/providerConfigs.js'));

  await dbRun('INSERT OR IGNORE INTO users (id, email, name) VALUES (?, ?, ?)', [
    USER, 'ledger-e2e@test.local', 'Ledger E2E',
  ]);
  await dbRun('INSERT OR IGNORE INTO workflows (id, workflow_data, user_id) VALUES (?, ?, ?)', [
    WORKFLOW, JSON.stringify({ nodes: [], edges: [] }), USER,
  ]);
}, 120000);

afterAll(async () => {
  await new Promise((r) => db.close(r));
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await fsp.rm(TMP, { recursive: true, force: true }).catch(() => {});
});

describe('schema', () => {
  it('creates llm_calls with all four indexes', async () => {
    const t = await dbGet(`SELECT name FROM sqlite_master WHERE type='table' AND name='llm_calls'`);
    expect(t).toBeTruthy();

    const idx = await dbAll(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='llm_calls'`);
    const names = idx.map((r) => r.name);
    for (const want of [
      'idx_llm_calls_user_ts', 'idx_llm_calls_execution',
      'idx_llm_calls_root', 'idx_llm_calls_origin',
    ]) {
      expect(names).toContain(want);
    }
  });

  it('adds the run-tree columns to agent_executions', async () => {
    const cols = (await dbAll(`PRAGMA table_info(agent_executions)`)).map((c) => c.name);
    expect(cols).toContain('parent_execution_id');
    expect(cols).toContain('root_execution_id');
    expect(cols).toContain('origin');
  });
});

describe('recorder → database', () => {
  it('persists the cost getModelCost computes', async () => {
    await recordLlmCall({
      userId: USER, origin: 'chat', ...PRICED,
      usage: { inputTokens: 10000, outputTokens: 2000, cacheReadTokens: 8000 },
    });

    const row = await dbGet(
      `SELECT * FROM llm_calls WHERE user_id = ? AND origin = 'chat' ORDER BY rowid DESC LIMIT 1`, [USER]
    );
    const expected = getModelCost(PRICED.provider, PRICED.model, 10000, 2000, {
      cacheReadTokens: 8000, cacheCreation5mTokens: 0, cacheCreation1hTokens: 0,
    });
    expect(row.cost_usd).toBeCloseTo(expected.totalCost, 12);
    expect(row.input_tokens).toBe(10000);
    expect(row.cache_read_tokens).toBe(8000);
  });

  it('stores NULL — not 0 — for an unpriceable model, and surfaces it as an unpriced count', async () => {
    await recordLlmCall({
      userId: USER, origin: 'chat', ...UNPRICED, usage: { inputTokens: 100, outputTokens: 10 },
    });

    const row = await dbGet(
      `SELECT cost_usd FROM llm_calls WHERE provider = ? ORDER BY rowid DESC LIMIT 1`, [UNPRICED.provider]
    );
    expect(row.cost_usd).toBeNull();

    const totals = await LlmCallModel.summary(USER);
    expect(totals.unpricedCalls).toBeGreaterThanOrEqual(1);
  });
});

describe('the activity rollup counts what it used to zero out', () => {
  it('reports non-zero cost for a workflow day (regression: `0 as estimated_cost`)', async () => {
    const execId = await ExecutionModel.create(WORKFLOW, USER, 'Ledger Workflow');

    const before = await ExecutionModel._computeActivityRaw(USER, ...RANGE);
    const beforeCost = before.reduce((s, r) => s + (r.estimated_cost || 0), 0);

    await recordLlmCall({
      userId: USER, origin: 'workflow_node', originId: execId, ...PRICED,
      usage: { inputTokens: 50000, outputTokens: 5000 },
    });

    const after = await ExecutionModel._computeActivityRaw(USER, ...RANGE);
    const afterCost = after.reduce((s, r) => s + (r.estimated_cost || 0), 0);

    const expected = getModelCost(PRICED.provider, PRICED.model, 50000, 5000).totalCost;
    expect(afterCost - beforeCost).toBeCloseTo(expected, 10);
    expect(afterCost).toBeGreaterThan(0);
  });

  it('includes goal spend, which belonged to neither original branch', async () => {
    const before = await ExecutionModel._computeActivityRaw(USER, ...RANGE);
    const beforeCost = before.reduce((s, r) => s + (r.estimated_cost || 0), 0);

    await recordLlmCall({
      userId: USER, origin: 'goal_task', originId: 'goal-rollup', ...PRICED,
      usage: { inputTokens: 20000, outputTokens: 1000 },
    });

    const after = await ExecutionModel._computeActivityRaw(USER, ...RANGE);
    const afterCost = after.reduce((s, r) => s + (r.estimated_cost || 0), 0);

    const expected = getModelCost(PRICED.provider, PRICED.model, 20000, 1000).totalCost;
    expect(afterCost - beforeCost).toBeCloseTo(expected, 10);
  });

  it('does not double-count an orchestrator turn that already has an execution row', async () => {
    const execId = await AgentExecutionModel.create(
      USER, null, 'Chat', 'conv-nodup', 'hi', PRICED.provider, PRICED.model, 'running'
    );
    // The orchestrator writes BOTH agent_executions.estimated_cost and a ledger
    // row. The rollup must count that spend exactly once.
    await AgentExecutionModel.update(execId, 'completed', 'ok', 1, 0, null, {
      inputTokens: 1000, outputTokens: 100, totalTokens: 1100, estimatedCost: 0.5,
    });

    const before = await ExecutionModel._computeActivityRaw(USER, ...RANGE);
    const beforeCost = before.reduce((s, r) => s + (r.estimated_cost || 0), 0);

    await recordLlmCall({
      userId: USER, origin: 'chat', executionId: execId, ...PRICED,
      usage: { inputTokens: 1000, outputTokens: 100 },
    });

    const after = await ExecutionModel._computeActivityRaw(USER, ...RANGE);
    const afterCost = after.reduce((s, r) => s + (r.estimated_cost || 0), 0);

    // Ledger rows carrying an execution_id are excluded from the third branch
    // precisely because agent_executions already accounts for them.
    expect(afterCost).toBeCloseTo(beforeCost, 10);
  });
});

describe('goal cost comes from tasks AND evaluations', () => {
  it('sums both, where the old query saw only evaluations', async () => {
    const goalId = 'goal-summary-1';

    await recordLlmCall({
      userId: USER, origin: 'goal_task', originId: goalId, ...PRICED,
      usage: { inputTokens: 30000, outputTokens: 3000 },
    });
    await recordLlmCall({
      userId: USER, origin: 'goal_eval', originId: goalId, ...PRICED,
      usage: { inputTokens: 4000, outputTokens: 400 },
    });

    const totals = await LlmCallModel.summaryForGoal(goalId);
    const taskCost = getModelCost(PRICED.provider, PRICED.model, 30000, 3000).totalCost;
    const evalCost = getModelCost(PRICED.provider, PRICED.model, 4000, 400).totalCost;

    expect(totals.calls).toBe(2);
    expect(totals.costUsd).toBeCloseTo(taskCost + evalCost, 10);
    // The defect being pinned: task spend dominates, and it used to be omitted.
    expect(totals.costUsd).toBeGreaterThan(evalCost * 2);
  });

  it('a goal with tasks but no evaluations reports non-zero cost (false before this PRD)', async () => {
    const goalId = 'goal-tasks-only';
    await recordLlmCall({
      userId: USER, origin: 'goal_task', originId: goalId, ...PRICED,
      usage: { inputTokens: 12000, outputTokens: 900 },
    });
    const totals = await LlmCallModel.summaryForGoal(goalId);
    expect(totals.costUsd).toBeGreaterThan(0);
  });
});

describe('run tree', () => {
  it('links parent → child → grandchild onto one root and rolls the subtree up', async () => {
    const rootId = await AgentExecutionModel.create(
      USER, null, 'Root', 'conv-tree', 'root', PRICED.provider, PRICED.model, 'running'
    );
    const childRoot = await AgentExecutionModel.getRootFor(rootId);
    const childId = await AgentExecutionModel.create(
      USER, null, 'Child', 'conv-tree', 'child', PRICED.provider, PRICED.model, 'running',
      { parentExecutionId: rootId, rootExecutionId: childRoot, origin: 'agent' }
    );
    const grandRoot = await AgentExecutionModel.getRootFor(childId);
    const grandId = await AgentExecutionModel.create(
      USER, null, 'Grandchild', 'conv-tree', 'grand', PRICED.provider, PRICED.model, 'running',
      { parentExecutionId: childId, rootExecutionId: grandRoot, origin: 'agent' }
    );

    // A root is its own root; descendants inherit the ancestor's root rather
    // than starting a new tree.
    const rows = await dbAll(
      `SELECT id, parent_execution_id, root_execution_id FROM agent_executions WHERE id IN (?,?,?)`,
      [rootId, childId, grandId]
    );
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId[rootId].root_execution_id).toBe(rootId);
    expect(byId[childId].root_execution_id).toBe(rootId);
    expect(byId[grandId].root_execution_id).toBe(rootId);
    expect(byId[grandId].parent_execution_id).toBe(childId);

    for (const id of [rootId, childId, grandId]) {
      await recordLlmCall({
        userId: USER, origin: 'agent', executionId: id, rootExecutionId: rootId, ...PRICED,
        usage: { inputTokens: 1000, outputTokens: 100 },
      });
    }

    const perNode = await LlmCallModel.byExecutionIds([rootId, childId, grandId]);
    expect(perNode.size).toBe(3);

    const one = getModelCost(PRICED.provider, PRICED.model, 1000, 100).totalCost;
    const subtree = [...perNode.values()].reduce((s, t) => s + t.costUsd, 0);
    expect(subtree).toBeCloseTo(one * 3, 10);
  });

  it('counts ledger rows that have no execution row of their own', async () => {
    const rootId = await AgentExecutionModel.create(
      USER, null, 'Root2', 'conv-tree2', 'root', PRICED.provider, PRICED.model, 'running'
    );
    await recordLlmCall({
      userId: USER, origin: 'goal_task', originId: 'goal-in-tree', rootExecutionId: rootId, ...PRICED,
      usage: { inputTokens: 5000, outputTokens: 500 },
    });

    const unattached = await LlmCallModel.unattachedForRoot(USER, rootId);
    expect(unattached).toHaveLength(1);
    expect(unattached[0].origin).toBe('goal_task');
    expect(unattached[0].costUsd).toBeGreaterThan(0);
  });
});

describe('cross-process write-failure tripwire', () => {
  it('accumulates per source, so a workflow-process failure is visible from the API process', async () => {
    // The two processes share this database and nothing else. If the counter
    // is not here, the endpoint reports a serene zero while writes are being
    // dropped somewhere it cannot see.
    await LlmCallModel.noteWriteFailure('workflow', 'db locked');
    await LlmCallModel.noteWriteFailure('workflow', 'db locked again');
    await LlmCallModel.noteWriteFailure('backend', 'constraint violated');

    const rows = await LlmCallModel.writeFailures();
    const bySource = Object.fromEntries(rows.map((r) => [r.source, r]));

    expect(bySource.workflow.failures).toBe(2);
    expect(bySource.workflow.lastError).toMatch(/again/);
    expect(bySource.backend.failures).toBe(1);
  });

  it('reports an empty list when nothing has ever failed', async () => {
    await dbRun(`DELETE FROM ledger_write_failures WHERE source = ?`, ['never-used']);
    const rows = await LlmCallModel.writeFailures();
    expect(rows.find((r) => r.source === 'never-used')).toBeUndefined();
  });
});

describe('aggregate shape', () => {
  it('separates charged from notional so a subscription seat is never billed as money', async () => {
    const marker = 'user-notional-e2e';
    await dbRun('INSERT OR IGNORE INTO users (id, email, name) VALUES (?, ?, ?)', [
      marker, 'notional@test.local', 'Notional',
    ]);
    await recordLlmCall({
      userId: marker, origin: 'chat', provider: 'claude-code', model: 'claude-sonnet-4-5-20250929',
      usage: { inputTokens: 10000, outputTokens: 1000 },
    });

    const totals = await LlmCallModel.summary(marker);
    expect(totals.costUsd).toBe(0);
    expect(totals.notionalUsd).toBeGreaterThan(0);
  });

  it('reports cache savings for subscription usage instead of a structural zero', async () => {
    const marker = 'user-notional-savings';
    await dbRun('INSERT OR IGNORE INTO users (id, email, name) VALUES (?, ?, ?)', [
      marker, 'notional-savings@test.local', 'Notional Savings',
    ]);
    // Heavy cache reads on a subscription provider: charged cost is $0 by
    // definition, so if savings were only computed on the charged axis this
    // user would see zero money anywhere on the page despite caching working
    // hard for them.
    await recordLlmCall({
      userId: marker, origin: 'chat', provider: 'claude-code', model: 'claude-sonnet-4-5-20250929',
      usage: { inputTokens: 120000, outputTokens: 1000, cacheReadTokens: 115000 },
    });

    const t = await LlmCallModel.summary(marker);
    expect(t.costUsd).toBe(0);
    expect(t.savedUsd).toBe(0);              // nothing charged, nothing charged-saved
    expect(t.notionalUsd).toBeGreaterThan(0);
    expect(t.notionalUncachedUsd).toBeGreaterThan(t.notionalUsd);
    expect(t.notionalSavedUsd).toBeGreaterThan(0);
  });

  it('keeps charged and notional savings on separate axes', async () => {
    // Mixing them would let a subscription baseline inflate a charged saving.
    const marker = 'user-mixed-axes';
    await dbRun('INSERT OR IGNORE INTO users (id, email, name) VALUES (?, ?, ?)', [
      marker, 'mixed@test.local', 'Mixed',
    ]);
    await recordLlmCall({
      userId: marker, origin: 'chat', provider: 'claude-code', model: 'claude-sonnet-4-5-20250929',
      usage: { inputTokens: 50000, outputTokens: 500, cacheReadTokens: 45000 },
    });
    await recordLlmCall({
      userId: marker, origin: 'chat', ...PRICED,
      usage: { inputTokens: 10000, outputTokens: 200, cacheReadTokens: 9000 },
    });

    const t = await LlmCallModel.summary(marker);
    const chargedOnly = getModelCost(PRICED.provider, PRICED.model, 10000, 200, {
      cacheReadTokens: 9000, cacheCreation5mTokens: 0, cacheCreation1hTokens: 0,
    }).totalCost;
    // costUsd must reflect ONLY the metered call, untouched by the seat usage.
    expect(t.costUsd).toBeCloseTo(chargedOnly, 10);
    expect(t.notionalSavedUsd).toBeGreaterThan(0);
    expect(t.savedUsd).toBeGreaterThan(0);
    expect(t.savedUsd).toBeLessThan(t.notionalSavedUsd); // the seat call was larger
  });

  it('buckets by origin, and the buckets sum to the total', async () => {
    const rows = await LlmCallModel.breakdown(USER, { groupBy: 'origin' });
    const totals = await LlmCallModel.summary(USER);
    const summed = rows.reduce((s, r) => s + r.costUsd, 0);
    expect(summed).toBeCloseTo(totals.costUsd, 10);
    expect(rows.map((r) => r.bucket)).toContain('goal_task');
  });

  it('rejects any groupBy outside the whitelist instead of interpolating it into SQL', async () => {
    // groupBy is the ONE value in this model that reaches SQL as an identifier
    // rather than a bound parameter, so the whitelist is the only thing making
    // it safe. Asserting on an arbitrary unknown key tests that mechanism
    // directly — no need to spell out a destructive payload to prove it.
    for (const bad of ['user_id', 'ts', 'anything_else', '']) {
      await expect(LlmCallModel.breakdown(USER, { groupBy: bad })).rejects.toThrow(/Unsupported groupBy/);
    }
  });

  it('ANTI-VACUITY: every whitelisted groupBy is accepted', async () => {
    // Without this, the rejection test above would still pass if breakdown()
    // simply threw for everything.
    for (const good of ['origin', 'provider', 'model', 'origin_id', 'conversation', 'day']) {
      await expect(LlmCallModel.breakdown(USER, { groupBy: good })).resolves.toBeInstanceOf(Array);
    }
  });
});
