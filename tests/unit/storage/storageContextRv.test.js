// PR145 BUGFIX-20260913 — REVIEW-20260913 regressions for
// backend/src/utils/testStorageContext.js: RV-2 (all-admitted-root handle
// protection + reset bookkeeping), RV-3 (lease validated BEFORE
// allocation), RV-4 (sharedStore root path validation), RV-5 (typed
// refusal of same-process option mismatch), RV-6 (handle path containment
// + closer semantics), plus reviewer tests T5 (fork branch), T6 (active
// root deleted underneath), T7 (handle key normalization).
//
// node:test file (`npm run test:node`; the root vitest config excludes
// tests/unit/**). node --test runs each file in its own process.
//
// DETERMINISTIC COUNTING: this process points TMPDIR at a PRIVATE fresh
// directory before the context module is imported, so the frozen
// admitted parent is private to this file and counting agnt-v3-*
// allocations in it is exact — the RV-3 "zero new directories on
// refusal" assertion cannot be polluted by concurrently running test
// files (their processes admit under the shared runner TMPDIR, not here).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// PR145 ABCD 2026-09-13 (approval C — strengthen an existing added test
// within its original purpose): under the WIRED node:test entrypoint
// (package.json test:node runs --import ./tests/setup/node-test-setup.mjs)
// this process is launcher-admitted BEFORE this file runs, so
// testStorageContext's frozen admitted parent (DEC-3: cached once per
// process on globalThis, shared by every module instance) is the
// launcher's tmpdir. The private-TMPDIR redirection below is — by design —
// unable to re-freeze it, which would break this suite's deterministic
// allocation counting and its outside/inside boundary fixtures. When a
// launcher admission is present, this file therefore re-execs its own
// suite in a fresh child process WITHOUT the preload (spawnSync passes no
// execArgv), where the original private-parent design works exactly as
// authored. Every assertion below is unchanged; the child's TAP is
// inherited to stdout and its exit code becomes this file's exit code.
const TMPARENT_KEY = Symbol.for('agnt.test.storage.v3.tmparent');
if (globalThis[TMPARENT_KEY] && !process.env.AGNT_RV_REEXEC) {
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath: f2p } = await import('node:url');
  const { NODE_TEST_CONTEXT, NODE_TEST_WORKER_ID, ...cleanEnv } = process.env;
  const rerun = spawnSync(process.execPath, ['--test', f2p(import.meta.url)], {
    env: { ...cleanEnv, AGNT_RV_REEXEC: '1' },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  process.exit(rerun.status === null ? 1 : rerun.status);
}

process.env.NODE_ENV = 'test';

const baseTmp = fs.realpathSync(os.tmpdir());
const privateParent = fs.mkdtempSync(path.join(baseTmp, 'agnt-rv-parent-'));
process.env.TMPDIR = privateParent;

const MODULE_URL = new URL('../../../backend/src/utils/testStorageContext.js', import.meta.url);
const KEY_V3 = Symbol.for('agnt.test.storage.v3.registration');

const cleanup = [privateParent];
const mkScratch = (prefix) => {
  const d = fs.mkdtempSync(path.join(privateParent, prefix));
  cleanup.push(d);
  return d;
};
const v3Roots = () => fs.readdirSync(privateParent).filter((n) => n.startsWith('agnt-v3-')).sort();
const codeOf = (fn) => {
  try { fn(); } catch (e) { return e && e.code ? e.code : 'NO_CODE:' + (e && e.message); }
  return 'NO_THROW';
};

let api;

// Gated oracle control: the outer evidence run sets this only for a deliberate
// RED. If NODE_TEST_CONTEXT made the re-exec vacuous this assertion would be
// skipped and the command would incorrectly exit zero.
test('RV reexec oracle control: deliberate assertion failure is observable', { skip: process.env.AGNT_RV_FORCE_FAILURE !== '1' }, () => {
  assert.fail('AGNT_RV_DELIBERATE_FAILURE_CONTROL');
});

before(async () => {
  api = await import(`${MODULE_URL.href}?rv=main`);
});

after(() => {
  for (const d of cleanup) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
  }
});

