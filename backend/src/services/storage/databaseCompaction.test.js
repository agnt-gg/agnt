import { describe, it, expect, afterEach } from 'vitest';
import sqlite3 from 'sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { compactDatabase, getCompactionState, requiredFreeBytes } from './databaseCompaction.js';
import { reclaimFreePages, databaseSpaceStats } from './freePages.js';

/**
 * The one-off rebuild, on real WAL database files while the "app" connection
 * stays open, as it does in production. Pins: the mode changes, the file
 * shrinks, every row survives, the later incremental pass starts working, and
 * every refusal leaves the file untouched.
 */

const opened = [];
const exec = (db, sql) => new Promise((resolve, reject) => db.exec(sql, (err) => (err ? reject(err) : resolve())));
const all = (db, sql) => new Promise((resolve, reject) => db.all(sql, (err, rows) => (err ? reject(err) : resolve(rows))));
const plentyOfRoom = async () => Number.MAX_SAFE_INTEGER;

async function legacyDatabase({ incremental = false, kept = 400, scratch = 1500 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-compaction-'));
  const file = path.join(dir, 'agnt.db');
  const db = new sqlite3.Database(file);
  opened.push({ db, dir });
  await exec(db, `${incremental ? 'PRAGMA auto_vacuum = INCREMENTAL;' : ''} PRAGMA journal_mode = WAL; PRAGMA temp_store = MEMORY;
    CREATE TABLE kept (id INTEGER PRIMARY KEY, body BLOB);
    CREATE INDEX kept_body ON kept(length(body));
    CREATE TABLE scratch (id INTEGER PRIMARY KEY, body BLOB);
    WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<${kept}) INSERT INTO kept(body) SELECT randomblob(2000) FROM n;
    WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<${scratch}) INSERT INTO scratch(body) SELECT randomblob(3000) FROM n;
    DELETE FROM scratch;`);
  return { db, file };
}

const fingerprint = async (db) => (await all(db, 'SELECT count(*) AS n, sum(length(body)) AS bytes, hex(group_concat(substr(body, 1, 4), \'\')) AS head FROM (SELECT body FROM kept ORDER BY id)'))[0];

afterEach(async () => {
  for (const { db, dir } of opened.splice(0)) {
    await new Promise((resolve) => db.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('compactDatabase', { timeout: 60_000 }, () => {
  it('rebuilds a legacy file: incremental mode, smaller file, every row intact', async () => {
    const { db, file } = await legacyDatabase();
    const rowsBefore = await fingerprint(db);
    const sizeBefore = fs.statSync(file).size;

    const result = await compactDatabase(file, { freeBytesOf: plentyOfRoom });

    expect(result.status).toBe('complete');
    expect(result.before.autoVacuum).toBe(0);
    expect(result.before.freelistCount).toBeGreaterThan(500);
    expect(result.after.autoVacuum).toBe(2);
    expect(result.after.freelistCount).toBe(0);
    expect(result.bytesFreed).toBeGreaterThan(3_000_000);
    expect(fs.statSync(file).size).toBeLessThan(sizeBefore - 3_000_000);

    // Seen through the connection that was open the whole time.
    expect(await fingerprint(db)).toEqual(rowsBefore);
    expect((await all(db, 'PRAGMA integrity_check'))[0].integrity_check).toBe('ok');
    expect((await all(db, 'PRAGMA journal_mode'))[0].journal_mode).toBe('wal');
    expect((await all(db, "SELECT name FROM sqlite_master WHERE type = 'index'")).map((r) => r.name)).toContain('kept_body');
  });

  it('lets the ordinary incremental pass return space afterwards', async () => {
    const { db, file } = await legacyDatabase();
    expect((await reclaimFreePages(db, { keepFreeBytes: 0, pauseMs: 0 })).status).toBe('skipped:auto_vacuum=0');

    await compactDatabase(file, { freeBytesOf: plentyOfRoom });
    await exec(db, 'WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<800) INSERT INTO scratch(body) SELECT randomblob(3000) FROM n; DELETE FROM scratch;');

    const reclaimed = await reclaimFreePages(db, { keepFreeBytes: 0, pauseMs: 0 });
    expect(reclaimed.status).toBe('complete');
    expect(reclaimed.pagesFreed).toBeGreaterThan(400);
  });

  it('the open connection keeps reading and writing after the rebuild', async () => {
    const { db, file } = await legacyDatabase();
    await compactDatabase(file, { freeBytesOf: plentyOfRoom });
    await exec(db, "INSERT INTO kept(body) VALUES (x'0102')");
    expect((await all(db, 'SELECT count(*) AS n FROM kept'))[0].n).toBe(401);
  });

  it('leaves a file that is already incremental alone', async () => {
    const { db, file } = await legacyDatabase({ incremental: true });
    const before = await databaseSpaceStats(db);
    const result = await compactDatabase(file, { freeBytesOf: plentyOfRoom });
    expect(result.status).toBe('skipped:already-incremental');
    expect(await databaseSpaceStats(db)).toEqual(before);
  });

  it('changes nothing when there is not enough free disk', async () => {
    const { db, file } = await legacyDatabase();
    const before = await databaseSpaceStats(db);
    const need = requiredFreeBytes(before);

    const result = await compactDatabase(file, { freeBytesOf: async () => need - 1 });

    expect(result.status).toBe('skipped:insufficient-disk');
    expect(result.requiredBytes).toBe(need);
    expect(result.availableBytes).toBe(need - 1);
    expect(await databaseSpaceStats(db)).toEqual(before);
  });

  it('checks both the database volume and the temp volume', async () => {
    const { file } = await legacyDatabase();
    const tempDir = path.join(os.tmpdir(), 'elsewhere');
    const result = await compactDatabase(file, { tempDir, freeBytesOf: async (dir) => (dir === tempDir ? 0 : Number.MAX_SAFE_INTEGER) });
    expect(result.status).toBe('skipped:insufficient-disk');
  });

  it('reports a failure and changes nothing when another writer holds the lock', async () => {
    const { db, file } = await legacyDatabase();
    const rowsBefore = await fingerprint(db);
    await exec(db, 'BEGIN IMMEDIATE');
    try {
      const result = await compactDatabase(file, { freeBytesOf: plentyOfRoom, busyTimeoutMs: 100 });
      expect(result.status).toBe('failed');
      expect(result.error).toMatch(/SQLITE_BUSY|locked/i);
    } finally {
      await exec(db, 'ROLLBACK');
    }
    expect((await databaseSpaceStats(db)).autoVacuum).toBe(0);
    expect(await fingerprint(db)).toEqual(rowsBefore);
  });

  it('reports a failure for a file that does not exist', async () => {
    const result = await compactDatabase(path.join(os.tmpdir(), 'db-compaction-missing', 'agnt.db'), { freeBytesOf: plentyOfRoom });
    expect(result.status).toBe('failed');
    expect(fs.existsSync(path.join(os.tmpdir(), 'db-compaction-missing'))).toBe(false);
  });

  it('runs one rebuild at a time and remembers the last result', async () => {
    const { file } = await legacyDatabase();
    const [first, second] = await Promise.all([
      compactDatabase(file, { freeBytesOf: plentyOfRoom }),
      compactDatabase(file, { freeBytesOf: plentyOfRoom }),
    ]);
    expect([first.status, second.status].sort()).toEqual(['complete', 'skipped:already-running']);
    const state = getCompactionState();
    expect(state.running).toBe(false);
    expect(state.last.status).toBe('complete');
    expect(typeof state.last.finishedAt).toBe('string');
  });
});
