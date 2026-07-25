/**
 * BlobGC — mark-and-sweep for the PayloadStore content-addressed blob store.
 *
 * THIS IS THE MOST DANGEROUS COMPONENT IN THE STORAGE STACK.
 *
 * It is the only piece that DELETES user data, and a naive implementation
 * silently loses payloads in ways nobody notices for weeks. Three specific
 * hazards, and what this module does about each:
 *
 *   1. RACE WITH A LIVE WRITE.
 *      PayloadStore.pack() writes the blob and fsync/renames it BEFORE the row
 *      that references it is committed. A GC that scans the table in that
 *      window sees an unreferenced blob and deletes data that is about to
 *      become live. Mitigation: `minAgeMs` (default 24h). A blob younger than
 *      the grace period is NEVER eligible, no matter what the mark phase says.
 *
 *   2. INCOMPLETE MARK SET.
 *      An envelope's *body* can itself contain blob markers (base64 hoisted out
 *      of a payload that was then compressed). Scanning only the stored column
 *      text would miss those and delete live audio. Mitigation: the mark phase
 *      unpacks every externalized row so nested references are reachable.
 *      If ANY row fails to unpack, the sweep is aborted outright — an
 *      incomplete mark set must never authorize deletion.
 *
 *   3. OPERATOR SURPRISE.
 *      Default mode is 'report'. It computes everything, deletes nothing, and
 *      returns the exact list it *would* have removed. Run it that way until
 *      the orphan count is stable and understood, then pass mode:'delete'.
 *
 * All three tables that PayloadStore writes are scanned. Adding a new packed
 * column means adding it to SCAN_TARGETS or the GC will delete its blobs.
 */

import fsp from 'fs/promises';
import path from 'path';
import db from '../../models/database/index.js';
import PayloadStore, { blobRoot, blobPathFor } from './PayloadStore.js';

const dbAll = (sql, params = []) =>
  new Promise((res, rej) => db.all(sql, params, (e, r) => (e ? rej(e) : res(r || []))));

/**
 * Every column that can hold a packed payload.
 *
 * INVARIANT: if you wire PayloadStore.pack() into a new column, add it here in
 * the same commit. A missing entry means the mark phase cannot see those
 * references and the sweep will delete live blobs.
 */
const SCAN_TARGETS = [
  { table: 'node_executions', columns: ['input', 'output'] },
  { table: 'content_outputs', columns: ['content'] },
  { table: 'agent_tool_executions', columns: ['input', 'output'] },
];

const DEFAULT_MIN_AGE_MS = 24 * 60 * 60 * 1000;

/** Does this table/column exist? Schemas drift; never assume. */
async function columnExists(table, column) {
  try {
    const cols = await dbAll(`PRAGMA table_info("${table}")`);
    return cols.some((c) => c.name === column);
  } catch {
    return false;
  }
}

/**
 * MARK: every hash reachable from the database.
 *
 * Streams in batches so a 1.3M-row table does not materialize at once, and
 * unpacks externalized rows so nested markers are discovered.
 */
async function markReachable({ batchSize = 2000, onProgress } = {}) {
  const reachable = new Set();
  let rowsScanned = 0;
  let unpackFailures = 0;

  for (const target of SCAN_TARGETS) {
    for (const column of target.columns) {
      if (!(await columnExists(target.table, column))) continue;

      let offset = 0;
      for (;;) {
        // Only rows large enough to possibly be an envelope or carry a marker.
        // Envelopes are ~200-400 B; markers are 78 B. 64 is a safe floor and
        // skips the overwhelming majority of small inline rows.
        const rows = await dbAll(
          `SELECT rowid AS rid, "${column}" AS v FROM "${target.table}"
           WHERE "${column}" IS NOT NULL AND length("${column}") >= 64
           ORDER BY rowid LIMIT ? OFFSET ?`,
          [batchSize, offset]
        );
        if (rows.length === 0) break;

        for (const r of rows) {
          rowsScanned++;
          const direct = PayloadStore.referencedHashes(r.v);
          for (const h of direct) reachable.add(h);

          // An envelope may hide further markers inside its compressed body.
          // Unpack to reach them. A failure here poisons the whole run.
          if (direct.size > 0 && PayloadStore.isExternalized(r.v)) {
            try {
              const value = await PayloadStore.unpack(r.v);
              if (value && value.__agnt_missing) {
                // Already-broken reference. Not a mark failure, but keep the
                // hash marked so we never "clean up" a blob that might return
                // from a backup.
                continue;
              }
              const serialized = typeof value === 'string' ? value : JSON.stringify(value);
              if (serialized) {
                for (const h of PayloadStore.referencedHashes(serialized)) reachable.add(h);
              }
            } catch {
              unpackFailures++;
            }
          }
        }

        offset += rows.length;
        if (onProgress) onProgress({ table: target.table, column, rowsScanned, reachable: reachable.size });
        if (rows.length < batchSize) break;
      }
    }
  }

  return { reachable, rowsScanned, unpackFailures };
}

