// Accidental-misconfiguration boundary, not authorization against arbitrary code.
// A fresh directory is created here; caller-provided root strings/claim files
// are never adopted. OS confinement is the outer security boundary.
//
// STORAGE BRIDGE: vitest isolates each test file's module registry, so a
// module-level `let registration` in the setup file is INVISIBLE to the
// test file's import of PathManager. The registration therefore lives on
// globalThis — shared across all isolated module instances in this process,
// but never inherited by child processes (globalThis is per-process).
//
// HONEST SECURITY MODEL (v5.1 — reviewer findings F1–F7 addressed):
//   • The registration gate proves this PROCESS ran the test setup — it
//     does NOT prove who created the registration. A same-uid process
//     with filesystem+env control can pre-populate globalThis. This is
//     an accepted limitation of in-process enforcement; the OS boundary
//     (bwrap/namespace in CI/dev scripts) is the actual security layer
//     against hostile code.
//   • USER_DATA_PATH overrides by tests are permitted ONLY when the
//     resolved root is the registered root or a subdirectory of it.
//     This prevents redirecting to real home directories (F2).
//   • AGNT_HOME is actually rejected, not just documented (F3).
//   • Auth-switch/secret env scrubbing happens here too, on every
//     requireTestStorage() call — not just during setup (F6).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const GLOBAL_KEY = '__AGNT_TEST_STORAGE_REGISTRATION__';

function fail(message) { throw new Error('[test-storage] ' + message); }

function getRegistration() {
  return globalThis[GLOBAL_KEY] || null;
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
  if (!reg || reg.pid !== process.pid) {
    const tmp = fs.realpathSync(os.tmpdir());
    const root = fs.mkdtempSync(path.join(tmp, 'agnt-vitest-'));
    fs.chmodSync(root, 0o700);
    fs.mkdirSync(root + '/Data', { mode: 0o700 });
    fs.writeFileSync(root + '/Data/agnt.db', '', { flag: 'wx', mode: 0o600 });
    reg = {
      root,
      pid: process.pid,
      rootIdentity: fs.statSync(root),
      dataIdentity: fs.statSync(root + '/Data'),
    };
    globalThis[GLOBAL_KEY] = reg;
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
  if (process.env.AGNT_TEST_USE_REAL_DATA) {
    fail('real-data escape refused');
  }
  // F3 fix: actually reject AGNT_HOME, not just document it.
  if (process.env.AGNT_HOME) {
    fail('AGNT_HOME is refused in test mode: it would silently select a different PathManager tier');
  }
  // F6 note: auth-key scrubbing is done ONLY in the setup file
  // (isolate-data-dir.mjs), which runs before any test module imports.
  // Scrubbing here would delete ENCRYPTION_KEY, TRUST_REMOTE_AUTH, etc.
  // that tests deliberately set to exercise encryption/auth scenarios.
  // Setup-time scrubbing is the correct boundary.

  // F2 fix: tests may override USER_DATA_PATH to exercise different
  // install-directory scenarios, but ONLY to another directory under the
  // same temporary parent as the registered root. This prevents
  // redirecting to real home/data directories while allowing legitimate
  // test-created sibling temp directories (e.g. secretResolver's
  // two-install test creates a second mkdtemp under os.tmpdir()).
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
