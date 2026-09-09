/**
 * The agent-execution LIST payload must say which conversation each run
 * belongs to, and where it sits in its run tree.
 *
 * The chat inspector's "This conversation → Working now" section is built
 * from this list. The row already stored conversation_id, parent/root ids and
 * origin (PRD-122) — the list query simply did not select them, so the client
 * had no way to scope runs to the thread on screen and listed every thread's
 * work under one heading. This pins the columns onto the wire.
 *
 * Runs against a throwaway AGNT_HOME — never touches the user's database.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';

let db;
let AgentExecutionModel;

let TMP;
const savedEnv = {};

const USER = 'user-exec-list';
const OTHER_USER = 'user-exec-list-other';
const CONV_A = 'conv-list-a';
const CONV_B = 'conv-list-b';

const dbRun = (sql, params = []) =>
  new Promise((res, rej) => db.run(sql, params, function (e) { e ? rej(e) : res(this); }));

beforeAll(async () => {
  TMP = await fsp.mkdtemp(path.join(os.tmpdir(), 'agnt-exec-list-'));
  for (const k of ['AGNT_HOME', 'USER_DATA_PATH', 'DOCKER_CONTAINER']) savedEnv[k] = process.env[k];
  delete process.env.USER_DATA_PATH;
  delete process.env.DOCKER_CONTAINER;
  process.env.AGNT_HOME = TMP;

  // See LlmCallModel.ledger.test.js: an empty agnt.db stops the bootstrap
  // from adopting the developer's real database as an "orphan".
  const dataDir = path.join(TMP, '.agnt', 'data');
  await fsp.mkdir(dataDir, { recursive: true });
  await fsp.writeFile(path.join(dataDir, 'agnt.db'), '');

  const dbMod = await import('./database/index.js');
  db = dbMod.default;
  await dbMod.dbReady;
  AgentExecutionModel = (await import('./AgentExecutionModel.js')).default;

  for (const [id, email] of [[USER, 'exec-list@test.local'], [OTHER_USER, 'exec-list-other@test.local']]) {
    await dbRun('INSERT OR IGNORE INTO users (id, email, name) VALUES (?, ?, ?)', [id, email, id]);
  }
}, 120000);

afterAll(async () => {
  await new Promise((r) => db.close(r));
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await fsp.rm(TMP, { recursive: true, force: true }).catch(() => {});
});

describe('getExecutions list payload', () => {
  it('carries conversationId, parent/root ids and origin for every row', async () => {
    const rootId = await AgentExecutionModel.create(
      USER, null, 'Orchestrator', CONV_A, 'root turn', 'anthropic', 'claude', 'running',
      { origin: 'orchestrator' }
    );
    // agent_id is a foreign key onto agents; a sub-agent run without a
    // registered agent row is the shape run_agent produces for ad-hoc agents.
    const childId = await AgentExecutionModel.create(
      USER, null, 'Scout', CONV_A, 'child task', 'anthropic', 'claude', 'running',
      { parentExecutionId: rootId, rootExecutionId: rootId, origin: 'agent' }
    );
    const elsewhereId = await AgentExecutionModel.create(
      USER, null, 'Orchestrator', CONV_B, 'another thread', 'anthropic', 'claude', 'running',
      { origin: 'orchestrator' }
    );
    // Another user's run in the same conversation id must never appear.
    await AgentExecutionModel.create(
      OTHER_USER, null, 'Orchestrator', CONV_A, 'not yours', 'anthropic', 'claude', 'running'
    );

    const list = await AgentExecutionModel.getExecutions(USER);
    const byId = new Map(list.map((r) => [r.id, r]));

    expect(byId.get(rootId)).toMatchObject({
      conversationId: CONV_A,
      parentExecutionId: null,
      rootExecutionId: rootId,
      origin: 'orchestrator',
      agentName: 'Orchestrator',
      status: 'running',
    });
    expect(byId.get(childId)).toMatchObject({
      conversationId: CONV_A,
      parentExecutionId: rootId,
      rootExecutionId: rootId,
      origin: 'agent',
      agentName: 'Scout',
    });
    expect(byId.get(elsewhereId)).toMatchObject({ conversationId: CONV_B, parentExecutionId: null });

    const inConvA = list.filter((r) => r.conversationId === CONV_A).map((r) => r.id).sort();
    expect(inConvA).toEqual([rootId, childId].sort());
  });

  it('renders an absent conversation as null, not undefined or empty string', async () => {
    const orphanId = await AgentExecutionModel.create(
      USER, null, 'Orchestrator', null, 'no conversation', 'anthropic', 'claude', 'completed'
    );
    const list = await AgentExecutionModel.getExecutions(USER);
    const row = list.find((r) => r.id === orphanId);
    expect(row).toBeTruthy();
    expect(row.conversationId).toBeNull();
    expect(row.parentExecutionId).toBeNull();
  });
});
