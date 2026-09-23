// Test-storage isolation context — v6.0 (PR145 A1, planner P6).
//
// SECURITY MODEL (v6.0 — v3 semantics are the ONLY implementation):
//
// What this DOES:
//   • Admits a fresh per-process synthetic root under a tmpdir parent that is
//     frozen ONCE PER PROCESS (DEC-3: cached on globalThis, shared by every
//     module instance — dual imports, vi.resetModules re-imports, CJS/ESM
//     double loads all see the same parent; os.tmpdir() is never re-read, so
//     a post-setup TMPDIR mutation cannot move the admitted storage area).
//   • Registration lives on globalThis via a well-known Symbol.for() key and
//     carries ONLY structural + filesystem identity (root, rootIdentity
//     {dev,ino}, admittedParent, admittedRoots, pid, runId, generation,
//     bootRole, sharedStore, orphanedRoots, init, createdAt). There is NO
//     function-reference token: any module instance can validate the same
//     registration (S2/R02 — the F1-A token-mismatch failure mode is absent,
//     not weakened). The object is deep-frozen; mutation attempts leave it
//     structurally invalid and every reader refuses it.
//   • Fail-closed admission (DEC-1 / FV-2): initializeTestStorage() REFUSES a
//     present-but-tampered registration with the typed MUTATED/SHAPE error.
//     It never silently replaces a suspicious registration with a fresh
//     allocation — recovery is the explicit resetTestStorage() call. A
//     structurally VALID registration inherited from a parent pid (fork)
//     still gets a fresh root: that is not a re-home of live storage.
//   • admitTestRoot(p) is the ONLY override mechanism. It SETS THE ACTIVE
//     root (planner amendment R-1), validated under the frozen admittedParent
//     (containment first, then ancestor walk: every component lstat'd as a
//     plain directory, not a symlink, realpath === lexical; then root dev/ino
//     identity). Previous roots stay recorded in admittedRoots.
//   • Handle registry (FV-1 fix) lives on globalThis too: resetTestStorage()
//     and admitTestRoot() refuse while a storage handle is registered on ANY
//     admitted root — the active root OR any previously admitted root
//     (RV-2, REVIEW-20260913) — regardless of which module instance
//     registered it.
//   • ZERO process.env writes (C5 division). The trusted launcher
//     (tests/setup/isolate-data-dir.mjs) exports LEGACY MIRRORS
//     (USER_DATA_PATH, __AGNT_TEST_DATA_DIR) once, for direct env readers
//     only; resolution never reads them (PathManager test mode is
//     context-only, D1). Scrubbing of host auth/secret vars is the
//     launcher's job as well — imports never erase deliberate fixture
//     values (S8).
//   • recordStorageInit(state, error) lets the database layer record boot
//     state on the registration (copy-on-write, still frozen) so a failed
//     test-mode boot is observable on ctx.init (D10).
//
// What this DOES NOT DO (honest limits):
//   • It does not confine hostile same-uid code that can write globalThis.
//     This registry is a COORDINATION mechanism, not an authority: a
//     fully-consistent hand-built context under admittedParent is accepted
//     because it is indistinguishable from what admitTestRoot() grants any
//     test (D3/C9 residual). Hostile-code confinement is enforced-mode only
//     (Stage D) and is never claimed here.
//   • Cross-process sharing: sharedStore descriptors are validated
//     bookkeeping — the descriptor root is path-validated under the
//     admitted parent and the ppid lease is checked BEFORE any allocation
//     (RV-3/RV-4, REVIEW-20260913); a real shared-store child contract is
//     Stage C (FV-3). Nothing here proves a child's storage identity.
//   • Recovery corner: if the ACTIVE root is deleted underneath a live
//     registration, every API refuses (typed INVALID_PATH) — including
//     resetTestStorage(), which revalidates before orphaning. Recovery then
//     requires explicit process-level setup, by design.
//
// STORAGE BRIDGE: vitest isolates each test file's module registry, so
// module-level state does not cross files. The registration, the handle
// registry and the tmpdir-parent cache all live on globalThis via
// Symbol.for() keys — shared across isolated module instances in this
// process, never inherited as authority by children.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto'; // FV-9: explicit import, no implicit global

