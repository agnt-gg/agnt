import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sqlite3 from 'sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { installConnectionGate, withTransaction } from './connectionGate.js';

// File-backed WAL databases on purpose: the failure this guards against needs
// real lock contention between connections, which :memory: cannot produce.

let dir;
const handles = [];

const open = (file) => new Promise((resolve, reject) => {
  const handle = new sqlite3.Database(file, (e) => (e ? reject(e) : resolve(handle)));
  handles.push(handle);
});
const runOn = (handle, sql, params = []) => new Promise((resolve, reject) => {
  handle.run(sql, params, function (e) { e ? reject(e) : resolve(this); });
});
const getOn = (handle, sql, params = []) => new Promise((resolve, reject) => {
  handle.get(sql, params, (e, row) => (e ? reject(e) : resolve(row)));
});

async function sharedDb({ busyMs = 10000, ...gateOptions } = {}) {
  const file = path.join(dir, `gate-${handles.length}.db`);
  const db = await open(file);
  await runOn(db, 'PRAGMA journal_mode = WAL');
  await runOn(db, `PRAGMA busy_timeout = ${busyMs}`);
  await runOn(db, 'CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
  const gate = installConnectionGate(db, gateOptions);
  return { db, gate, file };
}

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-gate-')); });
afterEach(async () => {
  await Promise.all(handles.splice(0).map((h) => new Promise((r) => h.close(() => r()))));
  fs.rmSync(dir, { recursive: true, force: true });
});

// Every case creates a real WAL file on disk; under a loaded full-suite run
// that alone can approach the 5 s default, so the budget is explicit.
describe('connection gate', { timeout: 30000 }, () => {
  it('a held write lock elsewhere cannot starve the thread pool into a SQLITE_BUSY convoy', async () => {
    // The 2026-10-06 incident: a second connection held BEGIN IMMEDIATE while
    // the shared connection's waiting writes each pinned a pool thread; once
    // they filled the pool the holder could not COMMIT, and every waiter failed
    // with SQLITE_BUSY ~11 s apart. Ungated, this test hangs for minutes and
    // every write fails. Gated, one write waits on a thread and the rest in JS.
    const { db, file } = await sharedDb();
    const holder = await open(file);
    holder.configure('busyTimeout', 2000);
    await runOn(holder, 'BEGIN IMMEDIATE');
    await runOn(holder, "INSERT INTO t (v) VALUES ('held')");

    const writes = Array.from({ length: 64 }, (_, i) => runOn(db, 'INSERT INTO t (v) VALUES (?)', ['w' + i]));
    await new Promise((r) => setTimeout(r, 50));

    const started = Date.now();
    await runOn(holder, "INSERT INTO t (v) VALUES ('held-2')");
    await runOn(holder, 'COMMIT');
    expect(Date.now() - started).toBeLessThan(2000);

    const outcomes = await Promise.allSettled(writes);
    expect(outcomes.filter((o) => o.status === 'rejected')).toEqual([]);
    expect((await getOn(db, 'SELECT COUNT(*) AS n FROM t')).n).toBe(66);
  });

  it('keeps program order: a write fired without awaiting is visible to the next read', async () => {
    const { db } = await sharedDb();
    db.run("INSERT INTO t (v) VALUES ('fire-and-forget')");
    const row = await getOn(db, "SELECT COUNT(*) AS n FROM t WHERE v = 'fire-and-forget'");
    expect(row.n).toBe(1);
  });

  it('preserves the statement context sqlite3 gives callbacks (lastID, changes)', async () => {
    const { db } = await sharedDb();
    const inserted = await runOn(db, "INSERT INTO t (v) VALUES ('a')");
    expect(inserted.lastID).toBe(1);
    const updated = await runOn(db, "UPDATE t SET v = 'b'");
    expect(updated.changes).toBe(1);
  });

  it('reports statement errors to the callback and keeps serving afterwards', async () => {
    const { db } = await sharedDb();
    await expect(runOn(db, 'INSERT INTO missing_table VALUES (1)')).rejects.toThrow(/no such table/);
    await expect(runOn(db, "INSERT INTO t (v) VALUES ('after')")).resolves.toBeTruthy();
  });

  it('a transaction is atomic against writes issued while it is open', async () => {
    const { db } = await sharedDb();
    let releaseTransaction;
    const gate = new Promise((r) => { releaseTransaction = r; });

    const transaction = db.transaction(async () => {
      await runOn(db, "INSERT INTO t (v) VALUES ('inside')");
      await gate;
      throw new Error('abort');
    });
    // Issued while the transaction is open, from outside it.
    await new Promise((r) => setTimeout(r, 20));
    const outside = runOn(db, "INSERT INTO t (v) VALUES ('outside')");
    releaseTransaction();

    await expect(transaction).rejects.toThrow('abort');
    await outside;
    const rows = await new Promise((resolve, reject) => db.all('SELECT v FROM t ORDER BY id', (e, r) => (e ? reject(e) : resolve(r))));
    // The rollback removed only the transaction's own write; the outside write
    // neither joined it nor was lost with it.
    expect(rows.map((r) => r.v)).toEqual(['outside']);
  });

  it('statements inside a transaction run in it (reads see its writes; nesting joins)', async () => {
    const { db } = await sharedDb();
    const seen = await db.transaction(async () => {
      await runOn(db, "INSERT INTO t (v) VALUES ('x')");
      await db.transaction(async () => { await runOn(db, "INSERT INTO t (v) VALUES ('y')"); });
      return (await getOn(db, 'SELECT COUNT(*) AS n FROM t')).n;
    });
    expect(seen).toBe(2);
    expect((await getOn(db, 'SELECT COUNT(*) AS n FROM t')).n).toBe(2);
  });

  it('withTransaction works on a plain, ungated sqlite3 handle', async () => {
    const plain = await open(path.join(dir, 'plain.db'));
    await runOn(plain, 'CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
    await expect(withTransaction(plain, async () => {
      await runOn(plain, "INSERT INTO t (v) VALUES ('gone')");
      throw new Error('abort');
    })).rejects.toThrow('abort');
    await withTransaction(plain, () => runOn(plain, "INSERT INTO t (v) VALUES ('kept')"));
    expect((await getOn(plain, 'SELECT group_concat(v) AS vs FROM t')).vs).toBe('kept');
  });

  it('names whoever holds the connection too long', async () => {
    const warn = vi.fn();
    const { db } = await sharedDb({ slowHolderMs: 300, warn });
    await db.transaction(() => new Promise((r) => setTimeout(r, 900)), { label: 'slow test transaction' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('slow test transaction'));
  });

  it('installs once', async () => {
    const { db, gate } = await sharedDb();
    expect(installConnectionGate(db)).toBe(gate);
  });
});
