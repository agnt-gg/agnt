import fs from 'fs';
import zlib from 'zlib';
import readline from 'readline';
import { EXPORT_FORMAT, EXPORT_VERSION, CATEGORY_BY_ID, EXPORT_CATEGORIES } from './DataExportService.js';

/**
 * DataImportService: restore a Backup & Export file into this instance.
 *
 * STREAMING WITHOUT A JSON PARSER
 * The exporter writes one row per line (JSON.stringify escapes every newline inside a value),
 * framed by `"<category>":[` and `]` lines, with the header on the first line and
 * `"counts"`/`"complete"` in the trailer. So a restore reads the file a line at a time and
 * holds one row in memory, however many gigabytes the backup is. Gzipped backups are detected
 * by their magic bytes, not their name.
 *
 * THE RULES OF A RESTORE
 *  - It never overwrites. An item that is already here stays exactly as it is ("already here").
 *  - Everything restored belongs to the person restoring it. Owner columns are rewritten, and the
 *    exported ownership scope is dropped so this instance's own triggers assign the right one.
 *  - Nothing is attached to someone else's data: a child row (a trace's tool calls, a goal's tasks,
 *    a workflow's versions) goes in only if its parent here is the restorer's.
 *  - Ids are kept, so references between restored items (an agent's tools, a workflow's nodes) still
 *    resolve, and restoring the same file twice adds nothing the second time. Tables keyed by an
 *    auto-increment number drop that number (it means nothing on another machine) and are
 *    de-duplicated by their natural key instead.
 *  - Workflows come back stopped: a restored "listening" workflow would claim a listener that
 *    does not exist. The user starts the ones they want.
 *  - Columns are matched to this instance's schema: fields an older or newer version does not have
 *    are ignored rather than failing the restore.
 */

const OWNER_OVERRIDE = { tools: 'created_by', agents: 'created_by' };
/** Natural keys for tables whose primary key is an auto-increment number. */
const NATURAL_KEYS = {
  conversation_logs: ['user_id', 'conversation_id'],
  workflow_versions: ['workflow_id', 'version_number'],
  agent_workflows: ['agent_id', 'workflow_id'],
};
const ACTIVE_WORKFLOW_STATUSES = new Set(['listening', 'running', 'queued', 'active']);
const BATCH_ROWS = 200;
const BATCH_MS = 250;

const fail = (status, message) => Object.assign(new Error(message), { status });

/** Readable of the decompressed backup, plus a byte counter over the file as stored. */
async function openBackup(filePath) {
  const handle = await fs.promises.open(filePath, 'r');
  const magic = Buffer.alloc(2);
  await handle.read(magic, 0, 2, 0);
  await handle.close();
  const raw = fs.createReadStream(filePath);
  const progress = { bytes: 0 };
  raw.on('data', chunk => { progress.bytes += chunk.length; });
  const gzipped = magic[0] === 0x1f && magic[1] === 0x8b;
  const stream = gzipped ? raw.pipe(zlib.createGunzip()) : raw;
  if (gzipped) raw.on('error', error => stream.destroy(error));
  return { stream, progress, destroy: () => { raw.destroy(); stream.destroy(); } };
}

/**
 * Walk a backup, calling `onRow(categoryId, row)` for every row of the categories `wanted`
 * (all, if null). Resolves with the header and trailer.
 */
