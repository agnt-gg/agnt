/**
 * Data-directory ownership: exactly one process per agnt.db may run the boot
 * work that assumes "every other process is dead".
 *
 * WHY. Boot runs sweeps that rewrite rows belonging to the previous process:
 * agent_executions 'running' → 'interrupted', open workflow runs → 'stopped',
 * schedule runs → 'interrupted', plus journal recovery and the WAL checkpoint.
 * Those are correct only if no other process is using the same database. But
 * the sweeps lived on module evaluation of models/database/index.js, so ANY
 * process that imported a backend model — an ad-hoc script, a chat-run tool, a
 * second worktree on the real data dir — re-ran them against the live app and
 * stamped its in-flight runs 'interrupted'. The only guard was the opt-in
 * AGNT_SKIP_DB_INIT=1, which only the workflow child ever set. Fail-open.
 *
 * HOW. A sidecar SQLite file in the data dir, opened with
 * locking_mode=EXCLUSIVE and written once. SQLite then holds an OS file lock
 * (LockFileEx / fcntl) for the life of the connection. The kernel releases it
 * when the process dies — however it dies — so there is no stale-lockfile
 * cleanup and no PID-reuse ambiguity. A second process gets SQLITE_BUSY
 * immediately and becomes a non-owner. Schema init is NOT gated by this: it is
 * idempotent and must stay synchronously queued (see database/index.js).
 * Fail-closed: if ownership cannot be
 * established for any reason, the process is treated as a non-owner, and the
 * worst outcome is that stale rows stay 'running' until the next owner boots.
 */
import path from 'path';
import sqlite3 from 'sqlite3';

export const OWNER_LOCK_FILENAME = 'agnt.owner.lock';

/**
 * How long a booting process keeps retrying a held lock. Covers an app restart,
 * where the previous backend can still be closing its handles when the new one
 * boots; without the wait the NEW backend would lose ownership to its own dying
 * predecessor and skip migrations. A genuinely concurrent importer simply
 * resolves as a non-owner after this delay.
 */
export const DEFAULT_OWNER_WAIT_MS = 5_000;
const RETRY_INTERVAL_MS = 250;

/** Held for the life of the process. Module scope keeps it from being collected. */
let heldLockHandle = null;
let ownershipResult = null;

function run(handle, sql, params = []) {
  return new Promise((resolve, reject) => {
    handle.run(sql, params, (err) => (err ? reject(err) : resolve()));
  });
}

function close(handle) {
  return new Promise((resolve) => handle.close(() => resolve()));
}

/**
 * Try to take exclusive ownership of `dbDir`. Never throws.
 * Resolves { owner: true } or { owner: false, reason }.
 * Idempotent per process: later calls return the first result.
 */
export function acquireDataDirOwnership(dbDir, { Database = sqlite3.Database, waitMs = 0 } = {}) {
  if (!ownershipResult) ownershipResult = acquireWithin(dbDir, Database, waitMs);
  return ownershipResult;
}

async function acquireWithin(dbDir, Database, waitMs) {
  const deadline = Date.now() + Math.max(0, waitMs);
  for (;;) {
    const result = await tryAcquire(dbDir, Database);
    // Only contention is worth waiting out; any other failure will not heal.
    if (result.owner || result.reason !== 'held_by_another_process' || Date.now() >= deadline) return result;
    await new Promise((resolve) => setTimeout(resolve, RETRY_INTERVAL_MS));
  }
}

/** Resolves true once ownership is settled and this process holds it. */
export async function isDataDirOwner() {
  if (!ownershipResult) return false;
  return (await ownershipResult).owner === true;
}

async function tryAcquire(dbDir, Database) {
  const lockPath = path.join(dbDir, OWNER_LOCK_FILENAME);
  let handle;
  try {
    handle = await new Promise((resolve, reject) => {
      const opened = new Database(lockPath, (err) => (err ? reject(err) : resolve(opened)));
    });
    await run(handle, 'PRAGMA busy_timeout = 0');
    await run(handle, 'PRAGMA locking_mode = EXCLUSIVE');
    // The file's contents are diagnostics only; the LOCK is the product. So no
    // on-disk journal and no fsync: each journal file a write creates is an
    // fsync plus an antivirus scan, and measured on Windows that cost 2-5 s of
    // boot for three statements. One transaction, zero journal files.
    await run(handle, 'PRAGMA journal_mode = MEMORY');
    await run(handle, 'PRAGMA synchronous = OFF');
    // In EXCLUSIVE mode the first write takes an exclusive lock that is never
    // released until the connection closes. No other process can even read the
    // row while it is held.
    await run(handle, 'BEGIN EXCLUSIVE');
    await run(handle, 'CREATE TABLE IF NOT EXISTS owner (pid INTEGER NOT NULL, acquired_at TEXT NOT NULL)');
    await run(handle, 'DELETE FROM owner');
    await run(handle, 'INSERT INTO owner (pid, acquired_at) VALUES (?, ?)', [process.pid, new Date().toISOString()]);
    await run(handle, 'COMMIT');
    heldLockHandle = handle;
    return { owner: true };
  } catch (error) {
    if (handle) await close(handle);
    const reason = error?.code === 'SQLITE_BUSY' ? 'held_by_another_process' : (error?.code || error?.message || 'unknown');
    return { owner: false, reason };
  }
}

/** Test seam: release the lock and forget the cached result. */
export async function releaseDataDirOwnershipForTests() {
  const handle = heldLockHandle;
  heldLockHandle = null;
  ownershipResult = null;
  if (handle) await close(handle);
}
