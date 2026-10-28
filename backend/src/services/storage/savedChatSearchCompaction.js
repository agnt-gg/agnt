/**
 * savedChatSearchCompaction — removes the second copy of saved-chat transcripts
 * from content_outputs_fts on databases created before fts.js stopped
 * indexing them.
 *
 * WHY
 * ---
 * content_outputs_fts used to index every saved chat's full body. That body is
 * the UI copy of conversation_logs.full_history, which conversation_logs_fts
 * already indexes, so every transcript was stored and tokenized twice (1.58 GB
 * of copies plus their index on a real install). New and updated rows are now
 * indexed by the trigger rule in fts.js; this job brings the rows written
 * before that rule up to date, without rewriting a single source row.
 *
 * HOW
 * ---
 * Walks content_outputs_fts_content by rowid, in small batches, each in its
 * own short transaction through withTransaction (connectionGate.js), which
 * holds the shared connection for exactly that batch: no unrelated app write
 * can join it, and the app's writes wait at most one batch. A row is
 * re-indexed only when ALL of these hold:
 *   - it is a saved chat (c5 = 'conversation') with a conversation id (c4),
 *   - a history row exists for that conversation (so its text stays
 *     searchable through conversation_logs_fts),
 *   - its stored body is not already empty — checked with octet_length(),
 *     which SQLite answers from the record header without reading the body
 *     (measured: 0.4 MB read for 200 MB of bodies, vs 200 MB for length()).
 * Re-indexing is exactly what the update trigger does: delete the search row
 * (and any legacy duplicate) and insert it again from the source row with the
 * same column mapping the backfill uses, so the result is identical to what a
 * save would produce.
 *
 * RESUMABLE AND SAFE TO RE-RUN
 * ----------------------------
 * Progress is a rowid high-water mark in a small JSON file, not a table: an
 * unknown table would make OwnershipMigration refuse to run. Losing or
 * resetting the file only costs a re-check (rows already clean are skipped
 * cheaply); it can never change what search returns. Rows re-indexed by an
 * older build after this ran get new, higher rowids, so the next run picks
 * them up.
 */

import fs from 'fs';
import { FTS_TABLES, buildBackfillSql } from '../../models/database/fts.js';
import { withTransaction } from '../../models/database/connectionGate.js';

const SPEC = FTS_TABLES.find((spec) => spec.name === 'content_outputs_fts');
const STATE_KEY = 'contentOutputsFtsCheckedThroughRowid';

const run = (db, sql, params = []) =>
  new Promise((resolve, reject) => db.run(sql, params, function (err) { if (err) reject(err); else resolve(this); }));
const all = (db, sql, params = []) =>
  new Promise((resolve, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || []))));