export async function walkBackup(filePath, { wanted = null, onRow = null, onProgress = null, signal = null } = {}) {
  const { stream, progress, destroy } = await openBackup(filePath);
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let header = null, current = null, counts = null, complete = false, error = null, lineNumber = 0;
  const seen = {};
  try {
    for await (const rawLine of lines) {
      if (signal?.aborted) throw fail(499, 'Restore cancelled');
      lineNumber += 1;
      const line = rawLine.trim();
      if (!line) continue;
      if (lineNumber === 1) {
        try { header = JSON.parse(line.replace(/,$/, '') + '}'); } catch { throw fail(400, 'This is not an AGNT backup file.'); }
        if (header.format !== EXPORT_FORMAT) throw fail(400, 'This is not an AGNT backup file.');
        if (!(header.version <= EXPORT_VERSION)) throw fail(400, 'This backup was made by a newer version of AGNT. Update AGNT, then restore it.');
        continue;
      }
      const opened = /^"([A-Za-z0-9_]+)":\[$/.exec(line);
      if (opened) { current = opened[1]; seen[current] = 0; continue; }
      if (line === ']' || line === '],') { current = null; continue; }
      if (current) {
        seen[current] += 1;
        // Every row is parsed, even when only inspecting: a damaged backup is reported before a
        // restore starts, not halfway through one.
        const row = JSON.parse(line.replace(/,$/, ''));
        if (onRow && (!wanted || wanted.has(current))) await onRow(current, row);
        if (onProgress && seen[current] % 500 === 0) onProgress(progress.bytes);
        continue;
      }
      const trailer = /^"(counts|complete|error)":(.*?),?$/.exec(line);
      if (trailer) {
        const value = JSON.parse(trailer[2]);
        if (trailer[1] === 'counts') counts = value; else if (trailer[1] === 'complete') complete = value === true; else error = value;
      }
    }
  } catch (err) {
    if (err instanceof SyntaxError) throw fail(400, `The backup is damaged near line ${lineNumber}.`);
    throw err;
  } finally {
    lines.close();
    destroy();
  }
  if (!header) throw fail(400, 'This file is empty.');
  onProgress?.(progress.bytes);
  return { header, counts: counts || seen, seen, complete, error };
}

/** What a backup contains, for the confirmation step. Reads the whole file once. */
export async function inspectBackup(filePath) {
  const { size } = await fs.promises.stat(filePath);
  const { header, seen, complete, error } = await walkBackup(filePath);
  const categories = (header.categories || []).map(id => {
    const known = CATEGORY_BY_ID.get(id);
    return { id, label: known?.label || id, group: known?.group || 'history', description: known?.description || '', count: seen[id] ?? 0, restorable: Boolean(known) };
  });
  // Order by this version's canonical order, which is dependency order.
  const order = new Map(EXPORT_CATEGORIES.map((c, i) => [c.id, i]));
  categories.sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999));
  return { exportedAt: header.exportedAt || null, filters: header.filters || {}, categories, complete, error, bytes: size };
}

/** Promise wrappers over one sqlite3 connection. */
function connection(db) {
  return {
    run: (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function done(err) { return err ? reject(err) : resolve({ changes: this.changes }); })),
    get: (sql, params = []) => new Promise((resolve, reject) => db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)))),
    all: (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])))),
  };
}

