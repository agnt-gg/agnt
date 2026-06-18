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
 *   and the TEXT id is stored as an UNINDEXED column `doc_id`. Delete by
 *   doc_id scans the FTS table, which is acceptable at our scale (thousands
 *   of rows, not millions).
 */

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

function buildUpdateTriggerSql(spec) {
  const { cols } = buildInsertSql(spec);
  const newCols = cols.map((c) => {
    if (c === 'rowid' || c === 'doc_id') return `new.${spec.pkCol}`;
    return `new.${c}`;
  });
  const deleteClause =
    spec.pkType === 'integer'
      ? `DELETE FROM ${spec.name} WHERE rowid = old.${spec.pkCol};`
      : `DELETE FROM ${spec.name} WHERE doc_id = old.${spec.pkCol};`;
  return `CREATE TRIGGER IF NOT EXISTS ${spec.source}_au AFTER UPDATE ON ${spec.source} BEGIN
    ${deleteClause}
    INSERT INTO ${spec.name}(${cols.join(', ')})
    VALUES (${newCols.join(', ')});
  END`;
}

function buildDeleteTriggerSql(spec) {
  const deleteClause =
    spec.pkType === 'integer'
      ? `DELETE FROM ${spec.name} WHERE rowid = old.${spec.pkCol};`
      : `DELETE FROM ${spec.name} WHERE doc_id = old.${spec.pkCol};`;
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
      await dbRun(db, buildUpdateTriggerSql(spec));
      await dbRun(db, buildDeleteTriggerSql(spec));

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
