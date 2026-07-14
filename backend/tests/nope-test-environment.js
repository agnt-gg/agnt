import fs from 'fs';
import os from 'os';
import path from 'path';

const TEST_ROOT_ENV = 'AGNT_NOPE_TEST_ROOT';

if (!process.env[TEST_ROOT_ENV]) {
  process.env[TEST_ROOT_ENV] = fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-nope-test-'));
}

const testRoot = process.env[TEST_ROOT_ENV];

// These variables are consumed at module-import time by PathManager,
// database/index.js, and the trigger receivers. Set them before importing any
// AGNT service module so tests never touch the real user database or poll
// remote email/webhook services.
process.env.AGNT_HOME = testRoot;
process.env.USER_DATA_PATH = testRoot;
process.env.APPDATA = testRoot;
process.env.LOCALAPPDATA = testRoot;
// Keep Windows' real PROGRAMDATA, USERPROFILE, and HOME so Node can resolve
// cmd.exe and platform binaries. AGNT persistence is already isolated by
// USER_DATA_PATH, AGNT_HOME, APPDATA, and LOCALAPPDATA.
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