const toValue = value => {
  if (value === undefined) return null;
  if (value !== null && typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
};

/**
 * Restore the chosen categories of a backup for `userId`, on the given sqlite3 connection.
 * Resolves with per-category { added, existing, skipped } and a few example problems.
 */
export async function restoreBackup({ filePath, userId, categories, db, onProgress = () => {}, signal = null }) {
  if (!userId) throw new Error('restoreBackup requires userId');
  const sql = connection(db);
  await sql.run('PRAGMA busy_timeout = 10000');
  const wanted = new Set(categories.filter(id => CATEGORY_BY_ID.has(id)));
  if (!wanted.size) throw fail(400, 'Choose at least one thing to restore');

  const schemaCache = new Map();
  const schema = async table => {
    if (!schemaCache.has(table)) {
      const columns = await sql.all(`PRAGMA table_info("${table}")`);
      const pk = columns.filter(c => c.pk > 0);
      schemaCache.set(table, {
        exists: columns.length > 0,
        columns: new Set(columns.map(c => c.name)),
        // A single INTEGER primary key is an auto-increment rowid alias: meaningless across machines.
        autoKey: pk.length === 1 && /^INTEGER$/i.test(pk[0].type) ? pk[0].name : null,
      });
    }
    return schemaCache.get(table);
  };

  const results = {};
  const problems = [];
  const note = (categoryId, message) => { if (problems.length < 20) problems.push({ category: categoryId, message }); };

  // Batched transactions on this connection only: bounded lock time, and far fewer fsyncs than a row at a time.
  let pending = 0, openedAt = 0, inTransaction = false;
  const begin = async () => { if (!inTransaction) { await sql.run('BEGIN IMMEDIATE'); inTransaction = true; openedAt = Date.now(); pending = 0; } };
  const maybeCommit = async (force = false) => {
    if (inTransaction && (force || pending >= BATCH_ROWS || Date.now() - openedAt >= BATCH_MS)) { await sql.run('COMMIT'); inTransaction = false; }
  };

  /** Insert one row if it is not already here. Returns 'added' | 'existing' | 'conflict'. */
  async function insertRow(table, row, { ownerColumn = null } = {}) {
    const info = await schema(table);
    if (!info.exists) return 'missing-table';
    const values = { ...row };
    delete values.scope_id;
    if (ownerColumn && info.columns.has(ownerColumn)) values[ownerColumn] = userId;
    if (info.columns.has('user_id') && ownerColumn !== 'user_id' && 'user_id' in values) values.user_id = userId;
    if (table === 'workflows' && ACTIVE_WORKFLOW_STATUSES.has(values.status)) values.status = 'stopped';
    if (info.autoKey) delete values[info.autoKey];
    // A natural key decides "already here" whatever the primary key looks like: schemas differ
    // between fresh and migrated installs (agent_workflows has no usable key on a fresh one).
    const natural = NATURAL_KEYS[table];
    if (natural && natural.every(column => info.columns.has(column))) {
      const where = natural.map(column => `"${column}" IS ?`).join(' AND ');
      if (await sql.get(`SELECT 1 AS found FROM "${table}" WHERE ${where}`, natural.map(column => toValue(values[column])))) return 'existing';
    }
    const columns = Object.keys(values).filter(column => info.columns.has(column));
    if (!columns.length) return 'conflict';
    const result = await sql.run(
      `INSERT OR IGNORE INTO "${table}" (${columns.map(c => `"${c}"`).join(',')}) VALUES (${columns.map(() => '?').join(',')})`,
      columns.map(column => toValue(values[column]))
    );
    pending += 1;
    if (result.changes === 1) return 'added';
    // Not inserted: is it the restorer's own row (already here), or someone else's (conflict)?
    if (ownerColumn && info.columns.has(ownerColumn) && values.id !== undefined) {
      const existing = await sql.get(`SELECT "${ownerColumn}" AS owner FROM "${table}" WHERE id = ?`, [values.id]);
      return existing?.owner === userId ? 'existing' : 'conflict';
    }
    return 'existing';
  }

  const parentIsMine = async (table, ownerColumn, id) => {
    const row = await sql.get(`SELECT "${ownerColumn}" AS owner FROM "${table}" WHERE id = ?`, [id]);
    return row?.owner === userId;
  };

  const header = await (async () => {
    try {
      return await walkBackup(filePath, {
        wanted,
        signal,
        onProgress,
        onRow: async (categoryId, row) => {
          const category = CATEGORY_BY_ID.get(categoryId);
          const tally = results[categoryId] || (results[categoryId] = { added: 0, existing: 0, skipped: 0 });
          const ownerColumn = OWNER_OVERRIDE[category.table] || category.ownerColumn || (category.table === 'workflow_versions' ? null : 'user_id');
          const own = {}, children = {};
          for (const [key, value] of Object.entries(row)) {
            if (category.children?.some(child => child.key === key) && Array.isArray(value)) children[key] = value; else own[key] = value;
          }
          try {
            await begin();
            if (category.table === 'workflow_versions' && !(await parentIsMine('workflows', 'user_id', own.workflow_id))) {
              tally.skipped += 1;
              note(categoryId, 'A workflow version was skipped because its workflow is not in this instance. Restore Workflows too.');
              return;
            }
            const outcome = await insertRow(category.table, own, { ownerColumn });
            if (outcome === 'missing-table') { tally.skipped += 1; note(categoryId, `This version of AGNT has nowhere to put ${category.label.toLowerCase()}.`); return; }
            if (outcome === 'conflict') { tally.skipped += 1; note(categoryId, `An item in ${category.label} has the same id as something that is not yours, so it was left out.`); return; }
            tally[outcome] += 1;
            // Children only under a parent that is the restorer's own.
            if (category.children?.length && own.id !== undefined && (outcome === 'added' || (await parentIsMine(category.table, ownerColumn, own.id)))) {
              for (const child of category.children) {
                for (const childRow of children[child.key] || []) {
                  await insertRow(child.table, { ...childRow, [child.foreignKey]: own.id });
                }
              }
            }
          } catch (err) {
            tally.skipped += 1;
            note(categoryId, err.message);
          } finally {
            await maybeCommit();
          }
        },
      });
    } finally {
      if (inTransaction) { try { await sql.run('COMMIT'); } catch (err) { console.error('[DataImport] final commit failed:', err.message); } inTransaction = false; }
    }
  })();

  for (const id of wanted) results[id] = results[id] || { added: 0, existing: 0, skipped: 0 };
  return { results, problems, backupComplete: header.complete, exportedAt: header.header.exportedAt || null };
}

export default { walkBackup, inspectBackup, restoreBackup };
