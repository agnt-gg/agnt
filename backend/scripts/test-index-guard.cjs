// Three-case test for the guarded activity-index migration.
//
//   Case 1  small table  -> index builds inline at boot
//   Case 2  big table    -> deferred at boot, builds once DB is idle
//   Case 3  big table, never idle -> force-builds after MAX_GATED_ATTEMPTS
//
// Each case boots the REAL database module (guard-test-boot.mjs) against a
// scratch USER_DATA_PATH. "Big" is faked by inserting a single row at
// rowid=10,000,000 — the guard's MAX(rowid) heuristic sees a whale table
// without us writing 10M rows. Timings are compressed via the documented
// AGNT_INDEX_GUARD_* env hooks.
//
// Usage: node scripts/test-index-guard.cjs
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const BACKEND = path.resolve(__dirname, '..');
const RUNNER = path.join(__dirname, 'guard-test-boot.mjs');

function makeScratch(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `agnt-guard-${name}-`));
  fs.mkdirSync(path.join(dir, 'Data'), { recursive: true });
  return dir;
}

function seedBigTable(scratchRoot) {
  // Minimal base-schema node_executions with a fake whale rowid. The module's
  // CREATE TABLE IF NOT EXISTS will skip it; its ALTER migrations add the
  // token columns; the guard's MAX(rowid) then reports ~10M rows.
  const db = new DatabaseSync(path.join(scratchRoot, 'Data', 'agnt.db'));
  db.exec(`CREATE TABLE node_executions (
    id TEXT PRIMARY KEY,
    execution_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    end_time DATETIME,
    status TEXT NOT NULL,
    input JSON,
    output JSON,
    error TEXT,
    credits_used REAL DEFAULT 0
  )`);
  db.prepare(
    `INSERT INTO node_executions (rowid, id, execution_id, node_id, status) VALUES (?, ?, ?, ?, ?)`
  ).run(10000000, 'fake-whale-row', 'exec-x', 'node-y', 'completed');
  db.close();
}

function bootAndCapture(scratchRoot, extraEnv, timeoutMs) {
  // spawnSync, not execFileSync: console.warn/error write to stderr, and the
  // deferral + force warnings we assert on live there.
  const res = spawnSync(process.execPath, [RUNNER], {
    cwd: BACKEND,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
    env: {
      ...process.env,
      USER_DATA_PATH: scratchRoot,
      GUARDTEST_TIMEOUT_MS: String(timeoutMs - 5000),
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return (res.stdout || '') + '\n' + (res.stderr || '') + (res.error ? '\nRUNNER_ERROR: ' + res.error.message : '');
}

function get(re, out) {
  const m = out.match(re);
  return m ? m[1] : null;
}

let failures = 0;
function assert(label, cond, detail) {
  console.log(`  ${cond ? '✅' : '❌'} ${label}${cond ? '' : ` — ${String(detail).replace(/\s+/g, ' ').slice(-200)}`}`);
  if (!cond) failures++;
}

// ---------------------------------------------------------------------------
console.log('CASE 1: small table -> inline build at boot');
{
  const scratch = makeScratch('small');
  const out = bootAndCapture(scratch, {}, 30000);
  assert('boot ok', out.includes('GUARDTEST boot_ok'), out.slice(-800));
  assert('index present at boot', get(/GUARDTEST index_at_boot=(\w+)/, out) === 'true', out.slice(-800));
  assert('no deferral warning', !out.includes('deferring idx_node_executions_exec_tokens'), 'deferred unexpectedly');
  fs.rmSync(scratch, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
console.log('CASE 2: big table -> deferred at boot, builds when idle');
{
  const scratch = makeScratch('big-idle');
  seedBigTable(scratch);
  const out = bootAndCapture(
    scratch,
    {
      // 4s > the runner's 1.5s at-boot sample, so "deferred" is observable
      // as index_at_boot=false before the idle build fires.
      AGNT_INDEX_GUARD_RETRY_MS: '4000',
      AGNT_INDEX_GUARD_IDLE_MS: '1', // any WAL older than 1ms counts as idle
      AGNT_INDEX_GUARD_MAX_ATTEMPTS: '12',
    },
    30000
  );
  assert('boot ok', out.includes('GUARDTEST boot_ok'), out.slice(-800));
  assert('deferral warning logged', out.includes('deferring idx_node_executions_exec_tokens'), out.slice(-800));
  assert('index NOT present at boot', get(/GUARDTEST index_at_boot=(\w+)/, out) === 'false', out.slice(-800));
  assert('index built later (idle window)', get(/GUARDTEST index_final=(\w+)/, out) === 'true', out.slice(-800));
  assert('build completion logged', /idx_node_executions_exec_tokens built in [\d.]+s/.test(out), out.slice(-800));
  fs.rmSync(scratch, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
console.log('CASE 3: big table, never idle -> force-build after max attempts');
{
  const scratch = makeScratch('big-busy');
  seedBigTable(scratch);
  const out = bootAndCapture(
    scratch,
    {
      AGNT_INDEX_GUARD_RETRY_MS: '800',
      AGNT_INDEX_GUARD_IDLE_MS: '999999999', // nothing is ever "idle"
      AGNT_INDEX_GUARD_MAX_ATTEMPTS: '2', // force on the 3rd check (~2.4s)
    },
    30000
  );
  assert('boot ok', out.includes('GUARDTEST boot_ok'), out.slice(-800));
  assert('deferral warning logged', out.includes('deferring idx_node_executions_exec_tokens'), out.slice(-800));
  assert('force warning logged', out.includes('never went idle'), out.slice(-800));
  assert('index force-built', get(/GUARDTEST index_final=(\w+)/, out) === 'true', out.slice(-800));
  fs.rmSync(scratch, { recursive: true, force: true });
}

console.log(failures === 0 ? '\n✅ ALL GUARD CASES PASS' : `\n❌ ${failures} assertion(s) failed`);
process.exit(failures === 0 ? 0 : 1);