// Registration key: v3 symbol (the v2 key and its identityToken are deleted;
// v6.0 keeps the v3 key string so existing readers keep validating).
export const REGISTRATION_KEY_V3 = Symbol.for('agnt.test.storage.v3.registration');
// FV-1: handle registry is process-global (NOT module-instance state).
const HANDLE_REGISTRY_KEY = Symbol.for('agnt.test.storage.v3.handles');
// FV-8/DEC-3: fresh-allocation tmpdir parent cached once per process.
const TMPARENT_KEY = Symbol.for('agnt.test.storage.v3.tmparent');

function fail(message) { throw new Error('[test-storage] ' + message); }

export class TestStorageError extends Error {
  constructor(code, message) {
    super('[test-storage:v3] ' + message);
    this.name = 'TestStorageError';
    this.code = code;
  }
}

const V3_CODES = Object.freeze({
  MISSING: 'AGNT_TEST_STORAGE_MISSING',
  MUTATED: 'AGNT_TEST_STORAGE_MUTATED',
  SHAPE: 'AGNT_TEST_STORAGE_SHAPE',
  PID_MISMATCH: 'AGNT_TEST_STORAGE_PID_MISMATCH',
  IDENTITY_DRIFT: 'AGNT_TEST_STORAGE_IDENTITY_DRIFT',
  ALIAS: 'AGNT_TEST_STORAGE_ALIAS',
  ESCAPE: 'AGNT_TEST_STORAGE_ESCAPE',
  INVALID_PATH: 'AGNT_TEST_STORAGE_INVALID_PATH',
  STALE_LEASE: 'AGNT_TEST_STORAGE_STALE_LEASE',
  HANDLE_OPEN: 'AGNT_TEST_STORAGE_HANDLE_OPEN',
  OPTION_MISMATCH: 'AGNT_TEST_STORAGE_OPTION_MISMATCH',
});

function v3fail(code, message) { throw new TestStorageError(V3_CODES[code], message); }

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    Object.freeze(value);
  }
  return value;
}

function lstatOrNull(p) {
  try { return fs.lstatSync(p); } catch { return null; }
}

function isPlainFrozenObject(v) {
  return v !== null && typeof v === 'object' && Object.isFrozen(v);
}

// Structural validation: shape + frozen-ness. No module-instance data, no
// filesystem access. Rejects unfrozen/mutated registrations (R03 negative
// set) before anything touches the disk.
function v3StructuralCheck(reg) {
  if (!isPlainFrozenObject(reg)) v3fail('MUTATED', 'registration is not frozen — it may have been tampered with');
  const need = (cond, what) => { if (!cond) v3fail('SHAPE', 'registration field invalid: ' + what); };
  need(typeof reg.root === 'string' && reg.root.length > 0, 'root');
  need(isPlainFrozenObject(reg.rootIdentity)
    && Number.isFinite(reg.rootIdentity.dev) && Number.isFinite(reg.rootIdentity.ino), 'rootIdentity{dev,ino}');
  need(typeof reg.admittedParent === 'string' && reg.admittedParent.length > 0, 'admittedParent');
  need(Array.isArray(reg.admittedRoots) && Object.isFrozen(reg.admittedRoots)
    && reg.admittedRoots.every((r) => typeof r === 'string'), 'admittedRoots (frozen string array)');
  need(Number.isInteger(reg.pid) && reg.pid > 0, 'pid');
  need(Number.isInteger(reg.ppid), 'ppid');
  need(typeof reg.runId === 'string' && reg.runId.length > 0, 'runId');
  need(Number.isInteger(reg.generation) && reg.generation >= 1, 'generation');
  need(reg.bootRole === 'owner' || reg.bootRole === 'attach', 'bootRole');
  need(reg.sharedStore === null || isPlainFrozenObject(reg.sharedStore), 'sharedStore');
  need(Array.isArray(reg.orphanedRoots) && Object.isFrozen(reg.orphanedRoots), 'orphanedRoots (frozen)');
  need(isPlainFrozenObject(reg.init) && typeof reg.init.state === 'string', 'init{state}');
  need(Number.isFinite(reg.createdAt), 'createdAt');
}

