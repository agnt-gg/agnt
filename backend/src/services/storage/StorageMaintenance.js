/**
 * StorageMaintenance — background upkeep that keeps the database lean without
 * anyone having to ask for it.
 *
 * Runs once per process start, a couple of minutes after boot so it never
 * competes with startup, and only in the process that owns the data directory
 * (a second instance pointed at the same directory leaves it alone). Every
 * step is incremental, resumable and safe to interrupt: each unit of work is
 * one short transaction, so a process that exits mid-run just rolls back that
 * one unit and the next start carries on.
 *
 * Steps:
 *   1. savedChatSearchCompaction — drop the second copy of saved-chat
 *      transcripts from content_outputs_fts (see that file).
 *   2. reclaimFreePages — return free pages to the OS on databases created
 *      with auto_vacuum = INCREMENTAL (a no-op on older files, whose free
 *      pages are reused instead). See freePages.js.
 */

import db from '../../models/database/index.js';
import PathManager from '../../utils/PathManager.js';
import { isDataDirOwner } from '../../models/database/dataDirOwnership.js';
import { compactSavedChatSearchIndex } from './savedChatSearchCompaction.js';
import { reclaimFreePages, databaseSpaceStats } from './freePages.js';

const START_DELAY_MS = 2 * 60 * 1000;
const STATE_FILE = 'storage-maintenance.json';

let started = false;
let stopRequested = false;
let lastReport = null;

/** The most recent completed pass in this process, or null before the first. */
export function getLastStorageMaintenanceReport() {
  return lastReport;
}

const gb = (bytes) => (bytes / 1e9).toFixed(2);

export function stopStorageMaintenance() {
  stopRequested = true;
}

/**
 * One maintenance pass. Never throws for a failed step: each step's failure is
 * logged and reported, and the steps after it still run.
 */
export async function runStorageMaintenance({ shouldStop = () => stopRequested } = {}) {
  if (!(await isDataDirOwner())) return { status: 'skipped:not-owner' };
  const statePath = PathManager.getDataPath(STATE_FILE);
  const report = { status: 'complete' };

  const startedAt = Date.now();
  try {
    report.savedChatSearch = await compactSavedChatSearchIndex(db, { statePath, shouldStop });
    const { status, reindexed } = report.savedChatSearch;
    if (reindexed > 0 || status !== 'complete') {
      console.log(`[StorageMaintenance] saved-chat search index: ${status}, ${reindexed} row(s) re-indexed in ${Math.round((Date.now() - startedAt) / 1000)}s`);
    }
  } catch (err) {
    report.status = 'partial';
    report.savedChatSearch = { status: 'failed', error: err.message };
    console.warn('[StorageMaintenance] saved-chat search compaction failed (will retry next start):', err.message);
  }

  // After the compaction, so the pages it freed are returned in the same pass.
  try {
    const reclaimed = await reclaimFreePages(db, { shouldStop });
    report.freePages = { status: reclaimed.status, pagesFreed: reclaimed.pagesFreed, bytesFreed: reclaimed.bytesFreed };
    if (reclaimed.pagesFreed > 0) {
      console.log(`[StorageMaintenance] returned ${Math.round(reclaimed.bytesFreed / 1048576)} MB of free space to the OS`);
    }
  } catch (err) {
    report.status = 'partial';
    report.freePages = { status: 'failed', error: err.message };
    console.warn('[StorageMaintenance] free-page reclaim failed (will retry next start):', err.message);
  }

  // One line per pass in the diagnostics log: size, free space, mode. This is
  // how growth becomes visible before it becomes a problem.
  try {
    report.database = await databaseSpaceStats(db);
    const { fileBytes, freeBytes, autoVacuum } = report.database;
    console.log(`[StorageMaintenance] database ${gb(fileBytes)} GB, ${gb(freeBytes)} GB free (auto_vacuum=${autoVacuum})`);
  } catch (err) {
    console.warn('[StorageMaintenance] could not read database size:', err.message);
  }
  report.finishedAt = new Date().toISOString();
  lastReport = report;
  return report;
}

/** Schedule the pass for this process. Idempotent. */
export function startStorageMaintenance({ delayMs = START_DELAY_MS } = {}) {
  if (started) return false;
  started = true;
  const timer = setTimeout(() => {
    runStorageMaintenance().catch((err) => console.warn('[StorageMaintenance] pass failed (will retry next start):', err.message));
  }, delayMs);
  if (typeof timer.unref === 'function') timer.unref();
  return true;
}
