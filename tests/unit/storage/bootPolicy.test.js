// PR145 section D — tests/unit/storage/bootPolicy.test.js
// (R10/S6/§3.B: explicit boot & readiness policy).
//
// REAL native boots against SYNTHETIC production stores (USER_DATA_PATH tier,
// synthetic HOME so legacy discovery can only ever see synthetic paths — the
// same constructed-env approach as the B30/B31 mode-3 fixtures):
//
//   B1 (positive)     authorized application boot works: production import →
//                     dbReady → schema exists in the synthetic store.
//   B2 (RED, FV-A1)   a seeded live-looking 'running' agent_executions row
//                     must STILL be 'running' after a production import that
//                     performs NO explicit initializeApplicationStorage call.
//                     While the implicit R-2 import-time facade owns
//                     maintenance (VERIFICATION-ABCD FV-A1), the import
//                     itself sweeps the row to 'interrupted' — this test
//                     FAILS and is RELEASE-BLOCKING (R10: "ordinary import
//                     changes recovery rows"). It goes green exactly when
//                     explicit boot owns initialization.
//   B3 (RED, FV-A1)   same, but the boot calls
//                     initializeApplicationStorage(null, {all-off policy})
//                     explicitly: an explicit ALL-OFF policy must suppress
//                     the sweep. Today the implicit facade overrides the
//                     explicit policy — same blocker, second angle.
//   B4 (GREEN ctrl)   TEST mode: the identical import leaves the seeded row
//                     'running' (import = schema only, no maintenance) —
//                     proves the B2 probe is not vacuous.
//   B5 (GREEN ctrl)   TEST mode + explicit staleRunSweep:'all-running' →
//                     row becomes 'interrupted' — proves this suite DETECTS
//                     a sweep when one runs (oracle sensitivity).
//   B6/B7/B8          refusals + default policy record (test mode).
//
// No RED here is "worked around": these tests assert the CONTRACT, they do
// not encode the current bug as desired behavior.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const BASE = fs.realpathSync(os.tmpdir());
const CTX_URL = pathToFileURL(path.join(REPO, 'backend/src/utils/testStorageContext.js')).href;
const PM_URL = pathToFileURL(path.join(REPO, 'backend/src/utils/PathManager.js')).href;
const DB_URL = pathToFileURL(path.join(REPO, 'backend/src/models/database/index.js')).href;

const cleanup = [];
const mk = (prefix) => { const d = fs.mkdtempSync(path.join(BASE, prefix)); cleanup.push(d); return d; };
after(() => { for (const d of cleanup) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } });

const MARK = '##PROOF## ';
function runChild(script, { env, timeoutMs = 90000 } = {}) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ['-e', script], {
      cwd: REPO,
      env: { PATH: process.env.PATH, LANG: 'C.UTF-8', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '', err = '', killed = false;
    const t = setTimeout(() => { killed = true; try { p.kill('SIGKILL'); } catch {} }, timeoutMs);
    p.stdout.on('data', (b) => (out += b));
    p.stderr.on('data', (b) => (err += b));
    p.on('exit', (code, signal) => {
      clearTimeout(t);
      const proofs = out.split('\n').filter((l) => l.startsWith(MARK)).map((l) => { try { return JSON.parse(l.slice(MARK.length)); } catch { return { parseError: l }; } });
      resolve({ code, signal, killed, out, err, proof: proofs[proofs.length - 1] || null });
    });
  });
}
const P = (o) => 'console.log(' + JSON.stringify(MARK) + '+JSON.stringify(' + o + '));';

// Production-mode child env: USER_DATA_PATH tier selects the synthetic store;
// HOME/TMPDIR are synthetic so legacy discovery (which only reads $HOME
// paths on Linux) can never see real data. NODE_ENV/VITEST are absent.
function prodEnv(prodRoot) {
  return { HOME: mk('agnt-boot-home-'), TMPDIR: mk('agnt-boot-tmp-'), USER_DATA_PATH: prodRoot };
}