/** Every blob currently on disk, with mtime for the grace-period check. */
async function listBlobs() {
  const root = blobRoot();
  const out = [];
  const walk = async (dir) => {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(p);
      } else if (!e.name.endsWith('.tmp')) {
        try {
          const st = await fsp.stat(p);
          out.push({ hash: e.name, path: p, size: st.size, mtimeMs: st.mtimeMs });
        } catch { /* raced with another writer */ }
      }
    }
  };
  await walk(root);
  return out;
}

const BlobGC = {
  SCAN_TARGETS,

  /**
   * @param {'report'|'delete'} mode  'report' (default) computes and returns
   *        the orphan list WITHOUT touching disk. Always run this first.
   * @param {number} minAgeMs  Grace period. Blobs newer than this are never
   *        deleted — this is what makes the GC safe against in-flight writes.
   */
  async run({ mode = 'report', minAgeMs = DEFAULT_MIN_AGE_MS, batchSize = 2000, onProgress } = {}) {
    const startedAt = Date.now();

    const { reachable, rowsScanned, unpackFailures } = await markReachable({ batchSize, onProgress });
    const blobs = await listBlobs();

    const now = Date.now();
    const orphans = [];
    const tooYoung = [];
    let liveBytes = 0;
    let orphanBytes = 0;

    for (const b of blobs) {
      if (reachable.has(b.hash)) {
        liveBytes += b.size;
        continue;
      }
      if (now - b.mtimeMs < minAgeMs) {
        tooYoung.push(b);
        liveBytes += b.size;
        continue;
      }
      orphans.push(b);
      orphanBytes += b.size;
    }

    const report = {
      mode,
      startedAt: new Date(startedAt).toISOString(),
      durationMs: Date.now() - startedAt,
      rowsScanned,
      unpackFailures,
      blobsOnDisk: blobs.length,
      reachableHashes: reachable.size,
      liveBytes,
      orphanCount: orphans.length,
      orphanBytes,
      protectedByGracePeriod: tooYoung.length,
      minAgeMs,
      deleted: 0,
      deletedBytes: 0,
      aborted: false,
      abortReason: null,
      orphanSample: orphans.slice(0, 20).map((o) => ({ hash: o.hash, size: o.size })),
    };

    if (mode !== 'delete') return report;

    // ---- HARD SAFETY GATES ------------------------------------------------
    // Any doubt about the completeness of the mark set forbids deletion.
    if (unpackFailures > 0) {
      report.aborted = true;
      report.abortReason =
        `${unpackFailures} row(s) failed to unpack — the mark set may be incomplete, so no blob was deleted.`;
      console.error(`[BlobGC] ABORTED: ${report.abortReason}`);
      return report;
    }
    if (blobs.length > 0 && reachable.size === 0) {
      // Almost certainly a wiring bug (wrong DB, empty table, bad scan) rather
      // than a genuinely empty database. Refuse to delete the entire store.
      report.aborted = true;
      report.abortReason =
        'mark phase found zero reachable hashes while blobs exist on disk — refusing to delete the whole store.';
      console.error(`[BlobGC] ABORTED: ${report.abortReason}`);
      return report;
    }

    for (const o of orphans) {
      try {
        await fsp.unlink(o.path);
        report.deleted++;
        report.deletedBytes += o.size;
      } catch (err) {
        if (err.code !== 'ENOENT') console.error(`[BlobGC] failed to delete ${o.hash}:`, err.message);
      }
    }

    console.log(
      `[BlobGC] deleted ${report.deleted} orphan blob(s), ` +
      `${(report.deletedBytes / 1048576).toFixed(1)} MB reclaimed ` +
      `(${report.protectedByGracePeriod} protected by grace period)`
    );
    return report;
  },

  /** Remove .tmp files left by a crashed write. Always safe. */
  async cleanTemp({ minAgeMs = 60 * 60 * 1000 } = {}) {
    const root = blobRoot();
    const now = Date.now();
    let removed = 0;
    const walk = async (dir) => {
      let entries;
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) await walk(p);
        else if (e.name.endsWith('.tmp')) {
          try {
            const st = await fsp.stat(p);
            if (now - st.mtimeMs >= minAgeMs) {
              await fsp.unlink(p);
              removed++;
            }
          } catch { /* already gone */ }
        }
      }
    };
    await walk(root);
    return { removed };
  },

  /** Verify every referenced blob is actually present. Read-only. */
  async verify({ batchSize = 2000 } = {}) {
    const { reachable, rowsScanned, unpackFailures } = await markReachable({ batchSize });
    const missing = [];
    for (const h of reachable) {
      try {
        await fsp.stat(blobPathFor(h));
      } catch {
        missing.push(h);
      }
    }
    return {
      rowsScanned,
      unpackFailures,
      referenced: reachable.size,
      missing: missing.length,
      missingSample: missing.slice(0, 20),
      healthy: missing.length === 0 && unpackFailures === 0,
    };
  },
};

export default BlobGC;
