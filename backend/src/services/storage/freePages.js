/**
 * freePages — measure the database file and return free pages to the OS on
 * databases that support it (auto_vacuum = INCREMENTAL, which every database
 * created since database/index.js began setting it is born with).
 *
 * THE run() TRAP
 * --------------
 * `PRAGMA incremental_vacuum(N)` produces one result row per page it frees,
 * and node-sqlite3's `run()` steps a statement exactly once — so it frees ONE
 * page, whatever N is. `all()` steps to completion. Measured on the backend's
 * driver (SQLite 3.44.2): run() freed 1 of 1000 requested pages, all() 1000.
 * The earlier RetentionService.reclaimPages used run(); it never ran in
 * production, which is the only reason it never mattered.
 *
 * Works in steps of `stepPages`, each one statement (a short write lock held
 * through the connection gate), with a pause between, until only
 * `keepFreeBytes` of free pages remain — a small reserve so the very next
 * writes do not have to grow the file again.
 *
 * Accounting: `freelistPagesReleased` counts free pages handed back (what
 * `maxPages` and the reserve are measured in). `pagesFreed`/`bytesFreed` are
 * how much the FILE shrank — slightly more, because an auto-vacuum file also
 * drops pointer-map pages as it is truncated.
 */

const all = (db, sql) => new Promise((resolve, reject) => db.all(sql, [], (err, rows) => (err ? reject(err) : resolve(rows || []))));
const scalar = async (db, sql) => {
  const row = (await all(db, sql))[0];
  return row ? Object.values(row)[0] : undefined;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Size of the database file and how much of it is free pages. */
export async function databaseSpaceStats(db) {
  const pageSize = await scalar(db, 'PRAGMA page_size');
  const pageCount = await scalar(db, 'PRAGMA page_count');
  const freelistCount = await scalar(db, 'PRAGMA freelist_count');
  const autoVacuum = await scalar(db, 'PRAGMA auto_vacuum');
  return {
    pageSize,
    pageCount,
    freelistCount,
    autoVacuum,
    fileBytes: pageSize * pageCount,
    freeBytes: pageSize * freelistCount,
    liveBytes: pageSize * (pageCount - freelistCount),
  };
}

/**
 * @param {import('sqlite3').Database} db
 * @param {object} [options]
 * @param {number} [options.keepFreeBytes]  free space to leave in the file
 * @param {number} [options.stepPages]      pages freed per statement
 * @param {number} [options.maxPages]       stop after freeing this many
 * @param {number} [options.pauseMs]        pause between statements
 * @param {() => boolean} [options.shouldStop]
 * @returns {Promise<{status: string, freelistPagesReleased: number, pagesFreed: number, bytesFreed: number, before: object, after: object}>}
 */
export async function reclaimFreePages(db, {
  keepFreeBytes = 16 * 1024 * 1024,
  stepPages = 2048,
  maxPages = Number.POSITIVE_INFINITY,
  pauseMs = 25,
  shouldStop = () => false,
} = {}) {
  const before = await databaseSpaceStats(db);
  if (before.autoVacuum !== 2) {
    return { status: `skipped:auto_vacuum=${before.autoVacuum}`, freelistPagesReleased: 0, pagesFreed: 0, bytesFreed: 0, before, after: before };
  }
  const keepPages = Math.ceil(Math.max(0, keepFreeBytes) / before.pageSize);
  let freelist = before.freelistCount;
  let released = 0;
  let status = 'complete';
  while (freelist > keepPages && released < maxPages) {
    if (shouldStop()) { status = 'stopped'; break; }
    const step = Math.min(stepPages, freelist - keepPages, maxPages - released);
    await all(db, `PRAGMA incremental_vacuum(${Math.floor(step)})`);
    const now = await scalar(db, 'PRAGMA freelist_count');
    if (now >= freelist) break; // nothing moved: never spin
    released += freelist - now;
    freelist = now;
    if (pauseMs && freelist > keepPages) await sleep(pauseMs);
  }
  const after = await databaseSpaceStats(db);
  const pagesFreed = before.pageCount - after.pageCount;
  return { status, freelistPagesReleased: released, pagesFreed, bytesFreed: pagesFreed * before.pageSize, before, after };
}
