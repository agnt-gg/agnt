/**
 * Safety gate for the two components that DELETE user data.
 *
 * Every test here encodes a specific way a garbage collector or retention job
 * silently destroys payloads. If one of these regresses, blobs disappear and
 * nobody notices until someone opens an old execution.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';

let db, dbReady, ExecutionModel, PayloadStore, BlobGC, RetentionService, PayloadBackfill, blobPathFor;
let TMP;
const savedEnv = {};
const TEST_USER = 'user-gc';
const WORKFLOWS = ['wf-gc', 'wf-ret', 'wf-verify', 'wf-backfill'];

const dbRun = (sql, params = []) =>
  new Promise((res, rej) => db.run(sql, params, function (e) { e ? rej(e) : res(this); }));
const dbGet = (sql, params = []) =>
  new Promise((res, rej) => db.get(sql, params, (e, r) => (e ? rej(e) : res(r))));

const audio = (bytes, seed) => {
  const b = Buffer.alloc(bytes);
  for (let i = 0; i < bytes; i++) b[i] = (i * seed + 17) % 256;
  return { ok: true, audioUrl: `data:audio/mpeg;base64,${b.toString('base64')}` };
};
const bigText = (n, seed = 'g') => {
  let s = '';
  let i = 0;
  while (s.length < n) s += `${seed}${i++}-payload-body-content-here `;
  return s.slice(0, n);
};

beforeAll(async () => {
  TMP = await fsp.mkdtemp(path.join(os.tmpdir(), 'agnt-gc-'));
  for (const k of ['AGNT_HOME', 'USER_DATA_PATH', 'DOCKER_CONTAINER']) savedEnv[k] = process.env[k];
  delete process.env.USER_DATA_PATH;
  delete process.env.DOCKER_CONTAINER;
  process.env.AGNT_HOME = TMP;

  // Pre-seed so the bootstrap does not try to import an orphaned database.
  const dataDir = path.join(TMP, '.agnt', 'data');
  await fsp.mkdir(dataDir, { recursive: true });
  await fsp.writeFile(path.join(dataDir, 'agnt.db'), '');

  const dbMod = await import('../../models/database/index.js');
  db = dbMod.default;
  dbReady = dbMod.dbReady;
  await dbReady;

  ExecutionModel = (await import('../../models/ExecutionModel.js')).default;
  const ps = await import('./PayloadStore.js');
  PayloadStore = ps.default;
  blobPathFor = ps.blobPathFor;
  BlobGC = (await import('./BlobGC.js')).default;
  RetentionService = (await import('./RetentionService.js')).default;
  PayloadBackfill = (await import('./PayloadBackfill.js')).default;

  await dbRun('INSERT OR IGNORE INTO users (id, email, name) VALUES (?, ?, ?)', [
    TEST_USER, 'gc@test.local', 'GC Test',
  ]);
  for (const w of WORKFLOWS) {
    await dbRun('INSERT OR IGNORE INTO workflows (id, workflow_data, user_id) VALUES (?, ?, ?)', [
      w, '{}', TEST_USER,
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

describe('BlobGC — must never delete live data', () => {
  it('report mode deletes nothing, ever', async () => {
    const execId = await ExecutionModel.create('wf-gc', TEST_USER, 'GC');
    await ExecutionModel.createNodeExecution(execId, 'live', audio(200_000, 3));
    await ExecutionModel.updateNodeExecution(execId, 'live', 'completed', audio(200_000, 3), null, 100, null);

    const before = (await PayloadStore.stats()).files;
    const report = await BlobGC.run({ mode: 'report', minAgeMs: 0 });
    const after = (await PayloadStore.stats()).files;

    expect(after).toBe(before);
    expect(report.deleted).toBe(0);
    expect(report.mode).toBe('report');
  }, 120000);

  it('marks blobs referenced by live rows as reachable', async () => {
    const execId = await ExecutionModel.create('wf-gc', TEST_USER, 'GC2');
    const payload = audio(180_000, 5);
    await ExecutionModel.createNodeExecution(execId, 'reach', payload);
    await ExecutionModel.updateNodeExecution(execId, 'reach', 'completed', payload, null, 100, null);

    const report = await BlobGC.run({ mode: 'report', minAgeMs: 0 });
    expect(report.reachableHashes).toBeGreaterThan(0);

    // The specific blob backing this row must be reachable, so not an orphan.
    const row = await dbGet('SELECT output FROM node_executions WHERE execution_id = ? AND node_id = ?', [execId, 'reach']);
    const [hash] = [...PayloadStore.referencedHashes(row.output)];
    expect(hash).toBeTruthy();
    expect(report.orphanSample.find((o) => o.hash === hash)).toBeUndefined();
  }, 120000);

  it('protects young blobs even when they look orphaned (the write race)', async () => {
    // A blob written but not yet referenced is EXACTLY what an in-flight
    // pack() looks like. The grace period is the only thing standing between
    // that and silent data loss.
    const orphan = await PayloadStore.pack({ never_referenced: bigText(120_000, 'orphan') });
    const hash = JSON.parse(orphan).h;
    expect(hash).toBeTruthy();

    const guarded = await BlobGC.run({ mode: 'delete', minAgeMs: 24 * 60 * 60 * 1000 });
    expect(guarded.protectedByGracePeriod).toBeGreaterThan(0);
    await expect(fsp.stat(blobPathFor(hash))).resolves.toBeTruthy();
    expect(guarded.deleted).toBe(0);
  }, 120000);

  it('deletes a genuine orphan once the grace period has elapsed', async () => {
    const orphan = await PayloadStore.pack({ truly_unreferenced: bigText(130_000, 'sweep') });
    const hash = JSON.parse(orphan).h;
    const p = blobPathFor(hash);

    // Backdate it past the grace window.
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    await fsp.utimes(p, old, old);

    const report = await BlobGC.run({ mode: 'delete', minAgeMs: 24 * 60 * 60 * 1000 });
    expect(report.deleted).toBeGreaterThan(0);
    await expect(fsp.stat(p)).rejects.toThrow();

    // And the live rows written earlier are untouched.
    const verify = await BlobGC.verify();
    expect(verify.missing).toBe(0);
  }, 120000);

  it('refuses to sweep when the mark set is empty but blobs exist', async () => {
    const original = BlobGC.SCAN_TARGETS.slice();
    // Simulate the wiring bug: a scan that finds nothing.
    BlobGC.SCAN_TARGETS.length = 0;
    try {
      const report = await BlobGC.run({ mode: 'delete', minAgeMs: 0 });
      expect(report.aborted).toBe(true);
      expect(report.deleted).toBe(0);
      expect(report.abortReason).toMatch(/zero reachable/i);
    } finally {
      BlobGC.SCAN_TARGETS.push(...original);
    }
  }, 120000);

  it('verify() reports a healthy store and detects a missing blob', async () => {
    const healthy = await BlobGC.verify();
    expect(healthy.healthy).toBe(true);

    const execId = await ExecutionModel.create('wf-verify', TEST_USER, 'Verify');
    const payload = { data: bigText(150_000, 'verify') };
    await ExecutionModel.createNodeExecution(execId, 'v', payload);
    await ExecutionModel.updateNodeExecution(execId, 'v', 'completed', payload, null, 100, null);

    const row = await dbGet('SELECT output FROM node_executions WHERE execution_id = ? AND node_id = ?', [execId, 'v']);
    const [hash] = [...PayloadStore.referencedHashes(row.output)];
    await fsp.unlink(blobPathFor(hash));

    const broken = await BlobGC.verify();
    expect(broken.healthy).toBe(false);
    expect(broken.missing).toBeGreaterThan(0);

    // And reading it degrades rather than throwing.
    const details = await ExecutionModel.getExecutionDetails(execId);
    expect(details.nodeExecutions[0].output.__agnt_missing).toBe(true);
  }, 120000);

  it('cleanTemp removes only aged .tmp files', async () => {
    const dir = path.join(PayloadStore.blobRoot(), 'ab', 'cd');
    await fsp.mkdir(dir, { recursive: true });
    const fresh = path.join(dir, 'fresh.tmp');
    const stale = path.join(dir, 'stale.tmp');
    await fsp.writeFile(fresh, 'x');
    await fsp.writeFile(stale, 'y');
    const old = new Date(Date.now() - 3 * 60 * 60 * 1000);
    await fsp.utimes(stale, old, old);

    const res = await BlobGC.cleanTemp({ minAgeMs: 60 * 60 * 1000 });
    expect(res.removed).toBe(1);
    await expect(fsp.stat(fresh)).resolves.toBeTruthy();
    await expect(fsp.stat(stale)).rejects.toThrow();
  }, 120000);
});

describe('RetentionService — must not age data without consent', () => {
  it('is disabled by default and does nothing', async () => {
    const report = await RetentionService.apply();
    expect(report.enabled).toBe(false);
    expect(report.skipped).toMatch(/disabled/i);
    expect(report.compacted).toBe(0);
    expect(report.deleted).toBe(0);
  }, 120000);

  it('dryRun reports without modifying a single row', async () => {
    const execId = await ExecutionModel.create('wf-ret', TEST_USER, 'Retention');
    const payload = { data: bigText(200_000, 'ret') };
    await ExecutionModel.createNodeExecution(execId, 'old', payload);
    await ExecutionModel.updateNodeExecution(execId, 'old', 'completed', payload, null, 100, null);
    // Age it past the full-fidelity window.
    await dbRun(`UPDATE node_executions SET start_time = datetime('now','-40 days') WHERE execution_id = ?`, [execId]);

    const before = await dbGet('SELECT input, output FROM node_executions WHERE execution_id = ?', [execId]);
    const report = await RetentionService.apply({ enabled: true, dryRun: true, fullDays: 7, compactDays: 90 });
    const after = await dbGet('SELECT input, output FROM node_executions WHERE execution_id = ?', [execId]);

    expect(report.dryRun).toBe(true);
    expect(after.input).toBe(before.input);
    expect(after.output).toBe(before.output);
    expect(report.compacted).toBeGreaterThan(0);
  }, 120000);

  it('compaction keeps status, timings, credits, tokens and a usable preview', async () => {
    const execId = await ExecutionModel.create('wf-ret', TEST_USER, 'Retention2');
    const payload = { marker: 'PRESERVE_ME', data: bigText(200_000, 'c') };
    await ExecutionModel.createNodeExecution(execId, 'c1', payload);
    await ExecutionModel.updateNodeExecution(execId, 'c1', 'completed', payload, 'someError', 3000, {
      inputTokens: 111, outputTokens: 222,
    });
    await dbRun(`UPDATE node_executions SET start_time = datetime('now','-40 days') WHERE execution_id = ?`, [execId]);

    await RetentionService.apply({ enabled: true, dryRun: false, fullDays: 7, compactDays: 90 });

    const row = await dbGet('SELECT * FROM node_executions WHERE execution_id = ? AND node_id = ?', [execId, 'c1']);
    expect(RetentionService.isCompacted(row.output)).toBe(true);
    expect(row.status).toBe('completed');
    expect(row.error).toBe('someError');
    expect(row.credits_used).toBeCloseTo(3, 5);
    expect(row.input_tokens).toBe(111);
    expect(row.output_tokens).toBe(222);

    // The preview must still carry enough for InsightEngine's trace.
    const parsed = JSON.parse(row.output);
    expect(parsed.p).toContain('PRESERVE_ME');
    expect(parsed.n).toBeGreaterThan(100_000);

    // Row length collapsed.
    expect(row.output.length).toBeLessThan(600);
  }, 120000);

  it('deletes only rows beyond the compact window', async () => {
    const keepId = await ExecutionModel.create('wf-ret', TEST_USER, 'Keep');
    await ExecutionModel.createNodeExecution(keepId, 'keep', { a: 1 });
    await dbRun(`UPDATE node_executions SET start_time = datetime('now','-10 days') WHERE execution_id = ?`, [keepId]);

    const dropId = await ExecutionModel.create('wf-ret', TEST_USER, 'Drop');
    await ExecutionModel.createNodeExecution(dropId, 'drop', { a: 2 });
    await dbRun(`UPDATE node_executions SET start_time = datetime('now','-400 days') WHERE execution_id = ?`, [dropId]);

    await RetentionService.apply({ enabled: true, dryRun: false, fullDays: 7, compactDays: 90 });

    expect(await dbGet('SELECT id FROM node_executions WHERE execution_id = ?', [keepId])).toBeTruthy();
    expect(await dbGet('SELECT id FROM node_executions WHERE execution_id = ?', [dropId])).toBeUndefined();
    // The parent summary row survives deletion of its node rows.
    expect(await dbGet('SELECT id FROM workflow_executions WHERE id = ?', [dropId])).toBeTruthy();
  }, 120000);

  it('preview() never mutates anything', async () => {
    const before = await dbGet('SELECT COUNT(*) c FROM node_executions');
    const p = await RetentionService.preview({ fullDays: 7, compactDays: 90 });
    const after = await dbGet('SELECT COUNT(*) c FROM node_executions');
    expect(after.c).toBe(before.c);
    expect(p).toHaveProperty('estimatedBytesFreed');
  }, 120000);

  it('compaction is idempotent — a second pass is a no-op', async () => {
    const first = await RetentionService.apply({ enabled: true, dryRun: false, fullDays: 7, compactDays: 90 });
    const second = await RetentionService.apply({ enabled: true, dryRun: false, fullDays: 7, compactDays: 90 });
    expect(second.compacted).toBe(0);
    expect(second.deleted).toBe(0);
    expect(first.compacted).toBeGreaterThanOrEqual(0);
  }, 120000);
});
