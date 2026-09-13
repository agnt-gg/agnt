// PR145 section D — tests/unit/storage/storageContextReset.test.js
// (R02/S2: reset & re-import semantics, native data identity, all-root
// handle guards).
//
// REAL-BEHAVIOR test run in THIS process against the real modules and real
// SQLite:
//   • resetTestStorage() replaces the registration copy-on-write: new root,
//     generation+1, every previously admitted root carried into
//     orphanedRoots (nothing silently dropped), same process identity.
//   • Module re-import (fresh ESM instance of the SAME source, plus the
//     cached instance) does NOT create a second identity token or lose the
//     live context: every instance sees the SAME registration object via the
//     process-global registry — the F1-A function-token failure mode stays
//     absent (R02).
//   • Data identity survives reset + readmission: a native marker row
//     written before reset is still readable after admitTestRoot() back to
//     the old root.
//   • ALL-ROOT handle guard (RV-2 semantics, here with a REAL open SQLite
//     connection): a handle registered on ANY admitted root — active or
//     historical — refuses reset and root switches; the closer is recorded
//     and NEVER invoked; releasing (after closing the connection) unblocks.
//   • initializeApplicationStorage identity (RV-1 semantics): a context
//     captured before copy-on-write METADATA drift is accepted; a context
//     from before a reset (different generation/root) is refused.
//   • Tampered registration (R03 negative): an unfrozen replacement is
//     refused with the typed MUTATED error and NEVER silently replaced.
//
// DETERMINISM: like storageContextRv.test.js, this file wants a PRIVATE
// tmpdir parent (frozen once per process) so allocation/bookkeeping
// assertions are exact. Under the wired node:test entrypoint the launcher
// preload has already frozen the parent on globalThis, so this file re-execs
// its own suite in a fresh child WITHOUT the preload (every assertion
// unchanged; the child's TAP goes to stdout and its exit code is ours).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TMPARENT_KEY = Symbol.for('agnt.test.storage.v3.tmparent');
if (globalThis[TMPARENT_KEY] && !process.env.AGNT_RESET_REEXEC) {
  // Strip node:test's internal context vars: `node --test` propagates
  // NODE_TEST_CONTEXT/NODE_TEST_WORKER_ID to file processes, and a re-exec'd
  // `node --test` that inherits them refuses to run ("node:test run() is
  // being called recursively within a test file. skipping running files") —
  // the file then reports a vacuous pass with zero inner tests. Deleting
  // them makes the re-exec actually execute this suite.
  const { NODE_TEST_CONTEXT, NODE_TEST_WORKER_ID, ...cleanEnv } = process.env;
  const rerun = spawnSync(process.execPath, ['--test', fileURLToPath(import.meta.url)], {
    env: { ...cleanEnv, AGNT_RESET_REEXEC: '1' },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  process.exit(rerun.status === null ? 1 : rerun.status);
}

process.env.NODE_ENV = 'test';
const BASE = fs.realpathSync(os.tmpdir());
const PRIVATE = fs.mkdtempSync(path.join(BASE, 'agnt-reset-parent-'));
process.env.TMPDIR = PRIVATE;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const CTX_URL = pathToFileURL(path.join(REPO, 'backend/src/utils/testStorageContext.js')).href;
const DB_URL = pathToFileURL(path.join(REPO, 'backend/src/models/database/index.js')).href;
const KEY_V3 = Symbol.for('agnt.test.storage.v3.registration');

const cleanup = [PRIVATE];
after(() => { for (const d of cleanup) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } });

const q = (sql, params = []) => new Promise((res, rej) => CONN.all(sql, params, (e, r) => (e ? rej(e) : res(r || []))));
const run = (sql, params = []) => new Promise((res, rej) => CONN.run(sql, params, function (e) { if (e) rej(e); else res(this.changes); }));
let SQLITE3; // sqlite3 class (imported in before())
let CONN = null; // the raw connection used by q()/run()

let api, db1;
before(async () => {
  api = await import(CTX_URL + '?reset=a');
  SQLITE3 = (await import('sqlite3')).default || (await import('sqlite3'));
});

test('R02 baseline: admit → real schema boot → native marker row M1 in root1', async () => {
  const c1 = api.initializeTestStorage();
  assert.ok(c1.root.startsWith(PRIVATE + path.sep));
  assert.equal(c1.generation, 1);
  db1 = await import(DB_URL + '?reset=a');
  await db1.dbReady;
  assert.equal((await api.getStorageContext()).init.state, 'ready', 'dbReady recorded ready on ctx.init');
  CONN = new SQLITE3.Database(path.join(c1.root, 'Data', 'agnt.db')); // q()/run() use this connection
  await run("CREATE TABLE IF NOT EXISTS reset_markers (k TEXT PRIMARY KEY, v TEXT)");
  await run("INSERT OR REPLACE INTO reset_markers VALUES ('M1','before-reset')");
  assert.equal((await q("SELECT v FROM reset_markers WHERE k='M1'"))[0].v, 'before-reset');
});

test('R02 reset: copy-on-write replacement, full orphan bookkeeping, no second token anywhere', async () => {
  const before = api.getStorageContext();
  const root1 = before.root;
  const c2 = api.resetTestStorage();
  assert.notEqual(c2.root, root1);
  assert.equal(c2.generation, before.generation + 1);
  assert.equal(c2.pid, process.pid);
  assert.ok(c2.orphanedRoots.includes(root1), 'root1 carried into orphanedRoots');
  assert.ok(Object.isFrozen(c2) && Object.isFrozen(c2.orphanedRoots), 'replacement stays deep-frozen');
  assert.equal(api.getStorageContext(), c2, 'registry now returns the replacement object');
  assert.notEqual(api.getStorageContext(), before);
  // Idempotent re-init on the same pid returns the SAME object — no new token:
  assert.equal(api.initializeTestStorage(), c2);
  // A fresh ESM instance of the same source sees the SAME registration (the
  // F1-A module-instance-token failure mode remains absent):
  const api2 = await import(CTX_URL + '?reset=b');
  assert.equal(api2.getStorageContext(), c2);
  assert.equal(api2.initializeTestStorage(), c2);
});

test('R02 data identity: readmit root1 after reset → native marker M1 still present', async () => {
  const root1 = api.getStorageContext().orphanedRoots[0];
  const c3 = api.admitTestRoot(root1);
  assert.equal(c3.root, root1, 'readmitted root is active');
  assert.ok(c3.admittedRoots.includes(root1));
  const rows = await q("SELECT v FROM reset_markers WHERE k='M1'");
  assert.equal(rows[0]?.v, 'before-reset', 'native row survived reset + readmission');
});

test('R02 all-root handles: real OPEN SQLite handle on a NON-ACTIVE admitted root refuses reset & switch', async () => {
  // Make root2 (the reset-era root, currently historical) non-active again
  // by admitting a scratch root, then open a REAL sqlite connection on the
  // historical root and register it.
  const scratch = fs.mkdtempSync(path.join(PRIVATE, 'agnt-reset-scratch-'));
  cleanup.push(scratch);
  api.admitTestRoot(scratch); // scratch active; root1 & root2 historical
  const ctxNow = api.getStorageContext();
  const historical = ctxNow.admittedRoots.find((r) => r !== scratch);
  fs.mkdirSync(path.join(historical, 'Data'), { recursive: true });
  const handlePath = path.join(historical, 'Data', 'open-handle.db');
  const openDb = new SQLITE3.Database(handlePath);
  await new Promise((res, rej) => openDb.run('CREATE TABLE IF NOT EXISTS live(k TEXT)', (e) => (e ? rej(e) : res())));
  let closerCalls = 0;
  api.registerStorageHandle(historical, () => { closerCalls += 1; });
  try {
    assert.throws(() => api.resetTestStorage(), (e) => e.code === 'AGNT_TEST_STORAGE_HANDLE_OPEN', 'reset refused while a real handle is open on a historical root');
    assert.throws(() => api.admitTestRoot(fs.mkdtempSync(path.join(PRIVATE, 'agnt-reset-x-'))), (e) => e.code === 'AGNT_TEST_STORAGE_HANDLE_OPEN', 'switch refused too');
  } finally {
    await new Promise((res) => openDb.close(res)); // genuinely close the connection
    api.releaseStorageHandle(historical);
  }
  assert.equal(closerCalls, 0, 'closer recorded, never invoked (fail-closed, not best-effort cleanup)');
  const c4 = api.resetTestStorage(); // must NOT throw now
  assert.ok(c4.orphanedRoots.includes(historical), 'bookkeeping keeps the handled root after reset');
});

test('R02 initializeApplicationStorage identity: metadata drift accepted, stale generation refused', async () => {
  // db1 is the live module instance (imported in the baseline test, opened on
  // root1). initializeApplicationStorage validates the PASSED context against
  // the CURRENT registration — the connection's own file is not consulted by
  // the all-off default policy.
  const captured = api.getStorageContext();
  api.recordStorageInit('ready', null); // copy-on-write metadata drift
  const policy = await db1.initializeApplicationStorage(captured, {}); // identity fields unchanged → accepted
  assert.deepEqual(policy, { schema: false, widgetDedupe: false, staleRunSweep: 'none', webhookSync: false, imageBackfill: false, walCheckpoint: false }, 'test-mode default policy is ALL-OFF');
  const stale = { ...captured, generation: captured.generation + 5, root: path.join(PRIVATE, 'agnt-nope') };
  await assert.rejects(() => db1.initializeApplicationStorage(Object.freeze(stale), {}), /context mismatch/, 'a context naming a different root/generation is refused');
});

test('R02 re-import semantics: a query-string re-import CANNOT silently re-home on the stale PathManager singleton', async () => {
  // Real behavior (proven by this very suite's first draft failing): relative
  // imports drop the query string, so a "?reset=b" database module instance
  // shares the ONE PathManager singleton constructed for root1. After the
  // resets above, the live registration names a different root — and the
  // D4 gate refuses the fresh instance instead of letting it open the stale
  // singleton's directory against the new registration. That refusal is the
  // required behavior: no silent re-home, no second database on a stale path.
  await assert.rejects(
    () => import(DB_URL + '?reset=b'),
    /database directory is not the admitted storage context data directory/,
    'the re-imported module must refuse the stale singleton dir against the live registration',
  );
});

test('R03 negative (tamper): unfrozen registration replacement is refused MUTATED, never silently replaced', async () => {
  const live = api.getStorageContext();
  const saved = globalThis[KEY_V3];
  const tampered = { ...live, root: path.join(PRIVATE, 'agnt-forged') }; // structurally plausible, NOT frozen
  globalThis[KEY_V3] = tampered;
  try {
    assert.throws(() => api.initializeTestStorage(), (e) => e.code === 'AGNT_TEST_STORAGE_MUTATED', 'fail-closed: refuse, do not replace');
    assert.equal(globalThis[KEY_V3], tampered, 'the suspicious registration is left in place (recovery = explicit reset/new process)');
    assert.equal(fs.existsSync(tampered.root), false, 'no forged root was created by the refusal');
  } finally {
    globalThis[KEY_V3] = saved;
  }
  assert.equal(api.getStorageContext(), live, 'live registration restored and still valid');
});