// ── RV-4: sharedStore.root is validated under the admitted parent ──────────
test('RV-4: attach descriptor root is path-validated (outside/symlink/absent/shape typed, zero allocation)', () => {
  const saved = globalThis[KEY_V3] || null;
  globalThis[KEY_V3] = undefined;
  try {
    const validLease = () => ({ parentPid: process.ppid, runId: 'rv4', generation: 1, policy: 'parent-exit' });
    const before = v3Roots();

    // outside the admitted parent
    const outside = path.join(baseTmp, 'agnt-rv-outside-' + process.pid);
    assert.equal(
      codeOf(() => api.initializeTestStorage({ sharedStore: { root: outside, ...validLease() } })),
      'AGNT_TEST_STORAGE_ESCAPE'
    );
    // symlinked root under the parent
    const real = mkScratch('agnt-rv4-real-');
    const link = path.join(privateParent, 'agnt-rv4-link-' + process.pid);
    fs.symlinkSync(real, link);
    cleanup.push(link);
    assert.equal(
      codeOf(() => api.initializeTestStorage({ sharedStore: { root: link, ...validLease() } })),
      'AGNT_TEST_STORAGE_ALIAS'
    );
    // absent path under the parent
    assert.equal(
      codeOf(() => api.initializeTestStorage({ sharedStore: { root: path.join(privateParent, 'agnt-rv4-absent-' + process.pid), ...validLease() } })),
      'AGNT_TEST_STORAGE_INVALID_PATH'
    );
    // non-string root
    assert.equal(
      codeOf(() => api.initializeTestStorage({ sharedStore: { root: 42, ...validLease() } })),
      'AGNT_TEST_STORAGE_SHAPE'
    );
    // non-object descriptor
    assert.equal(codeOf(() => api.initializeTestStorage({ sharedStore: 'nope' })), 'AGNT_TEST_STORAGE_SHAPE');

    // every refusal left ZERO new agnt-v3-* roots and installed no registration
    assert.deepEqual(v3Roots(), before, 'validation refusals must allocate nothing');
    assert.equal(globalThis[KEY_V3], undefined, 'validation refusals must not install a registration');
  } finally {
    globalThis[KEY_V3] = saved;
  }
});

// ── RV-3: lease is validated BEFORE root allocation ───────────────────────
test('RV-3: stale-lease attach refuses BEFORE allocating (no orphan agnt-v3- dir)', () => {
  const saved = globalThis[KEY_V3] || null;
  globalThis[KEY_V3] = undefined;
  try {
    const validRoot = mkScratch('agnt-rv3-root-');
    const before = v3Roots();
    // parentPid ≠ process.ppid → deterministic STALE_LEASE (the ppid branch
    // of v3LeaseCheck; the 'parent-exit' kill branch needs a genuinely dead
    // REAL parent, which a unit process cannot have — the adversarial
    // dogfood's parent-exit case covers that branch natively).
    assert.equal(
      codeOf(() => api.initializeTestStorage({ sharedStore: { root: validRoot, parentPid: 999999, runId: 'rv3', generation: 1, policy: 'parent-exit' } })),
      'AGNT_TEST_STORAGE_STALE_LEASE'
    );
    assert.deepEqual(v3Roots(), before, 'a stale-lease refusal must leave ZERO new agnt-v3-* directories');
    assert.equal(globalThis[KEY_V3], undefined, 'refusal must not install a registration');
  } finally {
    globalThis[KEY_V3] = saved;
  }
});

