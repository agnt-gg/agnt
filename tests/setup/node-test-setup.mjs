// PR145 Stage B (STAGED COPY — not applied; requires exact-file approval)
// tests/setup/node-test-setup.mjs — launcher-owned storage admission for the
// node:test runner (R01: every supported entrypoint declares its launcher).
//
// Loaded via `node --import tests/setup/node-test-setup.mjs` (package.json
// test:node, Stage-B consent) BEFORE any test file import. Mirrors
// tests/setup/isolate-data-dir.mjs (vitest): scrub host auth switches/secrets,
// refuse the real-data escape, admit this process's synthetic root, export the
// legacy set-once mirrors. Self-provisioning files that call
// initializeTestStorage() themselves are unaffected (idempotent reuse).
import { initializeTestStorage } from '../../backend/src/utils/testStorageContext.js';

const HOST_ENV_TO_SCRUB = [
  'TRUST_REMOTE_AUTH',
  'TRUST_PROXY',
  'JWT_SECRET',
  'SESSION_SECRET',
  'ENCRYPTION_KEY',
  'AGNT_LEGACY_ENCRYPTION_KEY',
];
for (const key of HOST_ENV_TO_SCRUB) delete process.env[key];
if (process.env.AGNT_TEST_USE_REAL_DATA) throw new Error('[test-storage] real-data escape refused');

const admitted = initializeTestStorage();

// Legacy mirrors — see isolate-data-dir.mjs. Set-once at setup from the
// process-admission root; resolution never reads them (D1).
process.env.USER_DATA_PATH = admitted.root;
process.env.__AGNT_TEST_DATA_DIR = admitted.root;
process.env.NODE_ENV = 'test';
process.env.AGNT_DISABLE_EXTERNAL_POLLING = 'true';
delete process.env.AGNT_HOME;
delete process.env.__AGNT_TEST_DATA_NONCE;
