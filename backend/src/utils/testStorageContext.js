// Test-storage isolation context.
//
// SECURITY MODEL (v5.2 — adversarial findings F1/F2/F3/F5/F7 addressed):
//
// What this DOES:
//   • Creates a fresh per-process synthetic root under tmpdir.
//   • Registration lives on globalThis via a well-known Symbol (F1: harder
//     to accidentally collide with than a string key; any same-uid code can
//     still call Symbol.for() — this is a misconfiguration guard, not a
//     sandbox).
//   • Registration carries the module's own `identityToken` — a frozen
//     function reference only this module can produce (F1: a forged
//     registration with a different token is rejected).
//   • Registration object is frozen (F1: cannot be mutated after creation).
//   • USER_DATA_PATH overrides constrained to tmpdir parent (F2).
//   • AGNT_HOME actually rejected (F3).
//   • Auth/secret scrubbing done at setup time, before any test module (F6).
//   • Post-open database identity verification in database/index.js (F5).
//
// What this DOES NOT DO (honest limits):
//   • It does not confine hostile same-uid code that controls its own
//     environment and filesystem. The OS boundary (namespace/container)
//     is the actual security layer against that actor.
//   • Cross-process storage sharing is intentionally not provided (F7).
//     Tests that need shared storage across processes should set
//     USER_DATA_PATH to a shared tmpdir path — which is already permitted
//     by the tmpdir-parent constraint. Each process still runs its own
//     setup and gets its own registration.
//
// STORAGE BRIDGE: vitest isolates each test file's module registry, so a
// module-level variable in the setup file is invisible to test files.
// The registration lives on globalThis via Symbol.for() — shared across
// isolated module instances in this process, never inherited by children.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// F1: Symbol key — harder to accidentally collide with than a string.
// Symbol.for() uses the global registry so it bridges vitest module isolation.
const REGISTRATION_KEY = Symbol.for('agnt.test.storage.v2.registration');

// F1: Module identity token — a frozen function reference only this module
// can produce. A forged registration carrying a different token is rejected.
// This is NOT cryptographic proof; it prevents accidental and naive forgery.
const identityToken = Object.freeze(() => 'agnt-test-storage-context-v2');

function fail(message) { throw new Error('[test-storage] ' + message); }

function getRegistration() {
  return globalThis[REGISTRATION_KEY] || null;
}

function assertDirectory(p, identity) {
  const st = fs.lstatSync(p);
  if (!st.isDirectory() || st.isSymbolicLink() ||
      fs.realpathSync(p) !== p ||
      st.dev !== identity.dev || st.ino !== identity.ino) {
    fail('registered directory identity changed');
  }
}

export function initializeTestStorage() {
  let reg = getRegistration();
  if (!reg || reg.pid !== process.pid || reg.token !== identityToken) {
    const tmp = fs.realpathSync(os.tmpdir());
    const root = fs.mkdtempSync(path.join(tmp, 'agnt-vitest-'));
    fs.chmodSync(root, 0o700);
    fs.mkdirSync(root + '/Data', { mode: 0o700 });
    fs.writeFileSync(root + '/Data/agnt.db', '', { flag: 'wx', mode: 0o600 });
    reg = Object.freeze({
      root,
      pid: process.pid,
      token: identityToken,
      rootIdentity: fs.statSync(root),
      dataIdentity: fs.statSync(root + '/Data'),
    });
    globalThis[REGISTRATION_KEY] = reg;
  }
  const r = reg;
  assertDirectory(r.root, r.rootIdentity);
  assertDirectory(r.root + '/Data', r.dataIdentity);
  process.env.USER_DATA_PATH = r.root;
  process.env.AGNT_EXPLICIT_DATA_ROOT = r.root;
  process.env.__AGNT_TEST_DATA_DIR = r.root;
  delete process.env.AGNT_HOME;
  delete process.env.__AGNT_TEST_DATA_NONCE;
  process.env.NODE_ENV = 'test';
  process.env.AGNT_DISABLE_EXTERNAL_POLLING = 'true';
  return r.root;
}

export function requireTestStorage() {
  const r = getRegistration();
  if (!r || r.pid !== process.pid) {
    fail('no process-local setup registration');
  }
  // F1: verify the registration was created by this module (identity token check).
  if (r.token !== identityToken) {
    fail('registration identity token mismatch — the registration was not created by testStorageContext');
  }
  // F1: verify the registration object has not been mutated.
  if (!Object.isFrozen(r)) {
    fail('registration object is not frozen — it may have been tampered with');
  }
  if (process.env.AGNT_TEST_USE_REAL_DATA) {
    fail('real-data escape refused');
  }
  // F3: actually reject AGNT_HOME, not just document it.
  if (process.env.AGNT_HOME) {
    fail('AGNT_HOME is refused in test mode: it would silently select a different PathManager tier');
  }
  // F6 note: auth-key scrubbing is done ONLY in the setup file
  // (isolate-data-dir.mjs), which runs before any test module imports.
  // Scrubbing here would delete ENCRYPTION_KEY, TRUST_REMOTE_AUTH, etc.
  // that tests deliberately set to exercise encryption/auth scenarios.

  // F2: tests may override USER_DATA_PATH to exercise different
  // install-directory scenarios, but ONLY to another directory under the
  // same temporary parent. This prevents redirecting to real home/data
  // while allowing legitimate test-created sibling temp directories.
  const currentRoot = process.env.USER_DATA_PATH;
  if (currentRoot && currentRoot !== r.root) {
    const tmpParent = fs.realpathSync(os.tmpdir());
    const resolved = path.resolve(currentRoot);
    if (!resolved.startsWith(tmpParent + path.sep)) {
      fail('USER_DATA_PATH override escapes the temporary storage area: '
        + resolved + ' is not under ' + tmpParent
        + ' — redirecting to real data directories is refused');
    }
  }

  assertDirectory(r.root, r.rootIdentity);
  assertDirectory(r.root + '/Data', r.dataIdentity);
  return { root: r.root };
}
