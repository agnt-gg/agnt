// PR145 BUGFIX-20260913 — reviewer test T1 (live-module D4 pin).
//
// admitTestRoot AFTER the database module has been imported: the shared
// PathManager singleton still resolves the OLD root while the live
// registration names the NEW one — a fresh import of database/index.js
// must fail CLOSED on the D4 equality check (no write probe, no SQLite
// constructor). The vm harness in preopenSafety.test.js proves this
// ordering only against MOCKED fs/sqlite3 and a FIXTURE context; this
// file pins the LIVE module chain (real PathManager singleton, real
// storage context, real ancestor validation).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

process.env.NODE_ENV = 'test';

const CTX_URL = new URL('../../../backend/src/utils/testStorageContext.js', import.meta.url);
const DB_URL = new URL('../../../backend/src/models/database/index.js', import.meta.url);
const KEY_V3 = Symbol.for('agnt.test.storage.v3.registration');

test('T1: live database/index.js re-import after admitTestRoot fails closed on D4', async () => {
  const ctx = await import(CTX_URL.href);
  await ctx.initializeTestStorage();
  const db1 = await import(DB_URL.href); // PathManager singleton binds to root A; schema boots on A
  await db1.dbReady;

  const live = ctx.getStorageContext();
  const rootB = fs.mkdtempSync(fs.realpathSync(live.admittedParent) + '/agnt-d4-b-');
  const saved = globalThis[KEY_V3];
  try {
    ctx.admitTestRoot(rootB); // registration names B; the singleton still resolves A/Data
    await assert.rejects(
      () => import(DB_URL.href + '?d4=reimport'),
      /not the admitted storage context data directory/
    );
  } finally {
    globalThis[KEY_V3] = saved; // restore root A as the active root
    fs.rmSync(rootB, { recursive: true, force: true });
  }
});
