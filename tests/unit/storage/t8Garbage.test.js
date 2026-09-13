// PR145 ROOT-CAUSE (task a15f5f16) — T8 pin, corruption mode: GARBAGE FILE.
//
// Pre-fix (RED, evidence/red-*): a non-sqlite agnt.db seeded before import
// killed the process with an UNCAUGHT SQLITE_NOTADB from the callback-less
// performance-PRAGMA pack (first hit: `synchronous`, per the native
// attribution table) BEFORE the D10 dbReady path could reject — callers got
// a dead process, never a readiness result.
//
// Post-fix contract pinned here, on the REAL native driver and the REAL
// module chain (no mocks):
//   • dbReady rejects exactly like the driver reported it: code SQLITE_NOTADB
//   • the rejection is stable (awaiting again rejects identically — no retry,
//     no flip to resolved)
//   • ctx.init records state 'error' with the original SQLITE_* message (D10)
//   • exactly ONE '[DB] connection readiness failed' line; ensureSchema never
//     starts ('All tables created successfully' never logs)
//   • the ORIGINAL WAL evidence line still logs (evidence preservation)
//   • the corrupt file is NOT deleted/recreated (no fallback) — byte-identical
//   • zero uncaught exceptions and zero unhandled rejections
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

test('T8 garbage agnt.db: one truthful rejected readiness, original error evidence, no uncaught, no fallback', async () => {
  const ctx = await import(CTX_URL.href);
  ctx.initializeTestStorage();
  const live = ctx.getStorageContext();
  const dataDir = path.join(live.root, 'Data');
  fs.mkdirSync(dataDir, { recursive: true });
  const dbFile = path.join(dataDir, 'agnt.db');
  fs.writeFileSync(dbFile, 'this file is definitely not a sqlite database '.repeat(64));
  const before = crypto.createHash('sha256').update(fs.readFileSync(dbFile)).digest('hex');

  const db = await import(DB_URL.href);

  await assert.rejects(() => db.dbReady, (err) => err.code === 'SQLITE_NOTADB');
  await assert.rejects(() => db.dbReady, (err) => err.code === 'SQLITE_NOTADB'); // stable, no replay

  await new Promise((r) => setTimeout(r, 150)); // trailing async settle

  const after = ctx.getStorageContext();
  assert.equal(after.init.state, 'error');
  assert.match(String(after.init.error), /SQLITE_NOTADB/);

  const errors = logLines.filter(([k]) => k === 'error').map(([, m]) => m);
  const logs = logLines.filter(([k]) => k === 'log').map(([, m]) => m);
  assert.equal(errors.filter((m) => m.includes('[DB] connection readiness failed')).length, 1,
    'exactly one connection-readiness failure line');
  assert.equal(errors.some((m) => m.includes('Failed to enable WAL mode')), true,
    'original WAL failure evidence still logged');
  assert.equal([...logs, ...errors].some((m) => m.includes('All tables created successfully')), false,
    'ensureSchema never started against the dead connection');
  assert.equal([...logs, ...errors].some((m) => m.includes('Database initialization complete')), false);

  const afterBytes = crypto.createHash('sha256').update(fs.readFileSync(dbFile)).digest('hex');
  assert.equal(afterBytes, before, 'corrupt file untouched — no delete/recreate fallback');

  assert.equal(uncaughtCount, 0);
  assert.equal(unhandledCount, 0);
});
