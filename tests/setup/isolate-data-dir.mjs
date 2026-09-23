// Test-storage admission for vitest workers and the Playwright config
// (PR145 A1, planner P9 — "admitProcessStorage").
//
// SECURITY MODEL:
//   • Runs on EVERY setup evaluation, including worker reuse, BEFORE any
//     test module import.
//   • SCRUB (S8): ambient host auth-switch and secret env vars are deleted
//     HERE — separated from storage admission, and separated from the
//     synthetic auth values (ENCRYPTION_KEY, TRUST_*, …) a test may
//     deliberately set afterwards. Imports never erase fixture values;
//     only this setup scrubs, and it runs before each test file.
//   • REFUSE (fail-closed): AGNT_TEST_USE_REAL_DATA aborts the worker.
//   • ADMIT: initializeTestStorage() creates/reuses this process's synthetic
//     root under the frozen tmpdir parent. Admission performs no creating
//     effects beyond the root directory itself — no Data/, no agnt.db (D4):
//     those belong to the validated open pipeline in
//     backend/src/models/database/index.js.
//   • LEGACY MIRRORS (C5/DEC-2 — set-once): USER_DATA_PATH and
//     __AGNT_TEST_DATA_DIR are exported ONCE, from the process-admission
//     root, for legacy DIRECT env readers only (PluginInstaller and
//     PluginManager read process.env.USER_DATA_PATH; some older tests read
//     __AGNT_TEST_DATA_DIR). They represent the SETUP admission — never the
//     ACTIVE root — and storage resolution never reads them: PathManager's
//     test mode resolves from the storage context only (D1). A later
//     admitTestRoot() switch does NOT rewrite them (FV-4/DEC-2). A fixture
//     that needs a direct reader to see its private root sets its own mirror
//     value in its own scope (S8) — never the context module.
//   • Idempotent on worker reuse: initializeTestStorage() revalidates and
//     returns the SAME per-process root, so every write below is stable.
import { initializeTestStorage } from '../../backend/src/utils/testStorageContext.js';

const HOST_ENV_TO_SCRUB = [
  // Auth model switches. The most dangerous: they turn verification off, so a
  // leaked value makes security tests pass or fail for reasons unrelated to
  // the code under test.
  'TRUST_REMOTE_AUTH',
  'TRUST_PROXY',
  // Secrets. A suite asserting "generates one when absent" cannot be trusted
  // if the host already supplied one.
  'JWT_SECRET',
  'SESSION_SECRET',
  'ENCRYPTION_KEY',
  'AGNT_LEGACY_ENCRYPTION_KEY',
];
for (const key of HOST_ENV_TO_SCRUB) delete process.env[key];
if (process.env.AGNT_TEST_USE_REAL_DATA) throw new Error('[test-storage] real-data escape refused');

// Launcher-owned admission (the trusted decision; tests cannot trigger it).
const admitted = initializeTestStorage();

// Legacy mirrors — see header. NODE_ENV/AGNT_DISABLE_EXTERNAL_POLLING are
// runner posture, and AGNT_HOME / the v4-era nonce are deleted so a stale
// host value can never matter in a test process.
process.env.USER_DATA_PATH = admitted.root;
process.env.__AGNT_TEST_DATA_DIR = admitted.root;
process.env.NODE_ENV = 'test';
process.env.AGNT_DISABLE_EXTERNAL_POLLING = 'true';
delete process.env.AGNT_HOME;
delete process.env.__AGNT_TEST_DATA_NONCE;
