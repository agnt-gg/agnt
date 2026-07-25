/**
 * End-to-end integration gate for PayloadStore inside ExecutionModel.
 *
 * The unit tests prove the codec. This proves the WIRING: real sqlite3, real
 * schema, real blob files on disk, through the exact functions the workflow
 * engine calls. It is the test that would have caught a mis-wired write site.
 *
 * Runs against a throwaway AGNT_HOME — never touches the user's database.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';

let ExecutionModel;
let PayloadStore;
let db;
let dbReady;
let TMP;
const savedEnv = {};

const bigText = (bytes, seed = 'x') => {
  let s = '';
  let i = 0;
  while (s.length < bytes) s += `${seed}-${i++}-the quick brown fox jumps over the lazy dog `;
  return s.slice(0, bytes);
};

const audioPayload = (bytes, seed = 7) => {
  const buf = Buffer.alloc(bytes);
  for (let i = 0; i < bytes; i++) buf[i] = (i * seed + 31) % 256;
  return { success: true, audioUrl: `data:audio/mpeg;base64,${buf.toString('base64')}`, voice: 'nova' };
};

const dbRun = (sql, params = []) =>
  new Promise((res, rej) => db.run(sql, params, function (e) { e ? rej(e) : res(this); }));
const dbGet = (sql, params = []) =>
  new Promise((res, rej) => db.get(sql, params, (e, r) => (e ? rej(e) : res(r))));

const TEST_USER = 'user-payload-e2e';
const WORKFLOW_IDS = ['wf-e2e', 'wf-size', 'wf-dedup', 'wf-legacy', 'wf-mixed', 'wf-err', 'wf-tok'];

beforeAll(async () => {
  TMP = await fsp.mkdtemp(path.join(os.tmpdir(), 'agnt-execmodel-'));
  for (const k of ['AGNT_HOME', 'USER_DATA_PATH', 'DOCKER_CONTAINER']) savedEnv[k] = process.env[k];
  delete process.env.USER_DATA_PATH;
  delete process.env.DOCKER_CONTAINER;
  process.env.AGNT_HOME = TMP;

  // IMPORTANT: pre-create an empty agnt.db before importing the bootstrap.
  //
  // database/index.js treats "AGNT_HOME set but no agnt.db there" as a fresh
  // install that should inherit an orphaned database, and copyFileSync's the
  // legacy one in. On a developer machine that means it tries to duplicate the
  // real (30 GB) production database into the OS temp directory. Touching the
  // file first makes fs.existsSync(target) true and skips migration entirely.
  const dataDir = path.join(TMP, '.agnt', 'data');
  await fsp.mkdir(dataDir, { recursive: true });
  await fsp.writeFile(path.join(dataDir, 'agnt.db'), '');

  const dbMod = await import('./database/index.js');
  db = dbMod.default;
  dbReady = dbMod.dbReady;
  await dbReady;

  ExecutionModel = (await import('./ExecutionModel.js')).default;
  PayloadStore = (await import('../services/storage/PayloadStore.js')).default;

  // workflow_executions has TWO foreign keys (workflow_id -> workflows.id and
  // user_id -> users.id) and PRAGMA foreign_keys is ON, so both parents must
  // exist before any execution row can be inserted.
  await dbRun('INSERT OR IGNORE INTO users (id, email, name) VALUES (?, ?, ?)', [
    TEST_USER,
    'payload-e2e@test.local',
    'Payload E2E',
  ]);
  for (const wf of WORKFLOW_IDS) {
    await dbRun('INSERT OR IGNORE INTO workflows (id, workflow_data, user_id) VALUES (?, ?, ?)', [
      wf,
      JSON.stringify({ nodes: [], edges: [] }),
      TEST_USER,
    ]);
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

describe('ExecutionModel + PayloadStore — end to end', () => {
  it('round-trips every payload shape through a real database', async () => {
    const execId = await ExecutionModel.create('wf-e2e', TEST_USER, 'E2E Workflow');
    expect(execId).toBeTruthy();

    const cases = {
      tiny: { ok: true, n: 1 },
      medium: { rows: Array.from({ length: 60 }, (_, i) => ({ i, s: `row ${i}` })) },
      largeJson: { results: Array.from({ length: 500 }, (_, i) => ({ i, body: bigText(300, `j${i}`) })) },
      audio: audioPayload(400_000),
      unicode: { text: '日本語 🎉 émoji '.repeat(4000) },
      nullish: { a: null, b: undefined, c: 0, d: '', e: false },
    };

    for (const [nodeId, input] of Object.entries(cases)) {
      await ExecutionModel.createNodeExecution(execId, nodeId, input);
    }
    for (const [nodeId, output] of Object.entries(cases)) {
      await ExecutionModel.updateNodeExecution(execId, nodeId, 'completed', output, null, 1000, null);
    }

    const details = await ExecutionModel.getExecutionDetails(execId);
    expect(details).toBeTruthy();
    expect(details.nodeExecutions).toHaveLength(Object.keys(cases).length);

    for (const ne of details.nodeExecutions) {
      const expected = cases[ne.node_id];
      // JSON round-trip drops `undefined` members, exactly as JSON.stringify
      // always did — compare against that same canonical form.
      const canonical = JSON.parse(JSON.stringify(expected));
      expect(ne.input, `input for ${ne.node_id}`).toEqual(canonical);
      expect(ne.output, `output for ${ne.node_id}`).toEqual(canonical);
    }
  }, 120000);

  it('keeps the big payloads OUT of the sqlite row', async () => {
    const execId = await ExecutionModel.create('wf-size', TEST_USER, 'Size Check');
    const payload = audioPayload(2_000_000, 13);
    const legacyBytes = JSON.stringify(payload).length;

    await ExecutionModel.createNodeExecution(execId, 'audio-node', payload);
    await ExecutionModel.updateNodeExecution(execId, 'audio-node', 'completed', payload, null, 500, null);

    const row = await dbGet(
      'SELECT length(input) li, length(output) lo FROM node_executions WHERE execution_id = ? AND node_id = ?',
      [execId, 'audio-node']
    );

    // ~2.6 MB of base64 per column before; a small marker-bearing row after.
    expect(row.li).toBeLessThan(legacyBytes / 500);
    expect(row.lo).toBeLessThan(legacyBytes / 500);

    const details = await ExecutionModel.getExecutionDetails(execId);
    const node = details.nodeExecutions.find((n) => n.node_id === 'audio-node');
    expect(node.output).toEqual(payload);
  }, 120000);

  it('writes ONE blob when the same payload is stored many times', async () => {
    const before = (await PayloadStore.stats()).files;
    const execId = await ExecutionModel.create('wf-dedup', TEST_USER, 'Dedup');
    const payload = audioPayload(300_000, 23);

    for (let i = 0; i < 30; i++) {
      await ExecutionModel.createNodeExecution(execId, `dup-${i}`, payload);
      await ExecutionModel.updateNodeExecution(execId, `dup-${i}`, 'completed', payload, null, 100, null);
    }

    const after = (await PayloadStore.stats()).files;
    // 30 nodes x 2 columns = 60 writes of identical content -> 1 new blob.
    expect(after - before).toBeLessThanOrEqual(2);

    const details = await ExecutionModel.getExecutionDetails(execId);
    expect(details.nodeExecutions).toHaveLength(30);
    for (const ne of details.nodeExecutions) expect(ne.output).toEqual(payload);
  }, 180000);

  it('still reads legacy rows written as plain JSON.stringify', async () => {
    const execId = await ExecutionModel.create('wf-legacy', TEST_USER, 'Legacy');
    const legacyInput = { legacy: true, note: 'written the old way' };
    const legacyOutput = { data: bigText(500_000, 'legacy') };

    // Bypass the model entirely — this is exactly what a pre-upgrade row is.
    await dbRun(
      `INSERT INTO node_executions (id, execution_id, node_id, status, input, output, start_time, end_time, credits_used)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['legacy-row-1', execId, 'legacy-node', 'completed',
       JSON.stringify(legacyInput), JSON.stringify(legacyOutput),
       new Date().toISOString(), new Date().toISOString(), 1]
    );

    const details = await ExecutionModel.getExecutionDetails(execId);
    const node = details.nodeExecutions.find((n) => n.node_id === 'legacy-node');
    expect(node.input).toEqual(legacyInput);
    expect(node.output).toEqual(legacyOutput);
  }, 120000);

  it('serves mixed legacy and new rows in the same execution', async () => {
    const execId = await ExecutionModel.create('wf-mixed', TEST_USER, 'Mixed');
    const legacy = { old: bigText(200_000, 'mix') };
    const modern = audioPayload(250_000, 41);

    await dbRun(
      `INSERT INTO node_executions (id, execution_id, node_id, status, input, output, start_time, credits_used)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ['mixed-legacy', execId, 'old-node', 'completed',
       JSON.stringify(legacy), JSON.stringify(legacy), new Date().toISOString(), 1]
    );
    await ExecutionModel.createNodeExecution(execId, 'new-node', modern);
    await ExecutionModel.updateNodeExecution(execId, 'new-node', 'completed', modern, null, 100, null);

    const details = await ExecutionModel.getExecutionDetails(execId);
    expect(details.nodeExecutions.find((n) => n.node_id === 'old-node').output).toEqual(legacy);
    expect(details.nodeExecutions.find((n) => n.node_id === 'new-node').output).toEqual(modern);
  }, 120000);

  it('preserves error rows and credit accounting', async () => {
    const execId = await ExecutionModel.create('wf-err', TEST_USER, 'Errors');
    await ExecutionModel.createNodeExecution(execId, 'boom', { attempt: 1 });
    await ExecutionModel.updateNodeExecution(execId, 'boom', 'failed', { partial: bigText(80_000) }, 'ETIMEDOUT', 2500, null);

    const details = await ExecutionModel.getExecutionDetails(execId);
    const node = details.nodeExecutions.find((n) => n.node_id === 'boom');
    expect(node.status).toBe('failed');
    expect(node.error).toBe('ETIMEDOUT');
    expect(node.credits_used).toBeCloseTo(2.5, 5);
    expect(details.creditsUsed).toBeCloseTo(2.5, 5);

    const total = await ExecutionModel.getTotalCreditsUsed(execId);
    expect(total).toBeCloseTo(2.5, 5);
  }, 120000);

  it('records token usage alongside externalized payloads', async () => {
    const execId = await ExecutionModel.create('wf-tok', TEST_USER, 'Tokens');
    await ExecutionModel.createNodeExecution(execId, 'llm', { prompt: bigText(60_000) });
    await ExecutionModel.updateNodeExecution(
      execId, 'llm', 'completed', { text: bigText(90_000, 'out') }, null, 1500,
      { inputTokens: 1234, outputTokens: 567 }
    );

    const row = await dbGet(
      'SELECT input_tokens, output_tokens FROM node_executions WHERE execution_id = ? AND node_id = ?',
      [execId, 'llm']
    );
    expect(row.input_tokens).toBe(1234);
    expect(row.output_tokens).toBe(567);
  }, 120000);
});
