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
 */

import db from '../../models/database/index.js';
import PathManager from '../../utils/PathManager.js';
import { isDataDirOwner } from '../../models/database/dataDirOwnership.js';
import { compactSavedChatSearchIndex } from './savedChatSearchCompaction.js';

const START_DELAY_MS = 2 * 60 * 1000;
const STATE_FILE = 'storage-maintenance.json';

let started = false;
let stopRequested = false;

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
