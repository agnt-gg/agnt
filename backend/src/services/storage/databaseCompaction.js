/**
 * databaseCompaction — rebuild the database file once, so it drops its free
 * pages and becomes auto_vacuum = INCREMENTAL.
 *
 * WHY THIS EXISTS
 * ---------------
 * auto_vacuum can only be chosen while a database is empty, so a file created
 * before database/index.js began setting it stays at 0 forever: its free pages
 * are reused but never handed back, and reclaimFreePages (freePages.js) skips
 * it. The one way to change the mode afterwards is a full VACUUM. After it,
 * the ordinary incremental pass keeps the file lean with no further rebuilds.
 *
 * HOW IT RUNS
 * -----------
 *  - On its own connection, with temp_store = FILE. The app's connection uses
 *    temp_store = MEMORY, and a rebuild made there would assemble the whole
 *    copy in RAM.
 *  - Only when there is room: the rebuild writes one copy to the temp
 *    directory and one through the WAL, so it needs about twice the live data
 *    free. Checked first; too little room changes nothing.
 *  - VACUUM is a single transaction. If it fails or the process stops, the
 *    file is exactly as it was.
 *  - It holds the write lock for its whole duration, so other writers wait.
 *    The caller decides when that is acceptable; nothing here runs on its own.
 *  - One at a time per process.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import sqlite3 from 'sqlite3';
import { databaseSpaceStats } from './freePages.js';

const INCREMENTAL = 2;
const SPACE_MARGIN_BYTES = 1024 * 1024 * 1024;

const all = (db, sql) => new Promise((resolve, reject) => db.all(sql, [], (err, rows) => (err ? reject(err) : resolve(rows || []))));
const open = (Database, file) => new Promise((resolve, reject) => {
  const db = new Database(file, sqlite3.OPEN_READWRITE, (err) => (err ? reject(err) : resolve(db)));
});
const close = (db) => new Promise((resolve) => db.close(() => resolve()));

/** Free bytes on the volume holding `dir`. */
export async function freeDiskBytes(dir) {
  const stats = await fs.promises.statfs(dir);
  return Number(stats.bavail) * Number(stats.bsize);
}

/** Free space a rebuild of a database with these stats needs, per volume. */
export function requiredFreeBytes(stats) {
  return stats.liveBytes * 2 + SPACE_MARGIN_BYTES;
}

let running = null;
let lastResult = null;

/** { running, last } for the status endpoint. */
export function getCompactionState() {
  return { running: running !== null, last: lastResult };
}

async function rebuild(dbPath, { Database, freeBytesOf, busyTimeoutMs, tempDir }) {
  const startedAt = Date.now();
  const db = await open(Database, dbPath);
  try {
    await all(db, `PRAGMA busy_timeout = ${Math.max(0, Math.floor(busyTimeoutMs))}`);
    await all(db, 'PRAGMA temp_store = FILE');
    const before = await databaseSpaceStats(db);
    if (before.autoVacuum === INCREMENTAL) return { status: 'skipped:already-incremental', before, after: before, bytesFreed: 0 };

    const requiredBytes = requiredFreeBytes(before);
    const availableBytes = Math.min(await freeBytesOf(path.dirname(dbPath)), await freeBytesOf(tempDir));
    if (availableBytes < requiredBytes) {
      return { status: 'skipped:insufficient-disk', requiredBytes, availableBytes, before, after: before, bytesFreed: 0 };
    }

    await all(db, 'PRAGMA auto_vacuum = INCREMENTAL');
    await all(db, 'VACUUM');
    await all(db, 'PRAGMA wal_checkpoint(TRUNCATE)');
    const after = await databaseSpaceStats(db);
    return { status: 'complete', before, after, bytesFreed: before.fileBytes - after.fileBytes, durationMs: Date.now() - startedAt };
  } finally {
    await close(db);
  }
}

/**
 * Rebuild the database at `dbPath`. Never throws: a failure is a result.
 *
 * @param {string} dbPath
 * @param {object} [options]
 * @param {typeof sqlite3.Database} [options.Database]
 * @param {(dir: string) => Promise<number>} [options.freeBytesOf]
 * @param {number} [options.busyTimeoutMs]  how long to wait for the write lock
 * @param {string} [options.tempDir]        where SQLite writes its temp copy
 * @returns {Promise<{status: string, before?: object, after?: object, bytesFreed?: number, durationMs?: number, error?: string}>}
 */
export async function compactDatabase(dbPath, {
  Database = sqlite3.Database,
  freeBytesOf = freeDiskBytes,
  busyTimeoutMs = 5000,
  tempDir = os.tmpdir(),
} = {}) {
  if (running) return { status: 'skipped:already-running' };
  running = rebuild(dbPath, { Database, freeBytesOf, busyTimeoutMs, tempDir })
    .catch((err) => ({ status: 'failed', error: err.message }))
    .then((result) => ({ ...result, finishedAt: new Date().toISOString() }));
  try {
    lastResult = await running;
    return lastResult;
  } finally {
    running = null;
  }
}
