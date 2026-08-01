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

describe('backfill inherits pre-ledger history from agent_executions', () => {
  // The ledger began recording 2026-08-01. Everything before that lives only
  // in agent_executions — with the cost that was MEASURED when the run
  // happened, plus provider/model/tokens. Backfill copies those measurements
  // in, which is what makes "what did I spend last month?" answerable at all.

  const BF_USER = 'user-backfill-e2e';
  let backfillFromAgentExecutions;

  const seedRun = async ({ id, cost, tokens = 1000, provider = 'Claude-Code', model = 'claude-opus-5', daysAgo = 30, status = 'completed' }) => {
    const start = new Date(Date.now() - daysAgo * 86400000).toISOString();
    const end = new Date(Date.now() - daysAgo * 86400000 + 60000).toISOString();
    // tokens: 0 must mean NO tokens at all — an "empty" run with 100 output
    // tokens has evidence of spend, and the backfill would (correctly) take it.
    const outputTokens = tokens > 0 ? 100 : 0;
    await dbRun(
      `INSERT INTO agent_executions
         (id, agent_name, user_id, conversation_id, status, start_time, end_time,
          provider, model, input_tokens, output_tokens, total_tokens, estimated_cost,
          cache_read_tokens, cache_creation_tokens)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, 'Historic', BF_USER, 'conv-bf', status, start, end, provider, model,
        tokens, outputTokens, tokens + outputTokens, cost, tokens > 0 ? 400 : 0, tokens > 0 ? 50 : 0]
    );
  };

  beforeAll(async () => {
    ({ backfillFromAgentExecutions } = await import('../services/execution/LedgerRecorder.js'));
    await dbRun('INSERT OR IGNORE INTO users (id, email, name) VALUES (?, ?, ?)', [
      BF_USER, 'backfill@test.local', 'Backfill',
    ]);
    await seedRun({ id: 'bf-hist-1', cost: 1.25, daysAgo: 30 });
    await seedRun({ id: 'bf-hist-2', cost: 2.5, daysAgo: 10, provider: 'anthropic', model: 'claude-sonnet-4-5-20250929' });
    await seedRun({ id: 'bf-empty', cost: 0, tokens: 0, daysAgo: 5 });          // no evidence of spend
    await seedRun({ id: 'bf-live', cost: 9.99, daysAgo: 2 });                   // will already have a ledger row
    await recordLlmCall({
      userId: BF_USER, origin: 'chat', executionId: 'bf-live', ...PRICED,
      usage: { inputTokens: 500, outputTokens: 50 },
    });
  });

  it('copies the measured cost, stamps the historical date, and classifies the seat', async () => {
    const result = await backfillFromAgentExecutions();
    expect(result.skipped).toBe(false);
    // At least my two seeds; other suites may have left eligible rows too.
    expect(result.backfilled).toBeGreaterThanOrEqual(2);

    const row = await dbGet(`SELECT * FROM llm_calls WHERE execution_id = 'bf-hist-1'`);
    expect(row).toBeTruthy();
    expect(row.cost_usd).toBe(1.25);              // the stored measurement, not a recompute
    expect(row.is_notional).toBe(1);              // Claude-Code is a seat, normalised from 'Claude-Code'
    expect(row.provider).toBe('claude-code');
    expect(row.cache_write_5m_tokens).toBe(50);   // legacy single bucket → 5m
    // Stamped a month ago, NOT at backfill time — this is the whole point.
    const ageDays = (Date.now() - new Date(row.ts + 'Z').getTime()) / 86400000;
    expect(ageDays).toBeGreaterThan(29);
    expect(ageDays).toBeLessThan(31);
  });

  it('makes historical spend visible to a window query', async () => {
    // The user-visible symptom this fixes: every window returned identical
    // totals because nothing predated the ledger.
    const wide = await LlmCallModel.summary(BF_USER, {});
    const narrow = await LlmCallModel.summary(BF_USER, {
      since: new Date(Date.now() - 5 * 86400000).toISOString().replace('T', ' ').slice(0, 19),
    });
    expect(wide.calls).toBeGreaterThan(narrow.calls);
    expect(wide.notionalUsd).toBeGreaterThan(narrow.notionalUsd);
  });

  it('skips runs with no evidence of spend and runs the ledger already saw', async () => {
    expect(await dbGet(`SELECT 1 AS x FROM llm_calls WHERE execution_id = 'bf-empty'`)).toBeUndefined();
    const live = await dbAll(`SELECT cost_usd FROM llm_calls WHERE execution_id = 'bf-live'`);
    expect(live).toHaveLength(1);                 // only the live row — 9.99 was NOT duplicated in
    expect(live[0].cost_usd).not.toBe(9.99);
  });

  it('is idempotent: a second boot adds nothing', async () => {
    const again = await backfillFromAgentExecutions();
    expect(again.skipped).toBe(true);
    expect(again.backfilled).toBe(0);
  });

  it('does not double-count in the daily rollup', async () => {
    // Backfilled rows carry execution_id, and the rollup's ledger branch is
    // scoped to execution_id IS NULL precisely so agent_executions (which
    // already counts these) remains the sole counter for them.
    const raw = await ExecutionModel._computeActivityRaw(BF_USER, ...RANGE);
    const total = raw.reduce((s, r) => s + (r.estimated_cost || 0), 0);
    const aeTotal = (await dbGet(
      `SELECT SUM(estimated_cost) AS c FROM agent_executions WHERE user_id = ?`, [BF_USER]
    )).c;
    expect(total).toBeCloseTo(aeTotal, 6);
  });
});

describe('workflow backfill recovers provider/model from the workflow definition', () => {
  // node_executions stores tokens but no provider and no model, so 4,000+ real
  // workflow LLM calls were invisible and "Workflows" read $0.73 over ninety
  // days. The missing columns live in the workflow definition, under
  // node.parameters — which is where the run read them from in the first place.

  const WF_USER = 'user-wfbackfill-e2e';
  const WF_ID = 'wf-backfill-def';
  let backfillFromNodeExecutions;

  const seedNodeRun = async ({ execId, nodeId, inTok, outTok, daysAgo = 20, status = 'completed' }) => {
    const start = new Date(Date.now() - daysAgo * 86400000).toISOString();
    const end = new Date(Date.now() - daysAgo * 86400000 + 5000).toISOString();
    await dbRun(
      `INSERT OR IGNORE INTO workflow_executions (id, workflow_id, user_id, workflow_name, status, start_time, end_time)
       VALUES (?,?,?,?,?,?,?)`,
      [execId, WF_ID, WF_USER, 'Backfill WF', 'completed', start, end]
    );
    await dbRun(
      `INSERT INTO node_executions (id, execution_id, node_id, status, start_time, end_time, input_tokens, output_tokens)
       VALUES (?,?,?,?,?,?,?,?)`,
      [`${execId}:${nodeId}`, execId, nodeId, status, start, end, inTok, outTok]
    );
  };

  beforeAll(async () => {
    ({ backfillFromNodeExecutions } = await import('../services/execution/LedgerRecorder.js'));
    await dbRun('INSERT OR IGNORE INTO users (id, email, name) VALUES (?, ?, ?)', [
      WF_USER, 'wfbackfill@test.local', 'WF Backfill',
    ]);
    // A definition with a priced AI node and a metered one. `parameters` — not
    // `params` — is where the workflow format actually keeps node config.
    await dbRun('INSERT OR IGNORE INTO workflows (id, workflow_data, user_id) VALUES (?, ?, ?)', [
      WF_ID,
      JSON.stringify({
        nodes: [
          { id: 'node_ai', type: 'generate-with-ai-llm', parameters: { provider: 'Anthropic', model: PRICED.model } },
          { id: 'node_seat', type: 'generate-with-ai-llm', parameters: { provider: 'Claude-Code', model: PRICED.model } },
          { id: 'node_plain', type: 'custom-api', parameters: {} },
        ],
        edges: [],
      }),
      WF_USER,
    ]);

    await seedNodeRun({ execId: 'wfx-1', nodeId: 'node_ai', inTok: 100000, outTok: 5000, daysAgo: 20 });
    await seedNodeRun({ execId: 'wfx-2', nodeId: 'node_seat', inTok: 50000, outTok: 2000, daysAgo: 10 });
    // Node deleted from the workflow since — unknowable, must stay unpriced.
    await seedNodeRun({ execId: 'wfx-3', nodeId: 'node_deleted', inTok: 9000, outTok: 900, daysAgo: 5 });
    // Already recorded live — must not be duplicated.
    await seedNodeRun({ execId: 'wfx-live', nodeId: 'node_ai', inTok: 7000, outTok: 700, daysAgo: 1 });
    await recordLlmCall({
      userId: WF_USER, origin: 'workflow_node', originId: 'wfx-live', ...PRICED,
      usage: { inputTokens: 7000, outputTokens: 700 },
    });
  });

  it('prices a historical workflow call from the model its node declares', async () => {
    const result = await backfillFromNodeExecutions();
    expect(result.skipped).toBe(false);
    expect(result.backfilled).toBeGreaterThanOrEqual(2);

    const row = await dbGet(
      `SELECT * FROM llm_calls WHERE origin='workflow_node' AND origin_id='wfx-1'`
    );
    expect(row).toBeTruthy();
    expect(row.model).toBe(PRICED.model);
    expect(row.provider).toBe('anthropic'); // normalised from "Anthropic"
    expect(row.cost_usd).toBeCloseTo(getModelCost('anthropic', PRICED.model, 100000, 5000).totalCost, 10);

    // Stamped when the run happened, so it lands in the right window.
    const ageDays = (Date.now() - new Date(row.ts + 'Z').getTime()) / 86400000;
    expect(ageDays).toBeGreaterThan(19);
    expect(ageDays).toBeLessThan(21);
  });

  it('classifies a seat-provider node as notional, never as money charged', async () => {
    const row = await dbGet(`SELECT * FROM llm_calls WHERE origin='workflow_node' AND origin_id='wfx-2'`);
    expect(row.is_notional).toBe(1);
  });

  it('claims no cache savings it cannot measure', async () => {
    // node_executions never stored the cache split. Actual and baseline must
    // therefore be equal — assuming a hit rate to flatter the savings figure
    // would be inventing a measurement.
    const row = await dbGet(`SELECT cost_usd, uncached_cost_usd FROM llm_calls WHERE origin_id='wfx-1'`);
    expect(row.uncached_cost_usd).toBeCloseTo(row.cost_usd, 12);
  });

  it('leaves a node deleted from its workflow unpriced rather than guessing', async () => {
    expect(await dbGet(`SELECT 1 AS x FROM llm_calls WHERE origin_id='wfx-3'`)).toBeUndefined();
  });

  it('never double-counts an execution the ledger already recorded live', async () => {
    const rows = await dbAll(`SELECT id FROM llm_calls WHERE origin='workflow_node' AND origin_id='wfx-live'`);
    expect(rows).toHaveLength(1);
  });

  it('makes historical workflow spend visible to a window query', async () => {
    // The reported symptom: "Workflows $0.73" across ninety days.
    const rows = await LlmCallModel.breakdown(WF_USER, { groupBy: 'origin' });
    const wf = rows.find((r) => r.bucket === 'workflow_node');
    expect(wf.costUsd + wf.notionalUsd).toBeGreaterThan(0.5);
  });

  it('is idempotent: a second boot adds nothing', async () => {
    const before = (await dbGet(`SELECT COUNT(*) n FROM llm_calls WHERE origin='workflow_node'`)).n;
    const again = await backfillFromNodeExecutions();
    expect(again.skipped).toBe(true);
    const after = (await dbGet(`SELECT COUNT(*) n FROM llm_calls WHERE origin='workflow_node'`)).n;
    expect(after).toBe(before);
  });
});

describe('repricer: unknown becomes known only when it honestly can', () => {
  const RP_USER = 'user-reprice-e2e';
  let repriceUnpricedCalls;
  let registerDynamicPricing;
  let initModelMetadataPersistence;
  let _resetPersistenceForTests;

  const seedUnpriced = async (provider, model, tokens = 10000) => {
    const id = await recordLlmCall({
      userId: RP_USER, origin: 'chat', provider: 'zzz-not-a-provider', model: 'nope-model',
      usage: { inputTokens: tokens, outputTokens: 500 },
    });
    // Rewrite provider/model after insert so the row lands with cost_usd NULL
    // regardless of which class we are seeding.
    await dbRun(`UPDATE llm_calls SET provider = ?, model = ? WHERE id = ?`, [provider, model, id]);
    return id;
  };

  beforeAll(async () => {
    ({ repriceUnpricedCalls } = await import('../services/execution/LedgerRecorder.js'));
    ({ registerDynamicPricing } = await import('../services/ai/providerConfigs.js'));
    ({ initModelMetadataPersistence, _resetForTests: _resetPersistenceForTests } =
      await import('../services/ai/modelMetadataPersistence.js'));
    await dbRun('INSERT OR IGNORE INTO users (id, email, name) VALUES (?, ?, ?)', [
      RP_USER, 'reprice@test.local', 'Reprice',
    ]);

    // Simulate what a catalog sync teaches the metadata system: OpenRouter
    // lists the retired grok-4.3 with exact per-1M pricing. No network — the
    // repricer must work from whatever the cache holds, which is the point.
    // Rate cross-checked: api.x.ai/v1/models and the Bedrock launch both say
    // $1.25 in / $2.50 out / $0.20 cached.
    registerDynamicPricing('openrouter', 'x-ai/grok-4.3', {
      inputCostPer1M: 1.25,
      outputCostPer1M: 2.5,
      inputCacheReadCostPer1M: 0.2,
    });
  });

  it('prices from static tables and the catalog cache, zeroes the free, leaves the unknowable NULL', async () => {
    const priceable = await seedUnpriced(PRICED.provider, PRICED.model);
    const localFree = await seedUnpriced('local', 'qwen2.5-coder-3b-instruct');
    const orFree = await seedUnpriced('openrouter', 'cohere/north-mini-code:free');
    // Retired from xAI's own API, but the catalog cache knows it — reached
    // under two spellings that must resolve to ONE price via normalisation.
    const retired = await seedUnpriced('grokai', 'grok-4.3');
    const retiredCustom = await seedUnpriced('97d24f02-b8c6-4721-a525-a40aedc4ffa1', 'xai/grok-4.3');
    const unknowable = await seedUnpriced('some-provider', 'model-no-catalog-ever-priced');

    const result = await repriceUnpricedCalls();
    expect(result.priced).toBeGreaterThanOrEqual(3);
    expect(result.freed).toBeGreaterThanOrEqual(2);

    // In today's static price table → priced at current rates.
    const p = await dbGet(`SELECT cost_usd FROM llm_calls WHERE id = ?`, [priceable]);
    expect(p.cost_usd).toBeCloseTo(getModelCost(PRICED.provider, PRICED.model, 10000, 500).totalCost, 10);

    // Known only to the catalog cache → both spellings, one rate. This is the
    // "new model" path: nothing was hardcoded for grok-4.3; the price arrived
    // the way every future model's will — registered from a catalog.
    const expectedGrok = (10000 * 0.30 + 500 * 1.00) / 1e6;
    const expectedCatalog = (10000 * 0.20 + 500 * 0.50) / 1e6;
    const r1 = await dbGet(`SELECT cost_usd FROM llm_calls WHERE id = ?`, [retired]);
    const r2 = await dbGet(`SELECT cost_usd FROM llm_calls WHERE id = ?`, [retiredCustom]);
    expect(r1.cost_usd).toBeCloseTo(expectedGrok, 10);
    expect(r2.cost_usd).toBeCloseTo(expectedCatalog, 10);

    // Genuinely free → a TRUE zero, distinct from unknown.
    expect((await dbGet(`SELECT cost_usd FROM llm_calls WHERE id = ?`, [localFree])).cost_usd).toBe(0);
    expect((await dbGet(`SELECT cost_usd FROM llm_calls WHERE id = ?`, [orFree])).cost_usd).toBe(0);

    // No catalog has ever priced it → stays NULL. Inventing a price here is
    // the fabrication the nullable column exists to prevent.
    expect((await dbGet(`SELECT cost_usd FROM llm_calls WHERE id = ?`, [unknowable])).cost_usd).toBeNull();
  });

  it('applies the provider\u2019s published cached rate, not the full input rate', async () => {
    // 85-95% of these rows' input was cache reads; billing them at the full
    // rate would inflate history several-fold. kimi-for-coding carries
    // Moonshot's metered rates in the kimi-code static metadata:
    // $0.57 in / $0.095 cached / $2.85 out per 1M.
    const id = await seedUnpriced('kimi-code', 'kimi-for-coding', 100000);
    await dbRun(`UPDATE llm_calls SET cache_read_tokens = 90000 WHERE id = ?`, [id]);

    await repriceUnpricedCalls();
    const row = await dbGet(`SELECT cost_usd, uncached_cost_usd FROM llm_calls WHERE id = ?`, [id]);
    const expected = (10000 * 0.57 + 90000 * 0.095 + 500 * 2.85) / 1e6;
    expect(row.cost_usd).toBeCloseTo(expected, 10);
    // and the baseline is what it would have cost with nothing cached
    expect(row.uncached_cost_usd).toBeCloseTo((100000 * 0.57 + 500 * 2.85) / 1e6, 10);
  });

  it('exact provider metadata beats a normalised catalog match for the same name', async () => {
    // claude-sonnet-4-5-20250929 exists in anthropic's static table AND could
    // match catalog entries by basename. Steps 1-4 of getModelMetadata must
    // win before the normalised scan ever runs.
    const id = await seedUnpriced('anthropic', PRICED.model);
    await repriceUnpricedCalls();
    const row = await dbGet(`SELECT cost_usd FROM llm_calls WHERE id = ?`, [id]);
    expect(row.cost_usd).toBeCloseTo(getModelCost('anthropic', PRICED.model, 10000, 500).totalCost, 10);
  });

  it('what a catalog teaches one process survives restart for every process', async () => {
    // The whole reason these rows were stuck: the pricing cache was in-memory
    // and picker-triggered, so the boot repricer never saw it. Registering
    // must write through to model_metadata_cache, and a fresh process must be
    // able to hydrate it back.
    await initModelMetadataPersistence();
    registerDynamicPricing('openrouter', 'vendor/persist-roundtrip-model', {
      inputCostPer1M: 7.77,
      outputCostPer1M: 9.99,
    });
    await new Promise((r) => setTimeout(r, 50)); // the hook is fire-and-forget

    const row = await dbGet(
      `SELECT metadata FROM model_metadata_cache WHERE cache_key = ?`,
      ['openrouter:vendor/persist-roundtrip-model']
    );
    expect(row).toBeTruthy();
    expect(JSON.parse(row.metadata).inputCostPer1M).toBe(7.77);

    // A "new process" (reset + re-init) hydrates it back without any picker.
    _resetPersistenceForTests();
    const again = await initModelMetadataPersistence();
    expect(again.hydrated).toBeGreaterThanOrEqual(1);
  });

  it('never rewrites a price that is already known', async () => {
    const id = await recordLlmCall({
      userId: RP_USER, origin: 'chat', ...PRICED, usage: { inputTokens: 1000, outputTokens: 100 },
    });
    const before = (await dbGet(`SELECT cost_usd FROM llm_calls WHERE id = ?`, [id])).cost_usd;
    // Even a direct attempt must bounce off the IS NULL guard.
    expect(await LlmCallModel.setPrice(id, { costUsd: 999 })).toBe(false);
    await repriceUnpricedCalls();
    expect((await dbGet(`SELECT cost_usd FROM llm_calls WHERE id = ?`, [id])).cost_usd).toBe(before);
  });

  it('is idempotent: a second pass finds nothing newly resolvable', async () => {
    const again = await repriceUnpricedCalls();
    expect(again.priced).toBe(0);
    expect(again.freed).toBe(0);
    // The honestly-unknown remainder is still there to re-examine — that is
    // the self-healing property, not a leak.
    expect(again.remaining).toBeGreaterThanOrEqual(1);
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