// Filesystem validation: admittedParent anchor + ancestor walk (every
// component lstat dir, not a symlink, realpath === lexical) + root identity.
// Pure reads; refusals here perform zero filesystem effects (S1/S4).
function v3ValidateAncestry(admittedParent, root) {
  const resolved = path.resolve(root);
  if (resolved === admittedParent || !resolved.startsWith(admittedParent + path.sep)) {
    v3fail('ESCAPE', 'path escapes the frozen admitted parent: ' + resolved + ' is not under ' + admittedParent);
  }
  const rel = resolved.slice(admittedParent.length + 1);
  const parts = rel.split(path.sep);
  let cur = admittedParent;
  for (const part of parts) {
    cur = cur + path.sep + part;
    const st = lstatOrNull(cur);
    if (!st) v3fail('INVALID_PATH', 'ancestor component does not exist: ' + cur);
    if (st.isSymbolicLink()) v3fail('ALIAS', 'symlink component on admitted path: ' + cur);
    if (!st.isDirectory()) v3fail('ALIAS', 'ancestor component is not a directory: ' + cur);
    if (fs.realpathSync(cur) !== cur) v3fail('ALIAS', 'ancestor component is not its own realpath: ' + cur);
  }
  return resolved;
}

function v3FilesystemCheck(reg) {
  // Anchor: the frozen admittedParent must itself still be a real directory.
  const anchor = lstatOrNull(reg.admittedParent);
  if (!anchor || anchor.isSymbolicLink() || !anchor.isDirectory()
    || fs.realpathSync(reg.admittedParent) !== reg.admittedParent) {
    v3fail('ALIAS', 'admitted parent anchor is no longer a plain real directory: ' + reg.admittedParent);
  }
  v3ValidateAncestry(reg.admittedParent, reg.root);
  const st = lstatOrNull(reg.root);
  if (!st) v3fail('INVALID_PATH', 'registered root does not exist: ' + reg.root);
  if (st.isSymbolicLink()) v3fail('ALIAS', 'registered root is a symlink: ' + reg.root);
  if (!st.isDirectory()) v3fail('ALIAS', 'registered root is not a directory: ' + reg.root);
  if (fs.realpathSync(reg.root) !== reg.root) v3fail('ALIAS', 'registered root is not its own realpath: ' + reg.root);
  if (st.dev !== reg.rootIdentity.dev || st.ino !== reg.rootIdentity.ino) {
    v3fail('IDENTITY_DRIFT', 'registered root identity drifted (dev/ino mismatch): ' + reg.root);
  }
}

function v3LeaseCheck(reg) {
  if (reg.bootRole === 'attach' && reg.sharedStore) {
    const d = reg.sharedStore;
    if (typeof d.parentPid !== 'number' || process.ppid !== d.parentPid) {
      v3fail('STALE_LEASE', 'shared-store lease mismatch: descriptor parentPid ' + d.parentPid
        + ' !== process.ppid ' + process.ppid);
    }
    if (d.policy === 'parent-exit') {
      try { process.kill(d.parentPid, 0); }
      catch { v3fail('STALE_LEASE', 'shared-store lease stale: parent ' + d.parentPid + ' is not alive'); }
    }
  }
}

function v3AllocateRoot(admittedParent) {
  const root = fs.mkdtempSync(path.join(admittedParent, 'agnt-v3-'));
  fs.chmodSync(root, 0o700);
  // No Data/ mkdir, no agnt.db pre-creation (D4): creating effects belong to
  // the validated open pipeline in models/database/index.js, not to admission.
  const st = fs.lstatSync(root);
  return { root, rootIdentity: Object.freeze({ dev: st.dev, ino: st.ino }) };
}

