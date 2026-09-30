/**
 * Full-text search setup for the "remember anything" memory layer.
 *
 * Creates SQLite FTS5 virtual tables shadowing the durable history tables
 * (conversation_logs, agent_executions, content_outputs, insights,
 * agent_memory, workflow_versions), wires triggers to keep them in sync,
 * and backfills any FTS table that is empty against existing source rows.
 *
 * Pattern notes:
 * - For source tables with INTEGER PK (conversation_logs, workflow_versions),
 *   the FTS5 rowid is bound to the source id via `rowid = new.id`. Delete by
 *   rowid is O(1).
 * - For source tables with TEXT PK (UUIDs), the FTS rowid is auto-assigned
 *   and the TEXT id is stored as an UNINDEXED column `doc_id`. FTS5 cannot
 *   index a column itself, so `WHERE doc_id = ?` scans the whole table.
 *   The update/delete triggers instead find the row through an ordinary
 *   index on the shadow column that stores doc_id — see ensureDocIdIndex.
 */

const dbAll = (db, sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });

const dbExec = (db, sql) =>
  new Promise((resolve, reject) => {
    db.exec(sql, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });

const dbRun = (db, sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });

const dbGet = (db, sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });

const FTS_TABLES = [
  {
    name: 'conversation_logs_fts',
    source: 'conversation_logs',
    pkType: 'integer',
    pkCol: 'id',
    // Order matters: must match the trigger INSERT column list.
    indexed: ['initial_prompt', 'full_history', 'final_response'],
    unindexed: ['conversation_id', 'user_id', 'created_at', 'updated_at'],
  },
  {
    name: 'agent_executions_fts',
    source: 'agent_executions',
    pkType: 'text',
    pkCol: 'id',
    indexed: ['agent_name', 'initial_prompt', 'final_response', 'error'],
    unindexed: ['user_id', 'agent_id', 'conversation_id', 'status', 'start_time', 'end_time', 'provider', 'model'],
  },
  {
    name: 'content_outputs_fts',
    source: 'content_outputs',
    pkType: 'text',
    pkCol: 'id',
    indexed: ['title', 'content'],
    unindexed: ['user_id', 'workflow_id', 'tool_id', 'conversation_id', 'content_type', 'created_at', 'updated_at'],
  },
  {
    name: 'insights_fts',
    source: 'insights',
    pkType: 'text',
    pkCol: 'id',
    indexed: ['category', 'title', 'description', 'evidence'],
    unindexed: ['user_id', 'source_type', 'source_id', 'target_type', 'target_id', 'status', 'confidence', 'created_at'],
  },
  {
    name: 'agent_memory_fts',
    source: 'agent_memory',
    pkType: 'text',
    pkCol: 'id',
    indexed: ['content'],
    unindexed: ['user_id', 'agent_id', 'memory_type', 'created_at', 'updated_at'],
  },
  {
    name: 'workflow_versions_fts',
    source: 'workflow_versions',
    pkType: 'integer',
    pkCol: 'id',
    indexed: ['change_summary'],
    unindexed: ['workflow_id', 'version_number', 'created_by', 'change_type', 'created_at'],
  },
];

function buildCreateVirtualTableSql(spec) {
  // For TEXT-PK tables, store the TEXT id as UNINDEXED "doc_id".
  // For INTEGER-PK tables, rowid IS the id — no extra column needed.
  const cols = [];
  if (spec.pkType === 'text') cols.push('doc_id UNINDEXED');
  for (const c of spec.unindexed) cols.push(`${c} UNINDEXED`);
  for (const c of spec.indexed) cols.push(c);
  return `CREATE VIRTUAL TABLE IF NOT EXISTS ${spec.name} USING fts5(
    ${cols.join(',\n    ')},
    tokenize = 'porter unicode61'
  )`;
}

