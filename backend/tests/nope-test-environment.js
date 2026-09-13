import fs from 'fs';
import os from 'os';
import path from 'path';
import { admitTestRoot, getStorageContext } from '../src/utils/testStorageContext.js';

const TEST_ROOT_ENV = 'AGNT_NOPE_TEST_ROOT';

if (!process.env[TEST_ROOT_ENV]) {
  process.env[TEST_ROOT_ENV] = fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-nope-test-'));
}

const testRoot = process.env[TEST_ROOT_ENV];

// PR145 A1/P10 migration (D1, APPROVAL-REVIEW AR-2): test-mode storage
// resolution reads ONLY the admitted storage context. This helper previously
// wrote AGNT_HOME and USER_DATA_PATH to redirect storage — that env dance is
// exactly what context-only resolution now refuses (a stray AGNT_HOME is a
// loud D1 tripwire that broke nope-gate-block.e2e). The nope sandbox root is
// admitted explicitly instead; APPDATA/LOCALAPPDATA stay pointed at it for
// legacy non-storage readers, exactly as before.
//
// The setup admission (tests/setup/isolate-data-dir.mjs) that ran before this
// module is captured but NOT restored at exit: process exit is terminal (no
// further admission can happen), the setup root's own exit hook is registered
// earlier and may already have removed it, and vitest fork-pool hygiene for
// INTER-file root switching is handled by each file's afterAll restore.
// Validate the setup admission is live, then switch the ACTIVE root to the
// nope sandbox (explicit fixture operation, S3).
getStorageContext();
admitTestRoot(testRoot);

// These variables are consumed at module-import time by PathManager,
// database/index.js, and the trigger receivers. Set them before importing any
// AGNT service module so tests never touch the real user database or poll
// remote email/webhook services. Storage selection is NOT among them anymore
// (context-only, D1); the remaining writes isolate non-storage legacy readers
// and disable outbound polling.
process.env.APPDATA = testRoot;
process.env.LOCALAPPDATA = testRoot;
// Keep Windows' real PROGRAMDATA, USERPROFILE, and HOME so Node can resolve
// cmd.exe and platform binaries. AGNT persistence is isolated by the admitted
// nope root above.
process.env.AGNT_DISABLE_EXTERNAL_POLLING = 'true';
process.env.IS_WORKFLOW_PROCESS = 'false';
process.env.REMOTE_URL = 'http://127.0.0.1:1';

// The shell tool defaults to <root>/projects. Create it explicitly so an
// ENOENT cannot be mistaken for a successful passthrough assertion.
fs.mkdirSync(path.join(testRoot, 'projects'), { recursive: true });

export const NOPE_TEST_ROOT = testRoot;
export const NOPE_TEST_AUDIT_LOG = path.join(testRoot, 'security-audit.jsonl');

// sqlite connections imported by the E2E surface outlive individual tests.
// Delete only this worker's unique directory on process exit. Never sweep
// sibling test directories: Vitest may be running them concurrently.
process.once('exit', () => {
  try {
    fs.rmSync(testRoot, { recursive: true, force: true });
  } catch {
    // Windows may retain sqlite handles until process teardown completes.
  }
});