function v3BuildContext({ admittedParent, root, rootIdentity, pid, ppid, runId, generation, bootRole, sharedStore, orphanedRoots, init }) {
  return deepFreeze({
    root,
    rootIdentity,
    admittedParent,
    admittedRoots: Object.freeze([root]),
    pid,
    ppid,
    runId,
    generation,
    bootRole,
    sharedStore: sharedStore === undefined ? null : sharedStore,
    orphanedRoots: Object.freeze([...orphanedRoots]),
    init: deepFreeze({ state: init.state, error: init.error === undefined ? null : init.error }),
    createdAt: Date.now(),
  });
}

// ── Process-global registries (D2: no module-instance state anywhere) ──────

function getHandleRegistry() {
  // FV-1: the handle registry must outlive module instances. A module-level
  // Map let a second instance reset storage while instance A's database
  // handle was still open — the exact R09-cache hole verification found.
  let m = globalThis[HANDLE_REGISTRY_KEY];
  if (!(m instanceof Map)) {
    m = new Map();
    globalThis[HANDLE_REGISTRY_KEY] = m;
  }
  return m;
}

function getAdmittedParent() {
  // DEC-3/FV-8: frozen ONCE PER PROCESS on globalThis. os.tmpdir() is read
  // at most once per process — dual module instances share the cache, so
  // they can never disagree about the admitted parent.
  let parent = globalThis[TMPARENT_KEY];
  if (typeof parent !== 'string' || parent.length === 0) {
    const real = fs.realpathSync(os.tmpdir());
    const st = lstatOrNull(real);
    if (!st || !st.isDirectory() || st.isSymbolicLink() || fs.realpathSync(real) !== real) {
      v3fail('ALIAS', 'tmpdir parent is not a plain real directory: ' + real);
    }
    parent = real;
    globalThis[TMPARENT_KEY] = parent;
  }
  return parent;
}

// ── RV helpers (REVIEW-20260913) ───────────────────────────────────────────

// RV-2: the handle guard used to cover only the ACTIVE root. A handle
// registered on a PREVIOUSLY admitted (non-active) root neither blocked
// reset/switch nor survived reset bookkeeping — the root vanished from
// admittedRoots and orphanedRoots alike while its handle could still be
// open. Both mutations now refuse while ANY registered handle lies on ANY
// admitted root.
function v3AssertAdmittedRootsHandleFree(reg, action) {
  const registry = getHandleRegistry();
  for (const admitted of reg.admittedRoots) {
    if (registry.has(admitted)) {
      v3fail('HANDLE_OPEN', 'cannot ' + action + ' while a storage handle is registered on admitted root '
        + admitted + ' (active root: ' + reg.root + ') — release it first (cached-handle mismatch, R09)');
    }
  }
}

// RV-4: a sharedStore descriptor's root is a real path under this
// process's frozen admitted parent or it is refused — pure reads, typed
// errors, zero filesystem effects on refusal. Same containment + ancestor
// walk + plain-directory checks admitTestRoot applies; dev/ino identity is
// NOT checkable here (the descriptor names the PARENT process's root,
// whose identity lives in the parent's own registry). Returns the lexical
// resolved path for the descriptor.
function v3ValidateSharedStoreRoot(admittedParent, root) {
  if (typeof root !== 'string' || root.length === 0) v3fail('SHAPE', 'sharedStore.root must be a non-empty string');
  const resolved = path.resolve(root);
  const lexical = v3ValidateAncestry(admittedParent, resolved);
  const st = lstatOrNull(lexical);
  if (!st) v3fail('INVALID_PATH', 'sharedStore root does not exist: ' + lexical);
  if (st.isSymbolicLink()) v3fail('ALIAS', 'sharedStore root is a symlink: ' + lexical);
  if (!st.isDirectory()) v3fail('ALIAS', 'sharedStore root is not a directory: ' + lexical);
  if (fs.realpathSync(lexical) !== lexical) v3fail('ALIAS', 'sharedStore root is not its own realpath: ' + lexical);
  return lexical;
}

