/**
 * PayloadBackfill — migrate existing inline payloads into the blob store.
 *
 * Wiring PayloadStore into the write path stops the bleeding, but it does
 * nothing about history already on disk. On a long-lived install that history
 * is dominated by two tables:
 *
 *   node_executions   the bulk of the database, nearly all OVERFLOW pages
 *   content_outputs   far fewer rows, but a very large average and worst case
 *
 * This walks those rows and rewrites each payload through PayloadStore.
 *
 * SAFETY MODEL
 * ------------
 * Every row is verified BEFORE it is rewritten: pack() then unpack(), and the
 * result must serialize byte-identically to the original. If it does not, the
 * row is left exactly as it was and counted as `skippedMismatch`. There is no
 * mode in which this writes a payload it could not first prove it can read
 * back.
 *
 * Ordered by rowid and driven by a `--after` cursor, so an interrupted run
 * resumes from where it stopped without redoing work. Rows already carrying an
 * envelope are detected and skipped, making the whole operation idempotent.
 *
 * NOTE ON DISK SPACE
 * ------------------
 * This does NOT shrink the database file. Freed pages go to the SQLite
 * freelist and are reused by future writes. On any install whose database has
 * already outgrown the free space on its volume VACUUM is not an option at
 * all, but that is fine: after backfill the write rate drops far enough that a
 * multi-GB freelist takes years to refill. Databases created after the
 * auto_vacuum=INCREMENTAL change can additionally call
 * RetentionService.reclaimPages().
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

export const TARGETS = Object.freeze({
  node_executions: { columns: ['input', 'output'], pk: 'id' },
  content_outputs: { columns: ['content'], pk: 'id' },
  agent_tool_executions: { columns: ['input', 'output'], pk: 'id' },
});

async function tableExists(table) {
  const r = await dbGet(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`, [table]);
  return !!r;
}

async function columnExists(table, column) {
  const cols = await dbAll(`PRAGMA table_info("${table}")`);
  return cols.some((c) => c.name === column);
}

/**
 * Rewrite one column value. Returns the new string, or null to leave it alone.
 * Throws only on a verification failure, which the caller records and skips.
 */
async function repackVerified(stored) {
  if (stored == null) return null;
  if (typeof stored !== 'string') return null;
  if (PayloadStore.isExternalized(stored)) return null;      // already migrated
  if (Buffer.byteLength(stored, 'utf8') <= PayloadStore.INLINE_THRESHOLD) return null;

  let value;
  try {
    value = JSON.parse(stored);
  } catch {
    value = stored;   // legacy non-JSON column content
  }

  const packed = await PayloadStore.pack(value);
  if (packed == null) return null;
  if (Buffer.byteLength(packed, 'utf8') >= Buffer.byteLength(stored, 'utf8')) return null; // no win

  // Prove readability before we overwrite the only copy.
  const restored = await PayloadStore.unpack(packed);
  if (restored && restored.__agnt_missing) throw new Error('verify: blob unreadable immediately after write');
  if (JSON.stringify(restored) !== JSON.stringify(value)) throw new Error('verify: round-trip mismatch');

  return packed;
}

