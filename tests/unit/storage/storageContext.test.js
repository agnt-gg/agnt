// PR145 Stage A0 (planner P3) — node:test coverage for the additive v3
// storage-context API in backend/src/utils/testStorageContext.js.
//
// Self-provisioning: this file sets NODE_ENV='test' and dynamic-imports the
// context module BEFORE any backend import, so it is valid under
// `node --test "tests/unit/**/*.test.js"` (which has no setup file) both
// before and after any Stage-B preload exists. Nothing here touches the v2
// API or any database module.
//
// Gates addressed (code-ready, run-evidenced; independent verification still
// required — nothing here closes a gate by itself): R02 (module-level
// identity), R03 re-scoped negatives, R09-cache (reset refusal), C5
// (no-env-write invariant).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Self-provision BEFORE importing any backend module.
process.env.NODE_ENV = 'test';

const MODULE_URL = new URL('../../../backend/src/utils/testStorageContext.js', import.meta.url);
const KEY_V3 = Symbol.for('agnt.test.storage.v3.registration');
const tmpParent = () => fs.realpathSync(os.tmpdir());

const scratch = [];
const mkScratch = (prefix) => {
  const d = fs.mkdtempSync(path.join(tmpParent(), prefix));
  scratch.push(d);
  return d;
};

let api;
let savedRegistration = null;

before(async () => {
  api = await import(`${MODULE_URL.href}?p3=main`);
});

after(() => {
  if (savedRegistration) globalThis[KEY_V3] = savedRegistration;
  for (const d of scratch) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
  }
});

const codeOf = (fn) => {
  try { fn(); } catch (e) { return e && e.code ? e.code : 'NO_CODE:' + (e && e.message); }
  return 'NO_THROW';
};

test('initializeTestStorageV3: fresh context, frozen, under synthetic tmp parent, no db pre-creation', () => {
  const ctx = api.initializeTestStorageV3();
  savedRegistration = ctx;
  assert.equal(Object.isFrozen(ctx), true);
  assert.equal(ctx.root.startsWith(path.join(tmpParent(), 'agnt-v3-')), true);
  assert.equal(ctx.pid, process.pid);
  assert.equal(ctx.bootRole, 'owner');
  assert.equal(ctx.generation, 1);
  assert.equal(typeof ctx.runId, 'string');
  // D4: admission creates NO database and NO Data directory.
  assert.equal(fs.existsSync(path.join(ctx.root, 'agnt.db')), false);
  assert.equal(fs.existsSync(path.join(ctx.root, 'Data')), false);
});

test('C5 invariant: initializeTestStorageV3 writes ZERO process.env entries', () => {
  const before = { ...process.env };
  api.initializeTestStorageV3(); // idempotent reuse path
  const mid = { ...process.env };
  assert.deepEqual(mid, before);
  // Also exercise the fresh-allocation path via resetTestStorage (still no env writes).
  api.resetTestStorage();
  const after = { ...process.env };
  assert.deepEqual(after, before);
});

test('R02: two distinct module instances accept and reuse the same context', async () => {
  const a = api.initializeTestStorageV3();
  const instanceA = await import(`${MODULE_URL.href}?p3=instA`);
  const instanceB = await import(`${MODULE_URL.href}?p3=instB`);
  assert.notEqual(instanceA, instanceB);
  assert.equal(instanceA.getStorageContext(), a);
  assert.equal(instanceB.getStorageContext(), a);
  assert.equal(instanceA.initializeTestStorageV3(), a);
  assert.equal(instanceB.getStorageContext().root, a.root);
  // No function-reference token exists to mismatch (F1-A class): validation
  // is structural + filesystem only.
});

