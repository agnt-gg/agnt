/**
 * Gate for migrating EXISTING inline history into the blob store.
 *
 * The backfill rewrites rows that already hold the only copy of a payload.
 * A bug here is unrecoverable, so every test below checks the same thing from
 * a different angle: the data must read back byte-identically afterwards.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';

let db, ExecutionModel, PayloadStore, BlobGC, PayloadBackfill;
let TMP;
const savedEnv = {};
const TEST_USER = 'user-backfill';
const WORKFLOW = 'wf-backfill';

const dbRun = (sql, params = []) =>
  new Promise((res, rej) => db.run(sql, params, function (e) { e ? rej(e) : res(this); }));
const dbGet = (sql, params = []) =>
  new Promise((res, rej) => db.get(sql, params, (e, r) => (e ? rej(e) : res(r))));

const bigText = (n, seed = 'b') => {
  let s = '';
  let i = 0;
  while (s.length < n) s += `${seed}${i++}-legacy-inline-payload-content `;
  return s.slice(0, n);
};
const audio = (bytes, seed) => {
  const b = Buffer.alloc(bytes);
  for (let i = 0; i < bytes; i++) b[i] = (i * seed + 19) % 256;
  return { ok: true, audioUrl: `data:audio/mpeg;base64,${b.toString('base64')}` };
};

/** Write a row the OLD way — plain JSON.stringify, bypassing PayloadStore. */
const seedLegacy = async (execId, nodeId, payload) =>
  dbRun(
    `INSERT INTO node_executions (id, execution_id, node_id, status, input, output, start_time, credits_used)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [`${execId}-${nodeId}`, execId, nodeId, 'completed',
     JSON.stringify(payload), JSON.stringify(payload), new Date().toISOString(), 1]
  );

beforeAll(async () => {
  TMP = await fsp.mkdtemp(path.join(os.tmpdir(), 'agnt-backfill-'));
  for (const k of ['AGNT_HOME', 'USER_DATA_PATH', 'DOCKER_CONTAINER']) savedEnv[k] = process.env[k];
  delete process.env.USER_DATA_PATH;
  delete process.env.DOCKER_CONTAINER;
  process.env.AGNT_HOME = TMP;

  const dataDir = path.join(TMP, '.agnt', 'data');
  await fsp.mkdir(dataDir, { recursive: true });
  await fsp.writeFile(path.join(dataDir, 'agnt.db'), '');

  const dbMod = await import('../../models/database/index.js');
  db = dbMod.default;
  await dbMod.dbReady;

  ExecutionModel = (await import('../../models/ExecutionModel.js')).default;
  PayloadStore = (await import('./PayloadStore.js')).default;
  BlobGC = (await import('./BlobGC.js')).default;
  PayloadBackfill = (await import('./PayloadBackfill.js')).default;

  await dbRun('INSERT OR IGNORE INTO users (id, email, name) VALUES (?, ?, ?)', [
    TEST_USER, 'backfill@test.local', 'Backfill',
  ]);
  await dbRun('INSERT OR IGNORE INTO workflows (id, workflow_data, user_id) VALUES (?, ?, ?)', [
    WORKFLOW, '{}', TEST_USER,
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

describe('PayloadBackfill', () => {
  it('estimate() reports candidates and changes nothing', async () => {
    const execId = await ExecutionModel.create(WORKFLOW, TEST_USER, 'Est');
    await seedLegacy(execId, 'big1', { data: bigText(300_000, 'e') });

    const before = await dbGet('SELECT COUNT(*) c FROM node_executions');
    const est = await PayloadBackfill.estimate('node_executions');
    const after = await dbGet('SELECT COUNT(*) c FROM node_executions');

    expect(after.c).toBe(before.c);
    expect(est.candidates).toBeGreaterThan(0);
    expect(est.candidateBytes).toBeGreaterThan(100_000);
  }, 120000);

  it('dryRun verifies rows but writes nothing', async () => {
    const execId = await ExecutionModel.create(WORKFLOW, TEST_USER, 'Dry');
    await seedLegacy(execId, 'dry1', { data: bigText(250_000, 'd') });

    const key = `${execId}-dry1`;
    const before = await dbGet('SELECT input, output FROM node_executions WHERE id = ?', [key]);
    const report = await PayloadBackfill.run({ table: 'node_executions', dryRun: true });
    const after = await dbGet('SELECT input, output FROM node_executions WHERE id = ?', [key]);

    expect(report.dryRun).toBe(true);
    expect(after.input).toBe(before.input);
    expect(after.output).toBe(before.output);
    expect(report.rowsRewritten).toBeGreaterThan(0);
    expect(report.skippedMismatch).toBe(0);
  }, 180000);

  it('migrated rows read back byte-identically', async () => {
    const execId = await ExecutionModel.create(WORKFLOW, TEST_USER, 'Real');
    const payloads = {
      json: { results: Array.from({ length: 300 }, (_, i) => ({ i, t: bigText(200, `r${i}`) })) },
      aud: audio(300_000, 29),
      uni: { s: '日本語 🎉 émoji '.repeat(6000) },
      deep: { a: { b: { c: { d: bigText(80_000, 'deep') } } } },
    };
    for (const [k, v] of Object.entries(payloads)) await seedLegacy(execId, k, v);

    const report = await PayloadBackfill.run({ table: 'node_executions', dryRun: false });
    expect(report.skippedMismatch).toBe(0);
    expect(report.rowsRewritten).toBeGreaterThan(0);
    expect(report.savedBytes).toBeGreaterThan(0);

    const details = await ExecutionModel.getExecutionDetails(execId);
    for (const [k, v] of Object.entries(payloads)) {
      const node = details.nodeExecutions.find((n) => n.node_id === k);
      expect(node.input, `input ${k}`).toEqual(v);
      expect(node.output, `output ${k}`).toEqual(v);
    }
  }, 300000);

  it('shrinks the stored columns substantially', async () => {
    const execId = await ExecutionModel.create(WORKFLOW, TEST_USER, 'Shrink');
    await seedLegacy(execId, 'shrink', audio(1_000_000, 31));
    const key = `${execId}-shrink`;

    const before = await dbGet('SELECT length(output) l FROM node_executions WHERE id = ?', [key]);
    await PayloadBackfill.run({ table: 'node_executions', dryRun: false });
    const after = await dbGet('SELECT length(output) l FROM node_executions WHERE id = ?', [key]);

    expect(after.l).toBeLessThan(before.l / 100);
  }, 300000);

  it('is idempotent — a second pass rewrites nothing', async () => {
    await PayloadBackfill.run({ table: 'node_executions', dryRun: false });
    const second = await PayloadBackfill.run({ table: 'node_executions', dryRun: false });
    expect(second.rowsRewritten).toBe(0);
    expect(second.skippedMismatch).toBe(0);
  }, 300000);

  it('resumes from a cursor and finishes the job', async () => {
    const execId = await ExecutionModel.create(WORKFLOW, TEST_USER, 'Resume');
    for (let i = 0; i < 6; i++) await seedLegacy(execId, `res${i}`, { d: bigText(60_000, `s${i}`) });

    const first = await PayloadBackfill.run({ table: 'node_executions', dryRun: false, limit: 3 });
    expect(first.rowsScanned).toBeLessThanOrEqual(3);
    expect(first.lastCursor).toBeTruthy();

    const second = await PayloadBackfill.run({
      table: 'node_executions', dryRun: false, after: first.lastCursor,
    });
    expect(second.skippedMismatch).toBe(0);

    // Whatever the split, a final unrestricted pass leaves nothing behind.
    await PayloadBackfill.run({ table: 'node_executions', dryRun: false });
    const remaining = await PayloadBackfill.estimate('node_executions');
    expect(remaining.candidates).toBe(0);
  }, 300000);

  it('leaves the blob store verifiably intact', async () => {
    const verify = await BlobGC.verify();
    expect(verify.unpackFailures).toBe(0);
    expect(verify.missing).toBe(0);
    expect(verify.healthy).toBe(true);
  }, 180000);

  it('never deletes or duplicates rows', async () => {
    const before = await dbGet('SELECT COUNT(*) c FROM node_executions');
    await PayloadBackfill.run({ table: 'node_executions', dryRun: false });
    const after = await dbGet('SELECT COUNT(*) c FROM node_executions');
    expect(after.c).toBe(before.c);
  }, 180000);
});