// Raw seeding on the parent side (foreign_keys default OFF per connection):
async function withSqlite(file, fn) {
  const sqlite3 = (await import('sqlite3')).default || (await import('sqlite3'));
  const db = new sqlite3.Database(file);
  try { return await fn(db); } finally { await new Promise((res) => db.close(res)); }
}
async function seedRunningRow(dbFile) {
  await withSqlite(dbFile, (db) => new Promise((res, rej) => db.run(
    "INSERT OR REPLACE INTO agent_executions (id, user_id, status, initial_prompt) VALUES ('seed-run-1','seed-user-1','running','live-looking row')",
    (e) => (e ? rej(e) : res()))));
}
async function readRowStatus(dbFile) {
  return withSqlite(dbFile, (db) => new Promise((res, rej) => db.get(
    "SELECT status, end_time, error FROM agent_executions WHERE id='seed-run-1'", (e, r) => (e ? rej(e) : res(r)))));
}

// B1 positive: authorized production boot on a synthetic store.
test('R10 B1 (positive): production import boots the synthetic store (dbReady, schema)', async () => {
  const prodRoot = mk('agnt-boot-b1-');
  const r = await runChild(
    ` const db = await import(${JSON.stringify(DB_URL)}); await db.dbReady;`
    + ` const pm = await import(${JSON.stringify(PM_URL)});`
    + P(`{source:pm.default.getDataDirSource(), dbPath:(await import('node:path')).join(${JSON.stringify(prodRoot)},'Data','agnt.db'), schema:await (async()=>{const s=(await import('sqlite3')).default||(await import('sqlite3'));const c=new s.Database((await import('node:path')).join(${JSON.stringify(prodRoot)},'Data','agnt.db'));const row=await new Promise((res,rej)=>c.get("SELECT name FROM sqlite_master WHERE name='agent_executions'",(e,r2)=>e?rej(e):res(r2)));await new Promise((res)=>c.close(res));return !!row;})()}`),
    { env: prodEnv(prodRoot) });
  assert.equal(r.code, 0, 'production boot child exited 0\nstdout: ' + r.out + '\nstderr: ' + r.err);
  assert.equal(r.proof.source, 'electron', 'synthetic store selected via the env-driven tier (by design in production)');
  assert.equal(r.proof.schema, true, 'agent_executions table exists after boot');
  assert.ok(fs.existsSync(r.proof.dbPath));
});

// B2 — THE RED: no explicit call; import alone must not sweep recovery rows.
test('R10 B2 (RED, FV-A1, release-blocking): production import ALONE must NOT mark live-looking rows interrupted', async () => {
  const prodRoot = mk('agnt-boot-b2-');
  const dbFile = path.join(prodRoot, 'Data', 'agnt.db');
  const boot = await runChild(` const db = await import(${JSON.stringify(DB_URL)}); await db.dbReady; ${P(`{booted:true}`)}`,
    { env: prodEnv(prodRoot) });
  assert.equal(boot.code, 0, 'schema boot child exited 0\n' + boot.out + boot.err);
  await seedRunningRow(dbFile);
  const seeded = await readRowStatus(dbFile);
  assert.equal(seeded.status, 'running', 'fixture: row seeded as running');

  const measure = await runChild(
    ` const db = await import(${JSON.stringify(DB_URL)}); await db.dbReady;`
    // NO initializeApplicationStorage call — ordinary import only.
    + ` const s=(await import('sqlite3')).default||(await import('sqlite3'));`
    + ` const c=new s.Database(${JSON.stringify(dbFile)});`
    + ` const row=await new Promise((res,rej)=>c.get("SELECT status,end_time,error FROM agent_executions WHERE id='seed-run-1'",(e,r2)=>e?rej(e):res(r2)));`
    + ` await new Promise((res)=>c.close(res));`
    + P(`{status:row && row.status, end_time:row && row.end_time}`),
    { env: prodEnv(prodRoot) });
  assert.equal(measure.code, 0, 'measure child exited 0\nstdout: ' + measure.out + '\nstderr: ' + measure.err);
  // CONTRACT (R10/S6): an ordinary import must not perform recovery.
  // FV-A1 (VERIFICATION-ABCD): initialization authority is still the
  // implicit R-2 import facade, which sweeps at import — so this assertion
  // FAILS today and keeps R10 OPEN. It turns green only when explicit boot
  // owns maintenance. This RED is intentional evidence, not a bug encoded
  // as desired behavior.
  assert.equal(measure.proof.status, 'running',
    'RELEASE-BLOCKING (FV-A1/R10): the production import chain alone changed the recovery row to '
    + JSON.stringify(measure.proof.status) + ' — ordinary imports must never perform recovery/maintenance');
});