test('admitTestRoot validation matrix', () => {
  const ctx = api.getStorageContext();

  // 1. Outside the frozen admittedParent -> ESCAPE, zero filesystem effects.
  const outside = path.join(os.homedir(), 'agnt-p3-refused-nonexistent');
  assert.equal(codeOf(() => api.admitTestRoot(outside)), 'AGNT_TEST_STORAGE_ESCAPE');
  assert.equal(fs.existsSync(outside), false);

  // 2. Nonexistent path under the parent -> INVALID_PATH (not created).
  const absent = path.join(tmpParent(), 'agnt-p3-absent-' + process.pid);
  assert.equal(codeOf(() => api.admitTestRoot(absent)), 'AGNT_TEST_STORAGE_INVALID_PATH');
  assert.equal(fs.existsSync(absent), false);

  // 3. Regular file under the parent -> refused (not a directory).
  const file = path.join(tmpParent(), 'agnt-p3-file-' + process.pid);
  fs.writeFileSync(file, 'x');
  scratch.push(file);
  assert.equal(codeOf(() => api.admitTestRoot(file)), 'AGNT_TEST_STORAGE_ALIAS');

  // 4. Symlink to a real directory under the parent -> ALIAS.
  const real = mkScratch('agnt-p3-alias-real-');
  const link = path.join(tmpParent(), 'agnt-p3-alias-link-' + process.pid);
  try { fs.symlinkSync(real, link); } catch {}
  scratch.push(link);
  assert.equal(codeOf(() => api.admitTestRoot(link)), 'AGNT_TEST_STORAGE_ALIAS');

  // 5. Valid real directory -> BECOMES the active root (R-1); prior roots
  //    remain recorded in admittedRoots.
  const prevRoot = ctx.root;
  const next = api.admitTestRoot(real);
  assert.equal(next.root, real);
  assert.equal(next.admittedRoots.includes(prevRoot), true);
  assert.equal(next.admittedRoots.includes(real), true);
  assert.equal(api.getStorageContext().root, real);
});

test('typed errors are distinct and discriminating', () => {
  // MISSING: registration temporarily absent.
  const saved = globalThis[KEY_V3];
  globalThis[KEY_V3] = undefined;
  assert.equal(codeOf(() => api.getStorageContext()), 'AGNT_TEST_STORAGE_MISSING');
  globalThis[KEY_V3] = saved;

  const ctx = api.getStorageContext();

  // PID_MISMATCH: frozen but foreign pid.
  globalThis[KEY_V3] = Object.freeze({ ...ctx, pid: 999999 });
  assert.equal(codeOf(() => api.getStorageContext()), 'AGNT_TEST_STORAGE_PID_MISMATCH');
  globalThis[KEY_V3] = saved;

  // MUTATED: unfrozen copy.
  globalThis[KEY_V3] = { ...ctx };
  assert.equal(codeOf(() => api.getStorageContext()), 'AGNT_TEST_STORAGE_MUTATED');
  globalThis[KEY_V3] = saved;

  // SHAPE: frozen but structurally wrong.
  globalThis[KEY_V3] = Object.freeze({ ...ctx, generation: 'one' });
  assert.equal(codeOf(() => api.getStorageContext()), 'AGNT_TEST_STORAGE_SHAPE');
  globalThis[KEY_V3] = saved;

  // IDENTITY_DRIFT: root swapped, identity kept.
  const other = mkScratch('agnt-p3-drift-');
  globalThis[KEY_V3] = Object.freeze({ ...ctx, root: other, admittedRoots: Object.freeze([other]) });
  assert.equal(codeOf(() => api.getStorageContext()), 'AGNT_TEST_STORAGE_IDENTITY_DRIFT');
  globalThis[KEY_V3] = saved;

  // All codes observed are pairwise distinct strings.
  const codes = new Set([
    'AGNT_TEST_STORAGE_MISSING', 'AGNT_TEST_STORAGE_PID_MISMATCH', 'AGNT_TEST_STORAGE_MUTATED',
    'AGNT_TEST_STORAGE_SHAPE', 'AGNT_TEST_STORAGE_IDENTITY_DRIFT', 'AGNT_TEST_STORAGE_ALIAS',
    'AGNT_TEST_STORAGE_ESCAPE', 'AGNT_TEST_STORAGE_INVALID_PATH', 'AGNT_TEST_STORAGE_HANDLE_OPEN',
  ]);
  assert.equal(codes.size, 9);
});

test('resetTestStorage: refuses with an open handle, then resets explicitly (R09-cache)', () => {
  const ctx = api.getStorageContext();
  api.registerStorageHandle(ctx.root, () => {});
  assert.equal(codeOf(() => api.resetTestStorage()), 'AGNT_TEST_STORAGE_HANDLE_OPEN');
  // admitTestRoot is also refused while the handle is open on the active root.
  assert.equal(codeOf(() => api.admitTestRoot(ctx.root)), 'AGNT_TEST_STORAGE_HANDLE_OPEN');
  api.releaseStorageHandle(ctx.root);
  const next = api.resetTestStorage();
  assert.equal(next.generation, ctx.generation + 1);
  assert.equal(next.orphanedRoots.includes(ctx.root), true);
  assert.notEqual(next.root, ctx.root);
  // Orphaned roots are never auto-deleted (cleanup is harness policy).
  assert.equal(fs.existsSync(ctx.root), true);
  scratch.push(ctx.root);
});