// RV-6: handle (de)registration requires THIS process's structurally
// valid registration — the registry protects ADMITTED storage; without an
// admission there is nothing to protect and the call is a wiring mistake,
// refused typed.
function requireAdmittedRegistration() {
  const reg = globalThis[REGISTRATION_KEY_V3] || null;
  if (!reg) v3fail('MISSING', 'no storage registration in this process');
  v3StructuralCheck(reg);
  if (reg.pid !== process.pid) v3fail('PID_MISMATCH', 'registration pid ' + reg.pid + ' is not this process (' + process.pid + ')');
  return reg;
}

// ── Public API ─────────────────────────────────────────────────────────────

export function initializeTestStorage(options = {}) {
  const existing = globalThis[REGISTRATION_KEY_V3] || null;
  if (existing) {
    // DEC-1 (FV-2): refuse-don't-replace. A present registration is either
    // structurally valid — reuse it (same pid, after full revalidation) or
    // treat a different pid as a fork and allocate fresh — or it is tampered,
    // in which case initialization REFUSES with the typed error. A suspicious
    // registration is never silently replaced by a fresh allocation; explicit
    // recovery is resetTestStorage().
    v3StructuralCheck(existing);
    if (existing.pid === process.pid) {
      // RV-5: options are never silently ignored on the idempotent
      // same-process reuse path. An attach descriptor against a live
      // registration is a child-contract wiring mistake and is refused
      // with a typed error — fail-closed, in DEC-1's spirit: a live
      // registration is never silently re-roled.
      if (options && options.sharedStore !== undefined && options.sharedStore !== null) {
        v3fail('OPTION_MISMATCH', 'initializeTestStorage({sharedStore}) refused: this process already holds a '
          + 'storage registration (root ' + existing.root + ', generation ' + existing.generation + '). '
          + 'Attach descriptors are for a fresh process boot, not for converting a live registration. '
          + 'Recovery is resetTestStorage() or a new process.');
      }
      v3FilesystemCheck(existing);
      v3LeaseCheck(existing);
      return existing;
    }
    // Structurally valid but inherited from another pid (forked child with
    // inherited globals): allocate this process's own root. This is not a
    // re-home of live storage — the parent's root is untouched.
  }
  const admittedParent = getAdmittedParent();
  let bootRole = 'owner';
  let sharedStore = null;
  if (options && options.sharedStore !== undefined && options.sharedStore !== null) {
    const d = options.sharedStore;
    if (!d || typeof d !== 'object') v3fail('SHAPE', 'sharedStore descriptor must be an object');
    // RV-4: the descriptor root is VALIDATED under the frozen admitted
    // parent (containment + ancestor walk + plain-directory checks) before
    // the descriptor is accepted — pure reads, zero effects on refusal.
    const sharedRoot = v3ValidateSharedStoreRoot(admittedParent, d.root);
    bootRole = 'attach';
    sharedStore = deepFreeze({
      root: sharedRoot,
      parentPid: Number(d.parentPid),
      runId: String(d.runId ?? 'unknown'),
      generation: Number(d.generation ?? 1),
      policy: String(d.policy ?? 'parent-exit'),
    });
    // RV-3: the lease is validated BEFORE any allocation — a STALE_LEASE
    // refusal must not leave a freshly mkdtemp'd root behind (allocation
    // used to happen first and leak the directory on refusal).
    v3LeaseCheck({ bootRole, sharedStore });
  }
  const fresh = v3AllocateRoot(admittedParent);
  const ctx = v3BuildContext({
    admittedParent,
    root: fresh.root,
    rootIdentity: fresh.rootIdentity,
    pid: process.pid,
    ppid: process.ppid,
    runId: randomUUID(),
    generation: 1,
    bootRole,
    sharedStore,
    orphanedRoots: [],
    init: { state: 'uninitialized' },
  });
  globalThis[REGISTRATION_KEY_V3] = ctx;
  return ctx;
}

// Compat alias (A0-era name, same implementation): kept so existing
// self-provisioning tests keep working through the v3-only activation.
export const initializeTestStorageV3 = initializeTestStorage;

