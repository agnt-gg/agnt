// PR145 ROOT-CAUSE (task a15f5f16) — T8 pin, corruption mode: READ-ONLY EMPTY.
//
// Pre-fix (RED, evidence/red-*): a valid 0-byte agnt.db with mode 0444 killed
// the process with an UNCAUGHT SQLITE_READONLY from the callback-less pack
// (attribution: only `journal_mode = WAL` and `auto_vacuum = INCREMENTAL`
// touch the file; auto_vacuum's failure was the uncaught one) BEFORE the D10
// dbReady path could reject.
//
// Same pinned contract as t8Garbage.test.js, with SQLITE_READONLY.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

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

test('T8 read-only empty agnt.db: one truthful rejected readiness, original error evidence, no uncaught, no fallback', async () => {
  const ctx = await import(CTX_URL.href);
  ctx.initializeTestStorage();
  const live = ctx.getStorageContext();
  const dataDir = path.join(live.root, 'Data');
  fs.mkdirSync(dataDir, { recursive: true });
  const dbFile = path.join(dataDir, 'agnt.db');
  fs.writeFileSync(dbFile, Buffer.alloc(0));
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
  assert.equal([...logs, ...errors].some((m) => m.includes('All tables created successfully')), false);
  assert.equal([...logs, ...errors].some((m) => m.includes('Database initialization complete')), false);

  const afterBytes = crypto.createHash('sha256').update(fs.readFileSync(dbFile)).digest('hex');
  assert.equal(afterBytes, before, 'read-only file untouched — no delete/recreate fallback');

  assert.equal(uncaughtCount, 0);
  assert.equal(unhandledCount, 0);
});
