/**
 * RetentionService — tiered ageing for execution payloads.
 *
 * Externalization (PayloadStore) makes each row cheap. Retention is what makes
 * total storage CONVERGE instead of growing forever. node_executions grows
 * monotonically with workflow activity, so on an active install it becomes the
 * largest table in the database within months. Without ageing, a tenant's
 * storage is unbounded.
 *
 * Row age is heavily skewed toward the tail: a window of days retains only a
 * low single-digit percentage of rows, while a six-month window retains the
 * clear majority. That skew is what makes a tiered policy worth having — the
 * recent rows anyone actually reads are a small fraction of the bytes.
 *
 * THREE TIERS
 *   0..fullDays      full fidelity (externalized + compressed)
 *   ..compactDays    payload replaced by a preview; timings, status, tokens,
 *                    credits and errors all retained
 *   beyond           row deleted; the workflow_executions summary survives
 *
 * WHY THE DEFAULTS ARE CONSERVATIVE
 * `InsightEngine` mines `SELECT * FROM node_executions` for insights, and the
 * `recall` / `get_trace` memory tools read this same history. Deleting it is a
 * PRODUCT regression, not just a storage change. So:
 *
 *   - `enabled` defaults to FALSE. Nothing ages until someone opts in.
 *   - `dryRun` defaults to TRUE. The first real call reports and changes
 *     nothing.
 *   - The compact tier keeps the 300-character preview, which is exactly what
 *     `_buildWorkflowTrace` consumes — so insight extraction keeps working on
 *     compacted rows with no code change at all.
 *
 * Deleted rows free pages into the SQLite freelist. On a database created
 * before `auto_vacuum = INCREMENTAL` the file will not shrink, but the space
 * IS reused: at the post-externalization write rate even a multi-GB freelist
 * takes years to refill.
 */

import db from '../../models/database/index.js';
import { dbRunWithRetry } from '../../models/database/index.js';
import PayloadStore from './PayloadStore.js';

const dbAll = (sql, params = []) =>
  new Promise((res, rej) => db.all(sql, params, (e, r) => (e ? rej(e) : res(r || []))));
const dbGet = (sql, params = []) =>
  new Promise((res, rej) => db.get(sql, params, (e, r) => (e ? rej(e) : res(r))));
const dbRun = (sql, params = []) =>
  new Promise((res, rej) => db.run(sql, params, function (e) { e ? rej(e) : res(this); }));

const COMPACT_KEY = '__agnt_compacted';

export const DEFAULTS = Object.freeze({
  enabled: false,
  dryRun: true,
  fullDays: 7,
  compactDays: 90,
  batchSize: 500,
  /** Inline rows below this stay untouched — compacting them would save nothing. */
  minBytesToCompact: 4096,
});

/**
 * A row is worth compacting if EITHER:
 *
 *   (a) it is externalized — the stored column is only a ~300 byte envelope,
 *       but it pins a blob on disk. Dropping the reference is what lets
 *       BlobGC reclaim the real bytes. Selecting on stored length alone would
 *       NEVER match these rows, which silently made retention a no-op for
 *       exactly the payloads it exists to age.
 *
 *   (b) it is a large legacy inline row — the pre-externalization case, where
 *       the bytes really are in the column and shrinking it wins directly.
 *
 * Expressed in SQL because the candidate scan must stay in the database; the
 * JS predicates (PayloadStore.isExternalized) can't be pushed down.
 */
const CANDIDATE_SQL = `(
     input  LIKE '{"${PayloadStore.ENVELOPE_KEY}"%' OR output LIKE '{"${PayloadStore.ENVELOPE_KEY}"%'
  OR input  LIKE '%agnt-blob:v1:%' OR output LIKE '%agnt-blob:v1:%'
  OR (length(COALESCE(input,'')) + length(COALESCE(output,''))) >= ?
)`;

/**
 * Replace a payload with a preview marker.
 *
 * Uses PayloadStore.preview(), which reads the envelope's stored preview
 * without touching the blob — so compaction never pays disk I/O for data it is
 * about to discard.
 */
function compactedMarker(stored) {
  return JSON.stringify({
    [COMPACT_KEY]: 1,
    p: PayloadStore.preview(stored),
    n: PayloadStore.originalSize(stored),
    at: new Date().toISOString(),
  });
}