const get = async (db, sql, params = []) => (await all(db, sql, params))[0];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function readMaintenanceState(statePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Atomic replace. On Windows a rename over a file another process has open
 * fails with EPERM/EBUSY, so it retries briefly; a state file that cannot be
 * written is reported, never thrown — it only means the next run re-checks.
 */
export function writeMaintenanceState(statePath, patch) {
  const next = { ...readMaintenanceState(statePath), ...patch };
  const tmp = `${statePath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(next, null, 1));
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        fs.renameSync(tmp, statePath);
        return true;
      } catch (err) {
        if (!['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) throw err;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
      }
    }
  } catch (err) {
    console.warn('[SavedChatSearch] could not record progress:', err.message);
  }
  try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ }
  return false;
}

/** The search table has exactly the layout this job reads by position. */
async function layoutIsExpected(db) {
  const ftsColumns = (await all(db, `PRAGMA table_info(${SPEC.name})`)).map((c) => c.name);
  const shadowColumns = (await all(db, `PRAGMA table_info(${SPEC.name}_content)`)).map((c) => c.name);
  const expected = ['doc_id', ...SPEC.unindexed, ...SPEC.indexed];
  return (
    expected.every((name, i) => ftsColumns[i] === name) &&
    shadowColumns[0] === 'id' &&
    expected.every((_, i) => shadowColumns[i + 1] === `c${i}`)
  );
}

/**
 * @param {import('sqlite3').Database} db
 * @param {object} options
 * @param {string} options.statePath    JSON file holding the progress mark
 * @param {number} [options.batchSize]  rows re-indexed per transaction
 * @param {number} [options.scanSize]   search rows examined per read
 * @param {number} [options.pauseMs]    pause between transactions
 * @param {() => boolean} [options.shouldStop]  checked between batches
 * @returns {Promise<{status: string, examined: number, reindexed: number, checkedThrough: number}>}
 */
export async function compactSavedChatSearchIndex(db, { statePath, batchSize = 10, scanSize = 500, pauseMs = 25, shouldStop = () => false } = {}) {
  if (!statePath) throw new Error('compactSavedChatSearchIndex requires statePath');
  const result = { status: 'complete', examined: 0, reindexed: 0, checkedThrough: 0 };
  if (!SPEC?.indexedValue?.content) return { ...result, status: 'skipped:no-rule' };
  if (!(await layoutIsExpected(db))) return { ...result, status: 'skipped:unexpected-layout' };

  const contentCol = `c${1 + SPEC.unindexed.length + SPEC.indexed.indexOf('content')}`;
  const conversationCol = `c${1 + SPEC.unindexed.indexOf('conversation_id')}`;
  const typeCol = `c${1 + SPEC.unindexed.indexOf('content_type')}`;
  const deleteSql = `DELETE FROM ${SPEC.name} WHERE rowid IN (SELECT id FROM ${SPEC.name}_content WHERE c0 = ?)`;
  const reinsertSql = `${buildBackfillSql(SPEC)} WHERE ${SPEC.pkCol} = ?`;

  const top = (await get(db, `SELECT max(id) AS maxId FROM ${SPEC.name}_content`))?.maxId || 0;
  let cursor = Number(readMaintenanceState(statePath)[STATE_KEY]) || 0;
  // A mark beyond the table's end means the database was replaced (restore,
  // import): start over rather than skip rows that now sit below the mark.
  if (cursor > top) cursor = 0;
  result.checkedThrough = cursor;

  while (cursor < top) {
    if (shouldStop()) return { ...result, status: 'stopped' };
    const rows = await all(
      db,
      `SELECT id, c0 AS docId FROM ${SPEC.name}_content
        WHERE id > ? AND id <= ? AND ${typeCol} = 'conversation' AND ${conversationCol} IS NOT NULL
          AND COALESCE(octet_length(${contentCol}), 0) > 0
          AND EXISTS (SELECT 1 FROM conversation_logs WHERE conversation_logs.conversation_id = ${SPEC.name}_content.${conversationCol})
        ORDER BY id LIMIT ?`,
      [cursor, top, scanSize],
    );
    // Rows that need nothing are skipped by the query; when none remain, the
    // whole range up to `top` has been checked.
    const scanEnd = rows.length < scanSize ? top : rows[rows.length - 1].id;
    result.examined += rows.length;

    for (let i = 0; i < rows.length; i += batchSize) {
      if (shouldStop()) return { ...result, status: 'stopped' };
      const batch = rows.slice(i, i + batchSize);
      await withTransaction(db, async () => {
        for (const row of batch) {
          await run(db, deleteSql, [row.docId]);
          await run(db, reinsertSql, [row.docId]);
        }
      }, { label: 'saved-chat search compaction' });
      result.reindexed += batch.length;
      cursor = batch[batch.length - 1].id;
      result.checkedThrough = cursor;
      writeMaintenanceState(statePath, { [STATE_KEY]: cursor });
      if (pauseMs) await sleep(pauseMs);
    }
    cursor = scanEnd;
    result.checkedThrough = cursor;
    writeMaintenanceState(statePath, { [STATE_KEY]: cursor });
  }
  return result;
}