// B3 — RED, second angle: an EXPLICIT all-off policy must suppress the sweep.
test('R10 B3 (RED, FV-A1, release-blocking): explicit initializeApplicationStorage(null, all-off) must suppress maintenance', async () => {
  const prodRoot = mk('agnt-boot-b3-');
  const dbFile = path.join(prodRoot, 'Data', 'agnt.db');
  const boot = await runChild(` const db = await import(${JSON.stringify(DB_URL)}); await db.dbReady; ${P(`{booted:true}`)}`,
    { env: prodEnv(prodRoot) });
  assert.equal(boot.code, 0, 'schema boot child exited 0\n' + boot.out + boot.err);
  await seedRunningRow(dbFile);

  const measure = await runChild(
    ` const db = await import(${JSON.stringify(DB_URL)}); await db.dbReady;`
    + ` const policy = await db.initializeApplicationStorage(null, { staleRunSweep:'none', widgetDedupe:false, webhookSync:false, imageBackfill:false, walCheckpoint:false });`
    + ` const s=(await import('sqlite3')).default||(await import('sqlite3'));`
    + ` const c=new s.Database(${JSON.stringify(dbFile)});`
    + ` const row=await new Promise((res,rej)=>c.get("SELECT status FROM agent_executions WHERE id='seed-run-1'",(e,r2)=>e?rej(e):res(r2)));`
    + ` await new Promise((res)=>c.close(res));`
    + P(`{status:row && row.status, policy}`),
    { env: prodEnv(prodRoot) });
  assert.equal(measure.code, 0, 'measure child exited 0\nstdout: ' + measure.out + '\nstderr: ' + measure.err);
  assert.equal(measure.proof.policy.staleRunSweep, 'none', 'explicit policy recorded all-off');
  assert.equal(measure.proof.status, 'running',
    'RELEASE-BLOCKING (FV-A1/R10): the explicit all-off boot policy was overridden — the row is '
    + JSON.stringify(measure.proof.status) + ' although the only authorized policy said none');
});

// B4 GREEN control: test-mode import is schema-only.
test('R10 B4 (GREEN control): TEST-mode import leaves the seeded running row untouched', async () => {
  const parent = mk('agnt-boot-b4-');           // child's frozen admitted parent
  const store = fs.mkdtempSync(path.join(parent, 'store-')); // MUST live under the child's admitted parent
  const dbFile = path.join(store, 'Data', 'agnt.db');
  const boot = await runChild(
    ` const t = await import(${JSON.stringify(CTX_URL)}); t.initializeTestStorage(); t.admitTestRoot(${JSON.stringify(store)});`
    + ` const db = await import(${JSON.stringify(DB_URL)}); await db.dbReady; ${P(`{booted:true}`)}`,
    { env: { TMPDIR: parent, NODE_ENV: 'test' } });
  assert.equal(boot.code, 0, 'test-mode schema boot exited 0\n' + boot.out + boot.err);
  await seedRunningRow(dbFile);
  const r = await runChild(
    ` const t = await import(${JSON.stringify(CTX_URL)}); t.initializeTestStorage(); t.admitTestRoot(${JSON.stringify(store)});`
    + ` const db = await import(${JSON.stringify(DB_URL)}); await db.dbReady;`
    + ` const s=(await import('sqlite3')).default||(await import('sqlite3'));`
    + ` const c=new s.Database(${JSON.stringify(dbFile)});`
    + ` const row=await new Promise((res,rej)=>c.get("SELECT status FROM agent_executions WHERE id='seed-run-1'",(e,r2)=>e?rej(e):res(r2)));`
    + ` await new Promise((res)=>c.close(res));`
    + P(`{status:row && row.status}`),
    { env: { TMPDIR: parent, NODE_ENV: 'test' } });
  assert.equal(r.code, 0, 'measure child exited 0\nstdout: ' + r.out + '\nstderr: ' + r.err);
  assert.equal(r.proof.status, 'running', 'test-mode import must not run maintenance (S6) — control for B2');
});

