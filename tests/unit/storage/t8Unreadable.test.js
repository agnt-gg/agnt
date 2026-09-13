// PR145 ROOT-CAUSE (task a15f5f16) — T8 pin, corruption mode: UNREADABLE
// FILE (open EACCES → SQLITE_CANTOPEN).
//
// Pre-fix (RED, evidence/red-*): when the OPEN itself fails, the queued
// statements on the never-opened connection never run ANY callback — the
// pre-fix code only console.error'd and dbReady stayed PENDING FOREVER (node
// drained and exited 13 "unsettled top-level await"). A readiness result that
// never arrives is the third T8 failure shape: not uncaught, not rejected —
// silence.
//
// Post-fix: the open-callback error is routed into the single
// connection-readiness rejection, so awaiters get one truthful rejected
// result (SQLITE_CANTOPEN) and the legacy 'Database initialization error:'
// evidence line still logs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

process.env.NODE_ENV = 'test';

const CTX_URL = new URL('../../../backend/src/utils/testStorageContext.js', import.meta.url);
const DB_URL = new URL('../../../backend/src/models/database/index.js', import.meta.url);

let uncaughtCount = 0;
let unhandledCount = 0;
process.on('uncaughtException', () => { uncaughtCount++; });
process.on('unhandledRejection', () => { unhandledCount++; });

const logLines = [];
console.log = (...a) => logLines.push(['log', a.map(String).join(' ')]);
console.error = (...a) => logLines.push(['error', a.map(String).join(' ')]);

test('T8 unreadable agnt.db: open failure yields one truthful rejected readiness (no eternal pending)', async () => {
  const ctx = await import(CTX_URL.href);
  ctx.initializeTestStorage();
  const live = ctx.getStorageContext();
  const dataDir = path.join(live.root, 'Data');
  fs.mkdirSync(dataDir, { recursive: true });
  const dbFile = path.join(dataDir, 'agnt.db');
  fs.writeFileSync(dbFile, Buffer.alloc(0));
  const sizeBefore = fs.statSync(dbFile).size;

  // chmod LAST: the file itself becomes unreadable (runs as the repo's
  // normal non-root user; under uid 0 the mode-000 file stays readable and
  // this pin would not apply).
  fs.chmodSync(dbFile, 0o000);

  const db = await import(DB_URL.href);

  await assert.rejects(() => db.dbReady, (err) => err.code === 'SQLITE_CANTOPEN');
  await assert.rejects(() => db.dbReady, (err) => err.code === 'SQLITE_CANTOPEN'); // stable, no replay

  await new Promise((r) => setTimeout(r, 150));

  const after = ctx.getStorageContext();
  assert.equal(after.init.state, 'error');
  assert.match(String(after.init.error), /SQLITE_CANTOPEN/);

  const errors = logLines.filter(([k]) => k === 'error').map(([, m]) => m);
  const logs = logLines.filter(([k]) => k === 'log').map(([, m]) => m);
  assert.equal(errors.filter((m) => m.includes('[DB] connection readiness failed')).length, 1);
  assert.equal(errors.some((m) => m.includes('Database initialization error')), true,
    'original open-failure evidence line still logged');
  assert.equal([...logs, ...errors].some((m) => m.includes('All tables created successfully')), false);
  assert.equal([...logs, ...errors].some((m) => m.includes('Database initialization complete')), false);

  // The file is unreadable by design — verify it was not recreated via stat
  // identity (size + permission bits), not by reading it.
  const afterStat = fs.statSync(dbFile);
  assert.equal(afterStat.size, sizeBefore, 'file not recreated (size stable)');
  assert.equal(afterStat.mode & 0o777, 0o000, 'still mode 000 — no delete/recreate fallback');

  assert.equal(uncaughtCount, 0);
  assert.equal(unhandledCount, 0);
});
