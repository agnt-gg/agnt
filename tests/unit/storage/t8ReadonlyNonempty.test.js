// PR145 ROOT-CAUSE (task a15f5f16) — T8 pin, corruption mode: READ-ONLY
// NON-EMPTY (a REAL database, seeded through the repo's own sqlite3 driver).
//
// Pre-fix (RED, bringup2 + evidence/red-*): a valid populated agnt.db with
// mode 0444 died UNCAUGHT SQLITE_READONLY. Root cause found in this stage:
// on a NON-EMPTY read-only database the entire performance-PRAGMA pack
// SUCCEEDS (auto_vacuum is a documented no-op on non-empty databases), so
// the callback-less pack was not even the killer here — the first
// callback-less schema statement was. The connection-level signal is
// journal_mode = WAL, the one boot PRAGMA that always touches the file:
// its SQLITE_READONLY now gates readiness (T8b).
//
// Pinned contract (real driver, real module chain, no mocks):
//   • dbReady rejects exactly like the driver reported it: SQLITE_READONLY
//   • the rejection is stable (no retry, no flip to resolved)
//   • ctx.init records state 'error' with the original message (D10)
//   • exactly ONE '[DB] connection readiness failed' line; ensureSchema
//     never starts ('All tables created successfully' never logs)
//   • the ORIGINAL WAL evidence line still logs (evidence preservation)
//   • the read-only file is NOT deleted/recreated — byte-identical
//   • zero uncaught exceptions and zero unhandled rejections
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

process.env.NODE_ENV = 'test';

const CTX_URL = new URL('../../../backend/src/utils/testStorageContext.js', import.meta.url);
const DB_URL = new URL('../../../backend/src/models/database/index.js', import.meta.url);
const reqAtRepo = createRequire(new URL('../../../package.json', import.meta.url));

let uncaughtCount = 0;
let unhandledCount = 0;
process.on('uncaughtException', () => { uncaughtCount++; });
process.on('unhandledRejection', () => { unhandledCount++; });

const logLines = [];
console.log = (...a) => logLines.push(['log', a.map(String).join(' ')]);
console.error = (...a) => logLines.push(['error', a.map(String).join(' ')]);

test('T8 read-only non-empty agnt.db: one truthful rejected readiness, original error evidence, no uncaught, no fallback', async () => {
  const sqlite3 = reqAtRepo('sqlite3');
  const ctx = await import(CTX_URL.href);
  ctx.initializeTestStorage();
  const live = ctx.getStorageContext();
  const dataDir = path.join(live.root, 'Data');
  fs.mkdirSync(dataDir, { recursive: true });
  const dbFile = path.join(dataDir, 'agnt.db');
  await new Promise((res, rej) => {
    const tmp = new sqlite3.Database(dbFile, (err) => {
      if (err) return rej(err);
      tmp.exec('CREATE TABLE t8_marker (x TEXT); INSERT INTO t8_marker VALUES (\'pad\');', (err2) => {
        if (err2) return rej(err2);
        tmp.close((err3) => (err3 ? rej(err3) : res()));
      });
    });
  });
  fs.chmodSync(dbFile, 0o444);
  const before = crypto.createHash('sha256').update(fs.readFileSync(dbFile)).digest('hex');

  const db = await import(DB_URL.href);

  await assert.rejects(() => db.dbReady, (err) => err.code === 'SQLITE_READONLY');
  await assert.rejects(() => db.dbReady, (err) => err.code === 'SQLITE_READONLY'); // stable, no replay

  await new Promise((r) => setTimeout(r, 150));

  const after = ctx.getStorageContext();
  assert.equal(after.init.state, 'error');
  assert.match(String(after.init.error), /SQLITE_READONLY/);

  const errors = logLines.filter(([k]) => k === 'error').map(([, m]) => m);
  const logs = logLines.filter(([k]) => k === 'log').map(([, m]) => m);
  assert.equal(errors.filter((m) => m.includes('[DB] connection readiness failed')).length, 1);
  assert.equal(errors.some((m) => m.includes('Failed to enable WAL mode')), true);
  assert.equal([...logs, ...errors].some((m) => m.includes('All tables created successfully')), false,
    'ensureSchema never started against the dead connection');
  assert.equal([...logs, ...errors].some((m) => m.includes('Database initialization complete')), false);

  const afterBytes = crypto.createHash('sha256').update(fs.readFileSync(dbFile)).digest('hex');
  assert.equal(afterBytes, before, 'read-only database untouched — no delete/recreate fallback');

  assert.equal(uncaughtCount, 0);
  assert.equal(unhandledCount, 0);
});