// B5 GREEN control: explicit authorized sweep IS observable (oracle sensitivity).
test('R10 B5 (GREEN control): explicit staleRunSweep all-running sweeps the row — the probe detects sweeps', async () => {
  const parent = mk('agnt-boot-b5-');
  const store = fs.mkdtempSync(path.join(parent, 'store-')); // under the child's admitted parent
  const dbFile = path.join(store, 'Data', 'agnt.db');
  const boot = await runChild(
    ` const t = await import(${JSON.stringify(CTX_URL)}); t.initializeTestStorage(); t.admitTestRoot(${JSON.stringify(store)});`
    + ` const db = await import(${JSON.stringify(DB_URL)}); await db.dbReady; ${P(`{booted:true}`)}`,
    { env: { TMPDIR: parent, NODE_ENV: 'test' } });
  assert.equal(boot.code, 0, 'test-mode schema boot exited 0\n' + boot.out + boot.err);
  await seedRunningRow(dbFile);
  const r = await runChild(
    ` const t = await import(${JSON.stringify(CTX_URL)}); const ctx=t.initializeTestStorage(); t.admitTestRoot(${JSON.stringify(store)});`
    + ` const db = await import(${JSON.stringify(DB_URL)}); await db.dbReady;`
    + ` const live=t.getStorageContext();`
    + ` const policy = await db.initializeApplicationStorage(live, { staleRunSweep:'all-running' });`
    + ` const s=(await import('sqlite3')).default||(await import('sqlite3'));`
    + ` const c=new s.Database(${JSON.stringify(dbFile)});`
    + ` const row=await new Promise((res,rej)=>c.get("SELECT status, error FROM agent_executions WHERE id='seed-run-1'",(e,r2)=>e?rej(e):res(r2)));`
    + ` await new Promise((res)=>c.close(res));`
    + P(`{status:row && row.status, error:row && row.error}`),
    { env: { TMPDIR: parent, NODE_ENV: 'test' } });
  assert.equal(r.code, 0, 'measure child exited 0\nstdout: ' + r.out + '\nstderr: ' + r.err);
  assert.equal(r.proof.status, 'interrupted', 'explicit authorized sweep performed');
  assert.match(String(r.proof.error), /interrupted by app restart/);
});

// B6–B8: refusals and the default policy record (in-process, test mode).
import { initializeTestStorage, getStorageContext } from '../../../backend/src/utils/testStorageContext.js';
let dbm;
before(async () => {
  initializeTestStorage(); // self-provisioning direct entry (R01); idempotent under the wired preload
  dbm = await import(DB_URL + '?bootpolicy=1');
  await dbm.dbReady;
});

test('R10 B6: initializeApplicationStorage refuses a foreign frozen context', async () => {
  const foreign = Object.freeze({ root: '/definitely/not/admitted', pid: process.pid, generation: 1, rootIdentity: Object.freeze({ dev: 1, ino: 2 }) });
  await assert.rejects(() => dbm.initializeApplicationStorage(foreign, {}), /context mismatch/);
});

test('R10 B7: invalid staleRunSweep value is refused', async () => {
  await assert.rejects(() => dbm.initializeApplicationStorage(getStorageContext(), { staleRunSweep: 'everyone' }), /staleRunSweep must be/);
});

test('R10 B8: test-mode default policy record is ALL-OFF (evidence record)', async () => {
  const policy = await dbm.initializeApplicationStorage(getStorageContext(), {});
  assert.deepEqual(policy, { schema: false, widgetDedupe: false, staleRunSweep: 'none', webhookSync: false, imageBackfill: false, walCheckpoint: false });
});
