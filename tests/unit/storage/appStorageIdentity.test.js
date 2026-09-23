// PR145 BUGFIX-20260913 — REVIEW-20260913 RV-1 / reviewer test T10.
//
// initializeApplicationStorage must authorize by STABLE STORAGE IDENTITY
// (root + rootIdentity{dev,ino} + pid + generation), not by reference
// equality with the live registration object: its own module replaces that
// object via copy-on-write bookkeeping (recordStorageInit) during the
// database import, so a context captured BEFORE importing the database
// module referred to the SAME admitted storage yet was refused with
// 'context mismatch' (RV-1). The negatives pin the NON-WIDENING half:
// different root or generation, unfrozen copies, null, and a capture gone
// stale across admitTestRoot ALL still refuse.
//
// node:test file; imports the REAL database module (native sqlite3, full
// test-mode schema boot) inside the admitted synthetic root — no mocks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

process.env.NODE_ENV = 'test';

const CTX_URL = new URL('../../../backend/src/utils/testStorageContext.js', import.meta.url);
const DB_URL = new URL('../../../backend/src/models/database/index.js', import.meta.url);
const KEY_V3 = Symbol.for('agnt.test.storage.v3.registration');

test('RV-1/T10: stable context identity across copy-on-write metadata updates', async () => {
  const ctx = await import(CTX_URL.href);
  const captured = ctx.initializeTestStorage();

  const db = await import(DB_URL.href); // test-mode boot; recordStorageInit replaces the object ('initializing' → 'ready')
  await db.dbReady; // settle 'ready'

  const live = ctx.getStorageContext();
  assert.notEqual(captured, live); // premise of RV-1: the object was REPLACED, not mutated
  assert.equal(live.init.state, 'ready');

  // Positive: the pre-import capture (same identity tuple) is accepted.
  const policy = await db.initializeApplicationStorage(captured);
  assert.equal(policy.schema, false); // default test policy: the import chain already ensured the schema
  assert.equal(policy.staleRunSweep, 'none'); // and no maintenance step ran

  // Positive across an EXPLICIT copy-on-write update:
  const captured2 = ctx.getStorageContext();
  ctx.recordStorageInit('ready', null);
  assert.notEqual(ctx.getStorageContext(), captured2);
  await db.initializeApplicationStorage(captured2); // must not throw

  // Negatives — identity mismatch still refuses (no widening to any frozen object):
  await assert.rejects(() => db.initializeApplicationStorage(null), /context mismatch/);
  await assert.rejects(() => db.initializeApplicationStorage({ ...live }), /context mismatch/); // unfrozen copy
  await assert.rejects(
    () => db.initializeApplicationStorage(Object.freeze({ ...live, generation: live.generation + 1 })),
    /context mismatch/ // stale across resetTestStorage (generation moved)
  );
  const other = fs.mkdtempSync(path.join(live.admittedParent, 'agnt-rv1-other-'));
  try {
    await assert.rejects(
      () => db.initializeApplicationStorage(
        Object.freeze({ ...live, root: other, rootIdentity: live.rootIdentity, admittedRoots: Object.freeze([other]) })
      ),
      /context mismatch/ // foreign root
    );
  } finally {
    fs.rmSync(other, { recursive: true, force: true });
  }

  // Stale across admitTestRoot: the capture names the OLD root → refused.
  const saved = globalThis[KEY_V3];
  const switched = fs.mkdtempSync(path.join(live.admittedParent, 'agnt-rv1-switch-'));
  try {
    ctx.admitTestRoot(switched);
    assert.equal(ctx.getStorageContext().root, switched);
    await assert.rejects(() => db.initializeApplicationStorage(captured), /context mismatch/);
  } finally {
    globalThis[KEY_V3] = saved; // restore the pre-switch registration exactly
    fs.rmSync(switched, { recursive: true, force: true });
  }
});
