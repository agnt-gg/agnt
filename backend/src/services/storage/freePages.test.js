import { describe, it, expect, afterEach } from 'vitest';
import sqlite3 from 'sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { reclaimFreePages, databaseSpaceStats } from './freePages.js';

/**
 * Returning free pages to the OS, on real database files with the app's
 * journal mode. Pins the run() trap (one page freed per statement), the
 * reserve, the limits, interruption, and that no live data is touched.
 */

const opened = [];
const exec = (db, sql) => new Promise((resolve, reject) => db.exec(sql, (err) => (err ? reject(err) : resolve())));
const all = (db, sql) => new Promise((resolve, reject) => db.all(sql, (err, rows) => (err ? reject(err) : resolve(rows))));

async function database({ incremental, rows = 3000, keep = 0 }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'free-pages-'));
  const db = new sqlite3.Database(path.join(dir, 'agnt.db'));
  opened.push({ db, dir });
  await exec(db, `${incremental ? 'PRAGMA auto_vacuum = INCREMENTAL;' : ''} PRAGMA journal_mode = WAL;
    CREATE TABLE kept (id INTEGER PRIMARY KEY, body BLOB);
    CREATE TABLE scratch (id INTEGER PRIMARY KEY, body BLOB);
    WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<${keep}) INSERT INTO kept(body) SELECT randomblob(2000) FROM n WHERE ${keep} > 0;
    WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<${rows}) INSERT INTO scratch(body) SELECT randomblob(3000) FROM n;
    DELETE FROM scratch;`);
  return db;
}

afterEach(async () => {
  for (const { db, dir } of opened.splice(0)) {
    await new Promise((resolve) => db.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('reclaimFreePages', () => {
  it('leaves a database without incremental auto_vacuum completely alone', async () => {
    const db = await database({ incremental: false });
    const before = await databaseSpaceStats(db);
    const result = await reclaimFreePages(db, { keepFreeBytes: 0, pauseMs: 0 });
    expect(result.status).toBe('skipped:auto_vacuum=0');
    expect(await databaseSpaceStats(db)).toEqual(before);
  });

  it('frees every requested page in one statement (the run() trap freed one)', async () => {
    const db = await database({ incremental: true });
    let steps = 0;
    const result = await reclaimFreePages(db, { keepFreeBytes: 0, stepPages: 500, pauseMs: 0, shouldStop: () => steps++ >= 1 });
    expect(result.status).toBe('stopped');
    expect(result.freelistPagesReleased).toBe(500);
    expect(result.before.freelistCount - result.after.freelistCount).toBe(500);
    expect(result.pagesFreed).toBeGreaterThanOrEqual(500);
  });

  it('returns the free pages to the OS down to the reserve, and the file shrinks', async () => {
    const db = await database({ incremental: true });
    const before = await databaseSpaceStats(db);
    expect(before.freelistCount).toBeGreaterThan(2500);

    const keepPages = 100;
    const result = await reclaimFreePages(db, { keepFreeBytes: keepPages * before.pageSize, pauseMs: 0 });

    expect(result.status).toBe('complete');
    expect(result.after.freelistCount).toBe(keepPages);
    expect(result.freelistPagesReleased).toBe(before.freelistCount - keepPages);
    // The file shrinks by at least the released pages (plus pointer-map pages).
    expect(result.pagesFreed).toBe(before.pageCount - result.after.pageCount);
    expect(result.pagesFreed).toBeGreaterThanOrEqual(result.freelistPagesReleased);
    expect(result.bytesFreed).toBe(result.pagesFreed * before.pageSize);
  });

  it('stops at maxPages', async () => {
    const db = await database({ incremental: true });
    const result = await reclaimFreePages(db, { keepFreeBytes: 0, maxPages: 700, stepPages: 300, pauseMs: 0 });
    expect(result.freelistPagesReleased).toBe(700);
  });

  it('never changes live data', async () => {
    const db = await database({ incremental: true, keep: 500 });
    const rowsBefore = await all(db, 'SELECT id, hex(body) AS body FROM kept ORDER BY id');
    expect(rowsBefore).toHaveLength(500);
    await reclaimFreePages(db, { keepFreeBytes: 0, pauseMs: 0 });
    expect(await all(db, 'SELECT id, hex(body) AS body FROM kept ORDER BY id')).toEqual(rowsBefore);
    expect(await all(db, 'PRAGMA integrity_check')).toEqual([{ integrity_check: 'ok' }]);
  });
});