// attach positive: a validated descriptor + live lease admits an attach registration
test('attach positive: validated descriptor + live lease creates exactly one new root', () => {
  const saved = globalThis[KEY_V3] || null;
  globalThis[KEY_V3] = undefined;
  try {
    const shared = mkScratch('agnt-rv-attach-shared-');
    const before = v3Roots();
    const ctx = api.initializeTestStorage({ sharedStore: { root: shared, parentPid: process.ppid, runId: 'attach-pos', generation: 1, policy: 'parent-exit' } });
    assert.equal(ctx.bootRole, 'attach');
    assert.equal(ctx.pid, process.pid);
    assert.equal(ctx.sharedStore.root, shared); // normalized to the lexical resolved path
    assert.equal(ctx.sharedStore.parentPid, process.ppid);
    const after = v3Roots();
    assert.equal(after.length, before.length + 1, 'exactly one fresh root for the attach process');
  } finally {
    globalThis[KEY_V3] = saved;
  }
});

// ── RV-5: same-process option mismatch is refused, never silently ignored ──
test('RV-5: initializeTestStorage({sharedStore}) against a live same-pid registration is a typed refusal', () => {
  const owner = api.initializeTestStorage();
  const shared = mkScratch('agnt-rv5-shared-');
  assert.equal(
    codeOf(() => api.initializeTestStorage({ sharedStore: { root: shared, parentPid: process.ppid, runId: 'rv5', generation: 1, policy: 'parent-exit' } })),
    'AGNT_TEST_STORAGE_OPTION_MISMATCH'
  );
  // refused, not replaced: the registration object is untouched
  assert.equal(globalThis[KEY_V3], owner);
  // plain idempotent reuse still returns the same object
  assert.equal(api.initializeTestStorage(), owner);
});

// ── RV-2: handles on ANY admitted root block reset/switch; reset keeps bookkeeping ──
test('RV-2: handle on a NON-ACTIVE admitted root refuses reset AND switches; reset orphans every admitted root', () => {
  const r1 = api.getStorageContext().root; // active R1
  const r2 = mkScratch('agnt-rv2-r2-');
  api.admitTestRoot(r2); // active R2; admittedRoots [R1, R2]
  api.registerStorageHandle(r1, () => {}); // handle on NON-active admitted root R1
  try {
    assert.equal(codeOf(() => api.resetTestStorage()), 'AGNT_TEST_STORAGE_HANDLE_OPEN');
    const r3 = mkScratch('agnt-rv2-r3-');
    assert.equal(codeOf(() => api.admitTestRoot(r3)), 'AGNT_TEST_STORAGE_HANDLE_OPEN');
    // switching BACK to the handled root is refused too
    assert.equal(codeOf(() => api.admitTestRoot(r1)), 'AGNT_TEST_STORAGE_HANDLE_OPEN');
  } finally {
    api.releaseStorageHandle(r1);
  }
  const next = api.resetTestStorage();
  // RV-2 bookkeeping: a reset must not drop previously admitted roots
  assert.equal(next.orphanedRoots.includes(r1), true, 'reset must record R1 (previously admitted, non-active) in orphanedRoots');
  assert.equal(next.orphanedRoots.includes(r2), true, 'reset must record R2 (the active root) in orphanedRoots');
  assert.equal(fs.existsSync(r1), true);
  assert.equal(fs.existsSync(r2), true);
});

// ── T7: handle registry keys are path.resolve-normalized ──────────────────
test('T7: register R + "/" blocks, release R (resolve-normalized) unblocks', () => {
  const ctx = api.getStorageContext();
  api.registerStorageHandle(ctx.root + path.sep, () => {});
  assert.equal(codeOf(() => api.resetTestStorage()), 'AGNT_TEST_STORAGE_HANDLE_OPEN');
  api.releaseStorageHandle(ctx.root); // no trailing sep — same resolved key
  const next = api.resetTestStorage(); // must NOT throw HANDLE_OPEN
  assert.notEqual(next.root, ctx.root);
});