export function getStorageContext() {
  const reg = globalThis[REGISTRATION_KEY_V3] || null;
  if (!reg) v3fail('MISSING', 'no storage registration in this process');
  v3StructuralCheck(reg);
  if (reg.pid !== process.pid) {
    v3fail('PID_MISMATCH', 'registration pid ' + reg.pid + ' is not this process (' + process.pid + ')');
  }
  v3FilesystemCheck(reg);
  v3LeaseCheck(reg);
  return reg;
}

/**
 * Tripwire + compat alias used by PathManager's test mode (D1).
 *
 * Validates the registration exactly like getStorageContext() (typed errors
 * propagate unchanged) and additionally refuses two environment
 * misconfiguration signals that used to be silent storage selectors:
 *   • AGNT_TEST_USE_REAL_DATA — never honored; a test process must not reach
 *     real data, whatever the env says.
 *   • AGNT_HOME — storage resolution in test mode ignores every environment
 *     variable (D1), so an AGNT_HOME value can no longer SELECT a tier; it is
 *     refused loudly instead of silently ignored, because the only ways it
 *     appears are a stale env dance (pre-A1 fixture pattern, to be migrated
 *     to admitTestRoot()) or a mis-launched process. Both deserve a visible
 *     failure, not a quiet no-op.
 *
 * The explicit override API is admitTestRoot(); the legacy env-override
 * containment check (USER_DATA_PATH under tmpdir) is deleted WITH the env
 * resolution path it guarded — overrides are now structural+filesystem
 * validated (admitTestRoot), not string-prefix checked.
 */
export function requireTestStorage() {
  if (process.env.AGNT_TEST_USE_REAL_DATA) {
    fail('real-data escape refused');
  }
  if (process.env.AGNT_HOME) {
    fail('AGNT_HOME is refused in test mode: storage resolution reads no environment variables (D1); '
      + 'an AGNT_HOME value here is a misconfiguration signal — refused loudly rather than silently ignored. '
      + 'The explicit storage override API is admitTestRoot() from testStorageContext.js');
  }
  const reg = getStorageContext();
  return { root: reg.root };
}

export function admitTestRoot(p) {
  const reg = globalThis[REGISTRATION_KEY_V3] || null;
  if (!reg) v3fail('MISSING', 'no storage registration in this process');
  v3StructuralCheck(reg);
  if (reg.pid !== process.pid) v3fail('PID_MISMATCH', 'registration pid ' + reg.pid + ' is not this process');
  v3FilesystemCheck(reg);
  if (typeof p !== 'string' || p.length === 0) v3fail('INVALID_PATH', 'admitTestRoot requires a path string');
  // Containment FIRST (R-1): an out-of-parent path is refused with zero
  // filesystem effects, deterministically, before any lstat of the target.
  const resolved = path.resolve(p);
  const lexical = v3ValidateAncestry(reg.admittedParent, resolved);
  const st = lstatOrNull(lexical);
  if (!st) v3fail('INVALID_PATH', 'admitted path does not exist: ' + lexical);
  if (st.isSymbolicLink()) v3fail('ALIAS', 'admitted path is a symlink: ' + lexical);
  if (!st.isDirectory()) v3fail('ALIAS', 'admitted path is not a directory: ' + lexical);
  if (fs.realpathSync(lexical) !== lexical) v3fail('ALIAS', 'admitted path is not its own realpath: ' + lexical);
  v3AssertAdmittedRootsHandleFree(reg, 'switch the active root');
  // R-1: this admission BECOMES the active root; the previous roots stay
  // recorded in admittedRoots (copy-on-write frozen array).
  const next = deepFreeze({
    ...reg,
    root: lexical,
    rootIdentity: Object.freeze({ dev: st.dev, ino: st.ino }),
    admittedRoots: Object.freeze([...reg.admittedRoots, lexical]),
  });
  globalThis[REGISTRATION_KEY_V3] = next;
  return next;
}