function buildInsertSql(spec) {
  // INSERT used by both backfill and AFTER INSERT trigger.
  const cols = [];
  const placeholders = [];
  if (spec.pkType === 'integer') {
    cols.push('rowid');
    placeholders.push('SRC.' + spec.pkCol);
  } else {
    cols.push('doc_id');
    placeholders.push('SRC.' + spec.pkCol);
  }
  for (const c of [...spec.unindexed, ...spec.indexed]) {
    cols.push(c);
    placeholders.push('SRC.' + c);
  }
  return { cols, placeholders };
}

function buildInsertTriggerSql(spec) {
  const { cols } = buildInsertSql(spec);
  const newCols = cols.map((c) => {
    if (c === 'rowid' || c === 'doc_id') return `new.${spec.pkCol}`;
    return `new.${c}`;
  });
  return `CREATE TRIGGER IF NOT EXISTS ${spec.source}_ai AFTER INSERT ON ${spec.source} BEGIN
    INSERT INTO ${spec.name}(${cols.join(', ')})
    VALUES (${newCols.join(', ')});
  END`;
}

/**
 * THE READ STORM THIS PREVENTS (2026-09-30)
 * ─────────────────────────────────────────
 * `DELETE FROM x_fts WHERE doc_id = old.id` is a full scan: FTS5 cannot index
 * an UNINDEXED column. It ran on every update of a mirrored column. Measured
 * on a live 32 GB database: 1,328 MB read per chat autosave
 * (content_outputs_fts), 96 MB per agent-run status change, 45 MB per memory
 * write — about 4 GB/min of disk reads on an idle-looking app.
 *
 * FTS5 keeps its columns in a plain shadow table, `<name>_content(id, c0, …)`:
 * `id` IS the FTS rowid and `c0` is the first declared column, doc_id. An
 * ordinary index on `c0` turns the lookup into an index seek, and the
 * triggers delete by rowid through it. `IN`, not `=`, so a legacy duplicate
 * search row for one document is removed too, never left stale.
 *
 * This only reads FTS5's shadow table and adds an index to it; no row of any
 * table is rewritten. Without the index the same trigger is still correct —
 * only slower — so the index is an optimisation, never a dependency. The one
 * shape that WOULD break writes is a trigger naming a `_content` table that
 * does not exist (a contentless or external-content FTS table), which is why
 * `useDocIdIndex` is only ever true after `ensureDocIdIndex` has proven the
 * layout.
 */
function docIdIndexName(spec) {
  return `${spec.name}_content_doc_id`;
}

function buildDeleteClause(spec, useDocIdIndex) {
  if (spec.pkType === 'integer') return `DELETE FROM ${spec.name} WHERE rowid = old.${spec.pkCol};`;
  if (useDocIdIndex) {
    return `DELETE FROM ${spec.name} WHERE rowid IN (SELECT id FROM ${spec.name}_content WHERE c0 = old.${spec.pkCol});`;
  }
  return `DELETE FROM ${spec.name} WHERE doc_id = old.${spec.pkCol};`;
}

/**
 * Creates the doc_id index for a TEXT-keyed FTS table when — and only when —
 * the table has exactly the layout the fast triggers rely on. Returns whether
 * the fast triggers may be used. Any doubt returns false, which keeps the
 * slow-but-correct triggers.
 */
async function ensureDocIdIndex(db, spec) {
  if (spec.pkType !== 'text') return false;
  try {
    const ftsColumns = await dbAll(db, `PRAGMA table_info(${spec.name})`);
    const shadowColumns = await dbAll(db, `PRAGMA table_info(${spec.name}_content)`);
    const layoutIsExpected =
      ftsColumns[0]?.name === 'doc_id' && shadowColumns[0]?.name === 'id' && shadowColumns[1]?.name === 'c0';
    if (!layoutIsExpected) {
      console.warn(`[FTS] ${spec.name}: unexpected shadow layout; keeping doc_id-scan triggers.`);
      return false;
    }
    await dbRun(db, `CREATE INDEX IF NOT EXISTS ${docIdIndexName(spec)} ON ${spec.name}_content(c0)`);
    return true;
  } catch (err) {
    console.warn(`[FTS] ${spec.name}: could not index doc_id (${err.message}); keeping doc_id-scan triggers.`);
    return false;
  }
}