// ── T5: a structurally valid registration inherited from a parent pid gets a fresh root ──
test('T5: fork-inherited (pid≠process.pid) registration → fresh root, parent root untouched', () => {
  const parentRoot = mkScratch('agnt-t5-parent-root-');
  const st = fs.lstatSync(parentRoot);
  const inherited = Object.freeze({
    root: parentRoot,
    rootIdentity: Object.freeze({ dev: st.dev, ino: st.ino }),
    admittedParent: privateParent,
    admittedRoots: Object.freeze([parentRoot]),
    pid: 999999,
    ppid: 1,
    runId: 'parent-run',
    generation: 3,
    bootRole: 'owner',
    sharedStore: null,
    orphanedRoots: Object.freeze([]),
    init: Object.freeze({ state: 'ready', error: null }),
    createdAt: Date.now(),
  });
  const saved = globalThis[KEY_V3];
  globalThis[KEY_V3] = inherited;
  try {
    const mine = api.initializeTestStorage();
    assert.equal(mine.pid, process.pid);
    assert.equal(mine.bootRole, 'owner');
    assert.equal(mine.sharedStore, null);
    assert.notEqual(mine.root, parentRoot);
    assert.ok(mine.root.startsWith(path.join(privateParent, 'agnt-v3-')));
    assert.deepEqual([...mine.admittedRoots], [mine.root]); // fresh history — the parent root is NOT carried over
    assert.equal(mine.generation, 1);
    assert.equal(fs.existsSync(parentRoot), true); // parent's root never re-homed or deleted
  } finally {
    globalThis[KEY_V3] = saved;
  }
});

// ── RV-6: handle paths must live under the admitted parent; closer recorded, never invoked ──
test('RV-6: registerStorageHandle/releaseStorageHandle path containment + closer semantics', () => {
  const outside = path.join(baseTmp, 'agnt-rv6-outside-' + process.pid);
  assert.equal(codeOf(() => api.registerStorageHandle(outside, () => {})), 'AGNT_TEST_STORAGE_ESCAPE');
  assert.equal(codeOf(() => api.releaseStorageHandle(outside)), 'AGNT_TEST_STORAGE_ESCAPE');
  assert.equal(codeOf(() => api.registerStorageHandle(42)), 'AGNT_TEST_STORAGE_INVALID_PATH');

  // no registration → MISSING (the registry protects ADMITTED storage)
  const saved = globalThis[KEY_V3];
  globalThis[KEY_V3] = undefined;
  assert.equal(codeOf(() => api.registerStorageHandle(mkScratch('agnt-rv6-in-'))), 'AGNT_TEST_STORAGE_MISSING');
  globalThis[KEY_V3] = saved;

  // closer is recorded but NEVER invoked: reset REFUSES while the handle is
  // open (fail-closed) — an auto-close would relax the R09 guard into a
  // best-effort cleanup.
  let closerCalls = 0;
  const ctx = api.getStorageContext();
  api.registerStorageHandle(ctx.root, () => { closerCalls += 1; });
  assert.equal(codeOf(() => api.resetTestStorage()), 'AGNT_TEST_STORAGE_HANDLE_OPEN');
  api.releaseStorageHandle(ctx.root);
  api.resetTestStorage();
  assert.equal(closerCalls, 0);
});

// ── T6 (destructive — last): active root deleted underneath a live registration ──
test('T6: active root deleted underneath → every API typed INVALID_PATH (documented corner)', () => {
  const ctx = api.getStorageContext();
  const other = mkScratch('agnt-t6-other-');
  fs.rmSync(ctx.root, { recursive: true, force: true });
  assert.equal(codeOf(() => api.getStorageContext()), 'AGNT_TEST_STORAGE_INVALID_PATH');
  assert.equal(codeOf(() => api.admitTestRoot(other)), 'AGNT_TEST_STORAGE_INVALID_PATH');
  assert.equal(codeOf(() => api.resetTestStorage()), 'AGNT_TEST_STORAGE_INVALID_PATH');
  assert.equal(codeOf(() => api.initializeTestStorage()), 'AGNT_TEST_STORAGE_INVALID_PATH');
});