export function resetTestStorage() {
  const reg = globalThis[REGISTRATION_KEY_V3] || null;
  if (!reg) v3fail('MISSING', 'no storage registration in this process');
  v3StructuralCheck(reg);
  v3FilesystemCheck(reg);
  v3AssertAdmittedRootsHandleFree(reg, 'reset');
  // Fresh root under the FROZEN per-process parent (os.tmpdir() is not re-read).
  const fresh = v3AllocateRoot(reg.admittedParent);
  const next = v3BuildContext({
    admittedParent: reg.admittedParent,
    root: fresh.root,
    rootIdentity: fresh.rootIdentity,
    pid: process.pid,
    ppid: process.ppid,
    runId: randomUUID(),
    generation: reg.generation + 1,
    bootRole: 'owner',
    sharedStore: null,
    // RV-2: every previously admitted root is carried into orphanedRoots —
    // a reset must never silently drop a root from all bookkeeping.
    orphanedRoots: [...new Set([...reg.orphanedRoots, ...reg.admittedRoots])],
    init: { state: 'uninitialized' },
  });
  globalThis[REGISTRATION_KEY_V3] = next;
  return next;
}

// Handle registry: lets callers record that a storage handle is open on a
// root so resetTestStorage/switching can refuse a cached-handle mismatch
// (R09). Purely coordination bookkeeping (D3): it does not confer authority.
// NOTE (Stage-A scope): the database module does NOT auto-register its
// connection — module instances are never close-notified under repeated
// dynamic imports, so an auto-registered handle would leak and freeze the
// active root forever. Tests register handles explicitly; the full child
// lifecycle contract is Stage C.
export function registerStorageHandle(root, closer) {
  if (typeof root !== 'string' || root.length === 0) v3fail('INVALID_PATH', 'registerStorageHandle requires a path string');
  // RV-6: a handle may only be registered INSIDE this process's frozen
  // admitted parent — a handle outside it can never protect admitted
  // storage, and accepting it made the R09 refusal satisfiable by a typo
  // (register here, block nothing). Containment is the same fail-closed
  // boundary admitTestRoot enforces; membership in admittedRoots is NOT
  // required (subpath handles under an admitted root are legitimate
  // coordination, e.g. for the Stage-C child contract). 'closer' is
  // RECORDED ONLY: resetTestStorage/admitTestRoot REFUSE while any handle
  // is open — they never invoke closer. Auto-closing would turn the
  // fail-closed R09 guard into best-effort cleanup.
  const reg = requireAdmittedRegistration();
  const resolved = path.resolve(root);
  v3ValidateAncestry(reg.admittedParent, resolved);
  getHandleRegistry().set(resolved, { closer: typeof closer === 'function' ? closer : null, at: Date.now() });
}

export function releaseStorageHandle(root) {
  if (typeof root !== 'string' || root.length === 0) v3fail('INVALID_PATH', 'releaseStorageHandle requires a path string');
  // Same validation as registration: a typo'd release must refuse loudly
  // instead of silently no-op'ing while the handle stays registered
  // (which would freeze the root forever).
  const reg = requireAdmittedRegistration();
  v3ValidateAncestry(reg.admittedParent, path.resolve(root));
  getHandleRegistry().delete(path.resolve(root));
}

/**
 * Record boot state on the registration (D10): the database layer reports
 * 'initializing' → 'ready' | 'error' so a failed test-mode boot is observable
 * on ctx.init. Copy-on-write: the registration stays deep-frozen. Pure
 * bookkeeping — never an authority change; refuses an absent/tampered
 * registration instead of creating one.
 */
export function recordStorageInit(state, error) {
  const reg = globalThis[REGISTRATION_KEY_V3] || null;
  if (!reg) v3fail('MISSING', 'no storage registration in this process');
  v3StructuralCheck(reg);
  if (reg.pid !== process.pid) v3fail('PID_MISMATCH', 'registration pid ' + reg.pid + ' is not this process');
  const next = deepFreeze({
    ...reg,
    init: deepFreeze({ state: String(state), error: error == null ? null : String(error) }),
  });
  globalThis[REGISTRATION_KEY_V3] = next;
  return next;
}