const RetentionService = {
  DEFAULTS,
  COMPACT_KEY,

  /** True if this column value has already been aged. */
  isCompacted(stored) {
    return typeof stored === 'string' && stored.startsWith(`{"${COMPACT_KEY}"`);
  },

  /** What WOULD each tier affect? Read-only, safe to call any time. */
  async preview({ fullDays = DEFAULTS.fullDays, compactDays = DEFAULTS.compactDays } = {}) {
    const [total, toCompact, toDelete] = await Promise.all([
      dbGet(`SELECT COUNT(*) c, COALESCE(SUM(length(input) + length(output)), 0) b FROM node_executions`),
      dbGet(
        `SELECT COUNT(*) c, COALESCE(SUM(length(COALESCE(input,'')) + length(COALESCE(output,''))), 0) b
         FROM node_executions
         WHERE start_time < datetime('now', ?) AND start_time >= datetime('now', ?)
           AND ${CANDIDATE_SQL}
           AND COALESCE(input, '') NOT LIKE ? AND COALESCE(output, '') NOT LIKE ?`,
        [
          `-${fullDays} days`,
          `-${compactDays} days`,
          DEFAULTS.minBytesToCompact,
          `{"${COMPACT_KEY}"%`,
          `{"${COMPACT_KEY}"%`,
        ]
      ),
      dbGet(
        `SELECT COUNT(*) c, COALESCE(SUM(length(input) + length(output)), 0) b FROM node_executions
         WHERE start_time < datetime('now', ?)`,
        [`-${compactDays} days`]
      ),
    ]);

    return {
      fullDays,
      compactDays,
      totalRows: total.c,
      totalPayloadBytes: total.b,
      compactCandidates: toCompact.c,
      compactBytes: toCompact.b,
      deleteCandidates: toDelete.c,
      deleteBytes: toDelete.b,
      estimatedBytesFreed: toCompact.b + toDelete.b,
    };
  },

  /**
   * Apply the retention policy.
   *
   * Returns a report in every mode. With dryRun (the default) nothing is
   * written — the counts describe what a real run would do.
   */
  async apply(options = {}) {
    const cfg = { ...DEFAULTS, ...options };
    const startedAt = Date.now();

    const report = {
      ...(await this.preview(cfg)),
      enabled: cfg.enabled,
      dryRun: cfg.dryRun,
      compacted: 0,
      compactedBytes: 0,
      deleted: 0,
      skipped: null,
      durationMs: 0,
    };

    if (!cfg.enabled) {
      report.skipped = 'retention is disabled (set enabled:true to run)';
      report.durationMs = Date.now() - startedAt;
      return report;
    }

    // ---- Tier 2: compact ---------------------------------------------------
    for (;;) {
      const rows = await dbAll(
        `SELECT id, input, output,
                length(COALESCE(input,'')) + length(COALESCE(output,'')) AS sz
         FROM node_executions
         WHERE start_time < datetime('now', ?) AND start_time >= datetime('now', ?)
           AND ${CANDIDATE_SQL}
           AND COALESCE(input, '') NOT LIKE ? AND COALESCE(output, '') NOT LIKE ?
         LIMIT ?`,
        [
          `-${cfg.fullDays} days`,
          `-${cfg.compactDays} days`,
          cfg.minBytesToCompact,
          `{"${COMPACT_KEY}"%`,
          `{"${COMPACT_KEY}"%`,
          cfg.batchSize,
        ]
      );
      if (rows.length === 0) break;

      if (cfg.dryRun) {
        report.compacted += rows.length;
        report.compactedBytes += rows.reduce((s, r) => s + (r.sz || 0), 0);
        // Dry run must not loop forever over the same unchanged rows.
        break;
      }

      for (const r of rows) {
        await dbRunWithRetry(() =>
          dbRun('UPDATE node_executions SET input = ?, output = ? WHERE id = ?', [
            r.input == null ? null : compactedMarker(r.input),
            r.output == null ? null : compactedMarker(r.output),
            r.id,
          ])
        );
        report.compacted++;
        report.compactedBytes += r.sz || 0;
      }
    }

    // ---- Tier 3: delete ----------------------------------------------------
    // Batched so a large purge never holds one enormous transaction (which
    // would block the workflow process behind SQLITE_BUSY).
    for (;;) {
      const rows = await dbAll(
        `SELECT id FROM node_executions WHERE start_time < datetime('now', ?) LIMIT ?`,
        [`-${cfg.compactDays} days`, cfg.batchSize]
      );
      if (rows.length === 0) break;

      if (cfg.dryRun) {
        report.deleted = report.deleteCandidates;
        break;
      }

      const placeholders = rows.map(() => '?').join(',');
      await dbRunWithRetry(() =>
        dbRun(`DELETE FROM node_executions WHERE id IN (${placeholders})`, rows.map((r) => r.id))
      );
      report.deleted += rows.length;
    }

    report.durationMs = Date.now() - startedAt;

    if (!cfg.dryRun) {
      console.log(
        `[Retention] compacted ${report.compacted} row(s), deleted ${report.deleted} row(s). ` +
        `Column bytes released: ~${(report.compactedBytes / 1048576).toFixed(1)} MB. ` +
        `For externalized rows the real reclaim happens when BlobGC sweeps the ` +
        `now-unreferenced blobs — run BlobGC.run({ mode: 'delete' }) afterwards.`
      );
    }
    return report;
  },

  /**
   * Return freed pages to the OS. No-op unless the database was created with
   * auto_vacuum=INCREMENTAL (see database/index.js) — on older files the pages
   * stay in the freelist and are reused instead.
   */
  async reclaimPages(maxPages = 10000) {
    try {
      const mode = await dbGet('PRAGMA auto_vacuum');
      const value = mode ? Object.values(mode)[0] : 0;
      if (value !== 2) {
        return { reclaimed: false, reason: `auto_vacuum=${value} (INCREMENTAL required); freed pages stay in the freelist` };
      }
      const before = Object.values(await dbGet('PRAGMA page_count'))[0];
      await dbRun(`PRAGMA incremental_vacuum(${Number(maxPages) || 10000})`);
      const after = Object.values(await dbGet('PRAGMA page_count'))[0];
      const pageSize = Object.values(await dbGet('PRAGMA page_size'))[0];
      return { reclaimed: true, pagesFreed: before - after, bytesFreed: (before - after) * pageSize };
    } catch (err) {
      return { reclaimed: false, reason: err.message };
    }
  },
};

export default RetentionService;
