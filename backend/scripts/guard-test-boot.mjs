// Test runner: boots the REAL database module against a scratch data dir
// (USER_DATA_PATH) and reports when/whether idx_node_executions_exec_tokens
// appears. The orchestrator (test-index-guard.cjs) sets env and asserts on
// the structured GUARDTEST lines below.
//
// Not for production use.
import db, { dbReady } from '../src/models/database/index.js';

const TIMEOUT_MS = Number(process.env.GUARDTEST_TIMEOUT_MS) || 15000;
const POLL_MS = 250;

const indexExists = () =>
  new Promise((resolve, reject) =>
    db.get(
      `SELECT name FROM sqlite_master WHERE type='index' AND name='idx_node_executions_exec_tokens'`,
      (err, row) => (err ? reject(err) : resolve(!!row))
    )
  );

await dbReady;
console.log('GUARDTEST boot_ok');

// Give the async migration chain a beat, then sample: present-at-boot vs
// appearing-later distinguishes the inline path from the deferred path.
await new Promise((r) => setTimeout(r, 1500));
const atBoot = await indexExists();
console.log(`GUARDTEST index_at_boot=${atBoot}`);

const t0 = Date.now();
let finalState = atBoot;
while (!finalState && Date.now() - t0 < TIMEOUT_MS) {
  await new Promise((r) => setTimeout(r, POLL_MS));
  finalState = await indexExists();
}
console.log(`GUARDTEST index_final=${finalState} waited_ms=${Date.now() - t0}`);
process.exit(0);