// SQLite stores a trigger's CREATE statement minus `IF NOT EXISTS`; compare
// on content, not whitespace or keyword case.
function normalizeTriggerSql(sql) {
  return String(sql || '')
    .replace(/\bIF\s+NOT\s+EXISTS\b/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Replaces trigger `name` with `desiredSql` if, and only if, it differs.
 *
 * The DROP and CREATE run in ONE `exec` inside `BEGIN IMMEDIATE`. sqlite3_exec
 * holds the connection mutex for the whole call, so no statement from this
 * process can land between them, and IMMEDIATE takes the write lock, so the
 * workflow process cannot either. A write therefore always sees exactly one
 * version of the trigger — never none, never both (both would double-insert).
 *
 * On failure the transaction is rolled back, leaving the previous trigger in
 * place. The one exception is an error from BEGIN itself because the
 * connection is already inside someone else's transaction: rolling that back
 * would destroy their work, so it is left alone and the change is skipped.
 */
export async function replaceTriggerIfChanged(db, name, desiredSql) {
  const current = await dbGet(db, `SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?`, [name]);
  if (current && normalizeTriggerSql(current.sql) === normalizeTriggerSql(desiredSql)) return false;
  // Nothing to replace: one CREATE is already atomic and needs no transaction,
  // so a fresh database always gets its triggers even inside an outer one.
  if (!current) {
    await dbRun(db, desiredSql);
    return true;
  }
  try {
    await dbExec(db, `BEGIN IMMEDIATE; DROP TRIGGER IF EXISTS ${name}; ${desiredSql}; COMMIT;`);
  } catch (err) {
    if (!/within a transaction/i.test(err.message)) {
      await dbExec(db, 'ROLLBACK').catch(() => {});
    }
    throw err;
  }
  return true;
}

function buildUpdateTriggerSql(spec, useDocIdIndex = false) {
  const { cols } = buildInsertSql(spec);
  const newCols = cols.map((c) => {
    if (c === 'rowid' || c === 'doc_id') return `new.${spec.pkCol}`;
    return `new.${c}`;
  });
  const deleteClause = buildDeleteClause(spec, useDocIdIndex);
  // SCOPED TO THE MIRRORED COLUMNS ONLY.
  //
  // A bare `AFTER UPDATE` re-indexed the row for ANY column change, including
  // columns the FTS row does not mirror. That is wasted work, and it is also a
  // correctness trap: an AFTER INSERT trigger elsewhere that back-fills an
  // unrelated column (ownership scope_id) issues an UPDATE inside the insert,
  // this trigger then deleted and re-inserted a row the `_ai` trigger had just
  // written in the same statement, and the insert failed with a bare
  // SQLITE_CONSTRAINT. Naming the mirrored columns keeps the index correct —
  // they are the only columns whose change can alter the FTS row — and leaves
  // unrelated column writes alone. The key column is included: it is
  // mirrored too (as rowid or doc_id), and without it a changed id left the
  // search row under the old id.
  const mirrored = [spec.pkCol, ...spec.unindexed, ...spec.indexed].join(', ');
  return `CREATE TRIGGER IF NOT EXISTS ${spec.source}_au AFTER UPDATE OF ${mirrored} ON ${spec.source} BEGIN
    ${deleteClause}
    INSERT INTO ${spec.name}(${cols.join(', ')})
    VALUES (${newCols.join(', ')});
  END`;
}

function buildDeleteTriggerSql(spec, useDocIdIndex = false) {
  const deleteClause = buildDeleteClause(spec, useDocIdIndex);
  return `CREATE TRIGGER IF NOT EXISTS ${spec.source}_ad AFTER DELETE ON ${spec.source} BEGIN
    ${deleteClause}
  END`;
}

function buildBackfillSql(spec) {
  // Backfill from source → fts using the same column mapping as inserts.
  const ftsCols = [];
  const srcCols = [];
  if (spec.pkType === 'integer') {
    ftsCols.push('rowid');
    srcCols.push(spec.pkCol);
  } else {
    ftsCols.push('doc_id');
    srcCols.push(spec.pkCol);
  }
  for (const c of [...spec.unindexed, ...spec.indexed]) {
    ftsCols.push(c);
    srcCols.push(c);
  }
  return `INSERT INTO ${spec.name}(${ftsCols.join(', ')})
    SELECT ${srcCols.join(', ')} FROM ${spec.source}`;
}

/**
 * Brings one FTS table's update/delete triggers to the desired shape.
 * Returns what it did, so tests and callers can see a no-op is a no-op.
 */
export async function syncSearchTriggers(db, spec) {
  const useDocIdIndex = await ensureDocIdIndex(db, spec);
  const replaced = [];
  if (await replaceTriggerIfChanged(db, `${spec.source}_au`, buildUpdateTriggerSql(spec, useDocIdIndex))) {
    replaced.push(`${spec.source}_au`);
  }
  if (await replaceTriggerIfChanged(db, `${spec.source}_ad`, buildDeleteTriggerSql(spec, useDocIdIndex))) {
    replaced.push(`${spec.source}_ad`);
  }
  if (replaced.length) {
    const lookup = spec.pkType === 'integer' ? 'rowid' : useDocIdIndex ? 'indexed doc_id lookup' : 'doc_id scan';
    console.log(`[FTS] ${spec.name}: installed ${replaced.join(', ')} (${lookup}).`);
  }
  return { useDocIdIndex, replaced };
}

/**
 * Idempotent setup: creates FTS tables + triggers, then backfills any that
 * are empty. Safe to call on every startup.
 */
export async function setupFullTextSearch(db) {
  // First, sanity check that FTS5 is available in this SQLite build.
  try {
    await dbRun(db, `CREATE VIRTUAL TABLE IF NOT EXISTS _fts5_probe USING fts5(t)`);
    await dbRun(db, `DROP TABLE IF EXISTS _fts5_probe`);
  } catch (err) {
    console.warn('[FTS] FTS5 not available in SQLite build — memory search disabled:', err.message);
    return false;
  }

  for (const spec of FTS_TABLES) {
    try {
      await dbRun(db, buildCreateVirtualTableSql(spec));
      await dbRun(db, buildInsertTriggerSql(spec));
      // Existing installs hold older update/delete triggers (the broad
      // `AFTER UPDATE`, the doc_id scan), and `CREATE TRIGGER IF NOT EXISTS`
      // never replaces them. syncSearchTriggers replaces only a trigger that
      // differs, so a healthy database is untouched. A failure leaves the
      // previous trigger in place and must not skip the backfill below.
      try {
        await syncSearchTriggers(db, spec);
      } catch (err) {
        console.error(`[FTS] ${spec.name}: trigger update failed, previous triggers kept:`, err.message);
      }

      // Backfill once: only if FTS is empty but source has rows.
      // PRD-084-R2 §0.1: O(1) existence probes. `SELECT COUNT(*)` on an FTS5
      // table scans the entire inverted index (measured ~12s on a multi-GB
      // conversation_logs_fts), and this used to run for every FTS table in
      // BOTH processes at every boot. `LIMIT 1` answers the same
      // "is it empty?" question in O(1).
      const ftsRow = await dbGet(db, `SELECT 1 AS present FROM ${spec.name} LIMIT 1`);
      const srcRow = ftsRow ? null : await dbGet(db, `SELECT 1 AS present FROM ${spec.source} LIMIT 1`);
      if (!ftsRow && srcRow) {
        console.log(`[FTS] Backfilling ${spec.name} from ${spec.source}...`);
        await dbRun(db, buildBackfillSql(spec));
        console.log(`✓ [FTS] ${spec.name} backfilled.`);
      }
    } catch (err) {
      console.error(`[FTS] Failed to set up ${spec.name}:`, err.message);
    }
  }

  console.log('✓ [FTS] Full-text search ready.');
  return true;
}

export { FTS_TABLES };