const PayloadBackfill = {
  TARGETS,

  /** How much is there to do, and how much would it save? Read-only. */
  async estimate(table = 'node_executions') {
    const spec = TARGETS[table];
    if (!spec) throw new Error(`unknown table: ${table}`);
    if (!(await tableExists(table))) return { table, exists: false };

    const parts = [];
    for (const c of spec.columns) {
      if (await columnExists(table, c)) parts.push(c);
    }
    if (parts.length === 0) return { table, exists: true, columns: [] };

    const lenExpr = parts.map((c) => `length(COALESCE("${c}",''))`).join(' + ');
    const bigCond = parts
      .map((c) => `(length(COALESCE("${c}",'')) > ${PayloadStore.INLINE_THRESHOLD}
                    AND "${c}" NOT LIKE '{"${PayloadStore.ENVELOPE_KEY}"%')`)
      .join(' OR ');

    const row = await dbGet(
      `SELECT COUNT(*) AS candidates, COALESCE(SUM(${lenExpr}), 0) AS bytes
       FROM "${table}" WHERE ${bigCond}`
    );
    const total = await dbGet(`SELECT COUNT(*) AS c, COALESCE(SUM(${lenExpr}),0) AS b FROM "${table}"`);

    return {
      table,
      exists: true,
      columns: parts,
      totalRows: total.c,
      totalBytes: total.b,
      candidates: row.candidates,
      candidateBytes: row.bytes,
    };
  },

  /**
   * @param {string}  table
   * @param {boolean} dryRun   default TRUE — computes and verifies, writes nothing
   * @param {number}  limit    max rows to process this invocation (0 = all)
   * @param {string}  after    resume cursor (last processed pk); '' starts at the beginning
   */
  async run({
    table = 'node_executions',
    dryRun = true,
    limit = 0,
    batchSize = 200,
    after = '',
    onProgress,
  } = {}) {
    const spec = TARGETS[table];
    if (!spec) throw new Error(`unknown table: ${table}`);
    if (!(await tableExists(table))) return { table, error: 'table does not exist' };

    const columns = [];
    for (const c of spec.columns) {
      if (await columnExists(table, c)) columns.push(c);
    }
    if (columns.length === 0) return { table, error: 'no packable columns' };

    const pk = spec.pk;
    const startedAt = Date.now();
    const report = {
      table,
      columns,
      dryRun,
      rowsScanned: 0,
      rowsRewritten: 0,
      columnsRewritten: 0,
      bytesBefore: 0,
      bytesAfter: 0,
      skippedAlready: 0,
      skippedSmall: 0,
      skippedMismatch: 0,
      mismatchSample: [],
      lastCursor: after,
      done: false,
      durationMs: 0,
    };

    const bigCond = columns
      .map((c) => `(length(COALESCE("${c}",'')) > ${PayloadStore.INLINE_THRESHOLD}
                    AND "${c}" NOT LIKE '{"${PayloadStore.ENVELOPE_KEY}"%')`)
      .join(' OR ');
    const selectCols = columns.map((c) => `"${c}"`).join(', ');

    for (;;) {
      if (limit > 0 && report.rowsScanned >= limit) break;

      const take = limit > 0 ? Math.min(batchSize, limit - report.rowsScanned) : batchSize;
      const rows = await dbAll(
        `SELECT "${pk}" AS __pk, ${selectCols} FROM "${table}"
         WHERE "${pk}" > ? AND (${bigCond})
         ORDER BY "${pk}" LIMIT ?`,
        [report.lastCursor, take]
      );
      if (rows.length === 0) {
        report.done = true;
        break;
      }

      for (const row of rows) {
        report.rowsScanned++;
        report.lastCursor = row.__pk;

        const updates = {};
        for (const c of columns) {
          const stored = row[c];
          if (stored == null) continue;

          const beforeLen = Buffer.byteLength(String(stored), 'utf8');
          if (PayloadStore.isExternalized(stored)) { report.skippedAlready++; continue; }
          if (beforeLen <= PayloadStore.INLINE_THRESHOLD) { report.skippedSmall++; continue; }

          let packed;
          try {
            packed = await repackVerified(stored);
          } catch (err) {
            report.skippedMismatch++;
            if (report.mismatchSample.length < 10) {
              report.mismatchSample.push({ pk: row.__pk, column: c, reason: err.message });
            }
            continue;
          }
          if (packed == null) { report.skippedSmall++; continue; }

          updates[c] = packed;
          report.bytesBefore += beforeLen;
          report.bytesAfter += Buffer.byteLength(packed, 'utf8');
          report.columnsRewritten++;
        }

        const cols = Object.keys(updates);
        if (cols.length === 0) continue;

        if (!dryRun) {
          const setSql = cols.map((c) => `"${c}" = ?`).join(', ');
          await dbRunWithRetry(() =>
            dbRun(`UPDATE "${table}" SET ${setSql} WHERE "${pk}" = ?`, [...cols.map((c) => updates[c]), row.__pk])
          );
        }
        report.rowsRewritten++;
      }

      if (onProgress) {
        onProgress({
          table,
          rowsScanned: report.rowsScanned,
          rowsRewritten: report.rowsRewritten,
          savedMB: (report.bytesBefore - report.bytesAfter) / 1048576,
          cursor: report.lastCursor,
        });
      }

      // In dryRun we would otherwise loop forever: nothing is written, so the
      // same rows keep matching the candidate predicate on the next page. The
      // cursor advances, so this terminates naturally — but bound it anyway.
      if (rows.length < take) { report.done = true; break; }
    }

    report.durationMs = Date.now() - startedAt;
    report.savedBytes = report.bytesBefore - report.bytesAfter;
    report.compressionRatio = report.bytesAfter > 0 ? report.bytesBefore / report.bytesAfter : 0;
    return report;
  },
};

export default PayloadBackfill;
