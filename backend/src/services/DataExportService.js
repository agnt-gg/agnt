import crypto from 'crypto';
import zlib from 'zlib';
import { promisify } from 'util';
import db from '../models/database/index.js';
import PayloadStore from './storage/PayloadStore.js';

/**
 * DataExportService — download everything AGNT remembers about a user, or any
 * subset of it, as one JSON document.
 *
 * WHY IT STREAMS
 * --------------
 * On a long-lived install these tables are not small: conversation logs, tool
 * calls and generated outputs each run to a gigabyte or more, and workflow
 * node executions can run to tens of gigabytes. Building the document in
 * memory (or handing the browser a Blob) would take the process down with it.
 * So every category is read in keyset pages (`rowid > ?`) and written through
 * a backpressure-aware sink straight to the HTTP response, which the browser
 * saves to disk through its native download path.
 *
 * WHY A TICKET
 * ------------
 * A native download is a plain navigation, and a navigation cannot carry an
 * Authorization header. Putting the session JWT in the URL would leak it into
 * history and logs, so an authenticated POST mints a random, single-use ticket
 * that expires in a minute, and the download URL carries only that.
 *
 * SHAPE
 * -----
 *   { format, version, exportedAt, filters, categories,
 *     <categoryId>: [ row, ... ], ...,
 *     counts: { <categoryId>: n }, complete: true }
 *
 * `complete` is written LAST. A document that ends without `"complete":true`
 * was cut short, and one that ends with `"complete":false` names the error.
 */

const dbAll = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });

const dbGet = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });

const gunzip = promisify(zlib.gunzip);

export const EXPORT_FORMAT = 'agnt-data-export';
export const EXPORT_VERSION = 1;

/** Workflow versions above a size threshold are stored as base64 gzip. */
async function inflateWorkflowVersion(row) {
  if (row.is_compressed && typeof row.workflow_state === 'string') {
    try {
      row.workflow_state = (await gunzip(Buffer.from(row.workflow_state, 'base64'))).toString('utf8');
      row.is_compressed = 0;
    } catch (err) {
      // Keep the stored bytes: an export that silently drops a version is
      // worse than one that carries it in its stored form, flagged.
      row.export_note = `workflow_state left compressed: ${err.message}`;
    }
  }
  return row;
}

/**
 * Every exportable category. `scope` is a WHERE fragment taking exactly one
 * parameter — the user id — and is the ONLY thing standing between one user's
 * export and another's rows, so every category must have one.
 *
 * `dateColumn` holds mixed formats across tables ("2026-09-22 16:06:33" and
 * "2026-09-22T17:26:21.836Z"); filters compare its first ten characters, which
 * are YYYY-MM-DD in both.
 *
 * `pageSize` bounds memory, and it is sized to the table's WORST rows, not its
 * average: a single conversation, output or task can run to tens of megabytes,
 * and each row briefly exists three times (stored text, decoded tree,
 * serialized output). Measured on a large real install, pages of 20
 * conversations / 10 outputs pushed the backend ~560 MB above baseline; the
 * sizes below keep an export to roughly one heavy row in flight at a time.
 *
 * Children are nested under their parent, so a trace carries its tool calls
 * the way get_trace returns it. They are located per page of parents by their
 * indexed foreign key (ids only), then streamed `pageSize` rows at a time.
 */
export const EXPORT_CATEGORIES = [
  {
    id: 'memories',
    label: 'Agent memories',
    description: 'Facts, preferences, corrections and lessons agents have saved.',
    table: 'agent_memory',
    scope: 'user_id = ?',
    dateColumn: 'created_at',
    pageSize: 500,
  },
  {
    id: 'insights',
    label: 'Insights',
    description: 'Improvement insights extracted from runs, with evidence and status.',
    table: 'insights',
    scope: 'user_id = ?',
    dateColumn: 'created_at',
    pageSize: 500,
  },
  {
    id: 'conversations',
    label: 'Conversations',
    description: 'Full chat history for every conversation.',
    table: 'conversation_logs',
    scope: 'user_id = ?',
    dateColumn: 'updated_at',
    pageSize: 4,
  },
  {
    id: 'traces',
    label: 'Agent traces',
    description: 'Every agent and orchestrator run with each tool call, tokens and cost.',
    table: 'agent_executions',
    scope: 'user_id = ?',
    dateColumn: 'start_time',
    pageSize: 100,
    children: [
      { key: 'toolExecutions', table: 'agent_tool_executions', foreignKey: 'execution_id', orderBy: 'start_time', pageSize: 100 },
    ],
  },
  {
    id: 'workflowRuns',
    label: 'Workflow runs',
    description: 'Workflow executions with each node’s input and output. Usually the largest category.',
    table: 'workflow_executions',
    scope: 'user_id = ?',
    dateColumn: 'start_time',
    pageSize: 100,
    children: [
      {
        key: 'nodeExecutions',
        table: 'node_executions',
        foreignKey: 'execution_id',
        orderBy: 'start_time',
        pageSize: 25,
        // Large node payloads live in the blob store; the column holds an
        // envelope. unpack() resolves both envelopes and plain JSON.
        payloadColumns: ['input', 'output'],
      },
    ],
  },
  {
    id: 'goals',
    label: 'Goals',
    description: 'Goals with their tasks and evaluations.',
    table: 'goals',
    scope: 'user_id = ?',
    dateColumn: 'created_at',
    pageSize: 50,
    children: [
      // Task input/output routinely runs to tens of megabytes: one at a time.
      { key: 'tasks', table: 'tasks', foreignKey: 'goal_id', orderBy: 'order_index', pageSize: 1 },
      { key: 'evaluations', table: 'goal_evaluations', foreignKey: 'goal_id', orderBy: 'created_at', pageSize: 50 },
    ],
  },
  {
    id: 'outputs',
    label: 'Generated outputs',
    description: 'Content produced by workflows, tools and chats.',
    table: 'content_outputs',
    scope: 'user_id = ?',
    dateColumn: 'updated_at',
    pageSize: 2,
  },
  {
    id: 'workflowVersions',
    label: 'Workflow versions',
    description: 'Saved version history of your workflows.',
    table: 'workflow_versions',
    // workflow_versions has no user_id; ownership comes through workflows.
    scope: 'workflow_id IN (SELECT id FROM workflows WHERE user_id = ?)',
    dateColumn: 'created_at',
    pageSize: 50,
    transform: inflateWorkflowVersion,
  },
];

const CATEGORY_BY_ID = new Map(EXPORT_CATEGORIES.map((c) => [c.id, c]));
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ROWID_ALIAS = '__export_rowid';

/**
 * Validate and normalize caller options. Throws a 400-shaped error on bad
 * input rather than guessing: an export that quietly ignored a typo'd
 * category would look complete and not be.
 */
export function normalizeExportOptions({ categories, since, until, compress } = {}) {
  const fail = (message) => Object.assign(new Error(message), { status: 400 });

  let ids = categories;
  if (ids === undefined || ids === null || ids === 'all') ids = EXPORT_CATEGORIES.map((c) => c.id);
  if (!Array.isArray(ids) || ids.length === 0) throw fail('Choose at least one category to export');
  const unknown = ids.filter((id) => !CATEGORY_BY_ID.has(id));
  if (unknown.length) throw fail(`Unknown export categor${unknown.length > 1 ? 'ies' : 'y'}: ${unknown.join(', ')}`);

  for (const [name, value] of [['since', since], ['until', until]]) {
    if (value !== undefined && value !== null && value !== '' && !(typeof value === 'string' && DATE_RE.test(value) && !Number.isNaN(Date.parse(value)))) {
      throw fail(`${name} must be a date in YYYY-MM-DD form`);
    }
  }
  const normSince = since || null;
  const normUntil = until || null;
  if (normSince && normUntil && normSince > normUntil) throw fail('since must not be after until');

  // Keep the canonical category order regardless of request order, so two
  // exports of the same selection are structurally identical.
  const selected = EXPORT_CATEGORIES.filter((c) => ids.includes(c.id)).map((c) => c.id);
  return { categories: selected, since: normSince, until: normUntil, compress: compress === true };
}

function whereFor(category, userId, { since, until }) {
  const clauses = [`(${category.scope})`];
  const params = [userId];
  if (since) { clauses.push(`substr(${category.dateColumn}, 1, 10) >= ?`); params.push(since); }
  if (until) { clauses.push(`substr(${category.dateColumn}, 1, 10) <= ?`); params.push(until); }
  return { clause: clauses.join(' AND '), params };
}

/** Row counts per category for the picker. Parent rows only — cheap. */
export async function countExportCategories(userId, filters = {}) {
  if (!userId) throw new Error('countExportCategories requires userId');
  const { since, until } = normalizeExportOptions({ categories: 'all', since: filters.since, until: filters.until });
  return Promise.all(
    EXPORT_CATEGORIES.map(async (category) => {
      const { clause, params } = whereFor(category, userId, { since, until });
      try {
        const row = await dbGet(`SELECT COUNT(*) AS n FROM ${category.table} WHERE ${clause}`, params);
        return { id: category.id, label: category.label, description: category.description, count: row?.n ?? 0 };
      } catch (err) {
        // A missing table on an older schema is reported, not fatal.
        return { id: category.id, label: category.label, description: category.description, count: null, error: err.message };
      }
    })
  );
}

/**
 * JSON-in-a-column is common here (histories, tool args, logs). Decode it so
 * the export is readable JSON rather than JSON-encoded strings of JSON; any
 * value that is not valid JSON is kept exactly as stored.
 */
function decodeJsonText(value) {
  if (typeof value !== 'string') return value;
  const first = value.trimStart()[0];
  if (first !== '{' && first !== '[') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

async function decodeRow(row, payloadColumns = []) {
  for (const key of Object.keys(row)) {
    row[key] = payloadColumns.includes(key) ? await PayloadStore.unpack(row[key]) : decodeJsonText(row[key]);
  }
  return row;
}

/**
 * Ordered child rowids for a page of parents: parentId -> [rowid, ...].
 * Ids only, so it stays small however heavy the child rows are.
 */
export async function childRowIdsByParent(child, parentIds) {
  const byParent = new Map();
  if (parentIds.length === 0) return byParent;
  const rows = await dbAll(
    `SELECT rowid AS rid, ${child.foreignKey} AS fk FROM ${child.table}
     WHERE ${child.foreignKey} IN (${parentIds.map(() => '?').join(',')})
     ORDER BY ${child.foreignKey}, ${child.orderBy}, rowid`,
    parentIds
  );
  for (const { rid, fk } of rows) {
    if (!byParent.has(fk)) byParent.set(fk, []);
    byParent.get(fk).push(rid);
  }
  return byParent;
}

/** Decoded child rows for the given rowids, in the given order, a chunk at a time. */
export async function* readChildRows(child, rowids) {
  const chunkSize = child.pageSize || 100;
  for (let i = 0; i < rowids.length; i += chunkSize) {
    const chunk = rowids.slice(i, i + chunkSize);
    const rows = await dbAll(
      `SELECT rowid AS ${ROWID_ALIAS}, * FROM ${child.table} WHERE rowid IN (${chunk.map(() => '?').join(',')})`,
      chunk
    );
    const byRowid = new Map(rows.map((r) => [r[ROWID_ALIAS], r]));
    for (const rid of chunk) {
      const row = byRowid.get(rid);
      if (!row) continue; // deleted between the id query and now
      delete row[ROWID_ALIAS];
      yield decodeRow(row, child.payloadColumns);
    }
  }
}

/**
 * Yield pages of decoded parent rows for one category, in rowid order.
 * Children are NOT attached here: they are streamed into the document one row
 * at a time by streamExport, because a single parent's children can total
 * hundreds of megabytes (one real goal: 197 MB across six tasks).
 * Keyset pagination: each page resumes after the last rowid seen, so the cost
 * is linear in table size and rows written during the export cannot shift a
 * page boundary and cause a duplicate or a skip.
 */
export async function* readCategoryPages(category, userId, filters, { pageSize = category.pageSize } = {}) {
  const { clause, params } = whereFor(category, userId, filters);
  let after = Number.MIN_SAFE_INTEGER;
  for (;;) {
    const rows = await dbAll(
      `SELECT rowid AS ${ROWID_ALIAS}, * FROM ${category.table} WHERE ${clause} AND rowid > ? ORDER BY rowid LIMIT ?`,
      [...params, after, pageSize]
    );
    if (rows.length === 0) return;
    after = rows[rows.length - 1][ROWID_ALIAS];
    for (const row of rows) {
      delete row[ROWID_ALIAS];
      // Transform first: it works on stored bytes (e.g. base64 gzip), and
      // what it produces still needs JSON decoding.
      if (category.transform) await category.transform(row);
      await decodeRow(row);
    }
    yield rows;
    if (rows.length < pageSize) return;
  }
}

export function exportFilename(options, now = new Date()) {
  const stamp = now.toISOString().slice(0, 10);
  const all = options.categories.length === EXPORT_CATEGORIES.length;
  const which = all ? 'all' : options.categories.length === 1 ? options.categories[0] : 'selection';
  return `agnt-export-${which}-${stamp}.json${options.compress ? '.gz' : ''}`;
}

/**
 * Stream the export to an HTTP response (or any writable with the same
 * surface). Resolves with the per-category counts once the document is
 * closed. Stops reading the database as soon as the client goes away.
 */
export async function streamExport({ userId, options, res, now = new Date() }) {
  if (!userId) throw new Error('streamExport requires userId');

  res.status(200);
  res.setHeader('Content-Type', options.compress ? 'application/gzip' : 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${exportFilename(options, now)}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  const sink = options.compress ? zlib.createGzip({ level: 6 }) : res;
  if (options.compress) sink.pipe(res);

  let clientGone = false;
  res.on('close', () => {
    if (!res.writableFinished) clientGone = true;
  });

  const write = async (chunk) => {
    if (clientGone) return;
    if (!sink.write(chunk)) {
      await new Promise((resolve) => {
        const done = () => { sink.off('drain', done); res.off('close', done); resolve(); };
        sink.on('drain', done);
        res.on('close', done);
      });
    }
  };

  // Every structure opened in the document pushes its closer here and pops
  // it when closed. A failure at ANY depth — mid-category, mid-parent,
  // mid-child-list — can then be closed out exactly, so the trailer that
  // reports the failure is still part of a parseable document.
  const closers = [];
  const open = async (text, closer) => { await write(text); closers.push(closer); };
  const close = async () => write(closers.pop());

  // A parent is written as its own fields, then each child list streamed row
  // by row, so memory holds one child at a time rather than the whole family.
  const writeRow = async (category, row, childIds) => {
    if (!category.children?.length) return write(JSON.stringify(row));
    const own = JSON.stringify(row);
    await open(own.slice(0, -1), '}');
    for (const [index, child] of category.children.entries()) {
      await open(`${own === '{}' && index === 0 ? '' : ','}${JSON.stringify(child.key)}:[`, ']');
      let first = true;
      for await (const childRow of readChildRows(child, childIds[index].get(row.id) || [])) {
        if (clientGone) return;
        await write((first ? '' : ',') + JSON.stringify(childRow));
        first = false;
      }
      await close();
    }
    await close();
  };

  const counts = {};
  let failure = null;
  const header = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: now.toISOString(),
    filters: { since: options.since, until: options.until },
    categories: options.categories,
  };
  await write(JSON.stringify(header).slice(0, -1));

  try {
    for (const id of options.categories) {
      if (clientGone) break;
      const category = CATEGORY_BY_ID.get(id);
      counts[id] = 0;
      await open(`,\n${JSON.stringify(id)}:[`, '\n]');
      for await (const page of readCategoryPages(category, userId, options)) {
        if (clientGone) break;
        const childIds = [];
        for (const child of category.children || []) {
          childIds.push(await childRowIdsByParent(child, page.map((p) => p.id)));
        }
        for (const row of page) {
          if (clientGone) break;
          await write(counts[id] === 0 ? '\n' : ',\n');
          await writeRow(category, row, childIds);
          counts[id] += 1;
        }
      }
      await close();
    }
  } catch (err) {
    failure = err;
    console.error('[DataExport] export failed mid-stream:', err);
    while (closers.length) await close();
  }

  if (!clientGone) {
    // Headers are long gone by now, so a failure is reported INSIDE the
    // document. It still parses, and it says plainly that it is incomplete.
    const trailer = failure
      ? `,\n"counts":${JSON.stringify(counts)},\n"complete":false,\n"error":${JSON.stringify(failure.message)}\n}\n`
      : `,\n"counts":${JSON.stringify(counts)},\n"complete":true\n}\n`;
    await write(trailer);
  }
  sink.end();
  return { counts, complete: !failure && !clientGone, error: failure?.message || null };
}

// ------------------------------------------------------------- tickets -----

const TICKET_TTL_MS = 60_000;
const tickets = new Map();

function pruneTickets(now) {
  for (const [token, ticket] of tickets) if (ticket.expiresAt <= now) tickets.delete(token);
}

/** Mint a single-use download ticket bound to one user and one option set. */
export function createExportTicket(userId, options, now = Date.now()) {
  if (!userId) throw new Error('createExportTicket requires userId');
  pruneTickets(now);
  const token = crypto.randomBytes(32).toString('base64url');
  tickets.set(token, { userId, options, expiresAt: now + TICKET_TTL_MS });
  return { token, expiresAt: new Date(now + TICKET_TTL_MS).toISOString() };
}

/** Redeem a ticket. Returns null if unknown, expired or already used. */
export function consumeExportTicket(token, now = Date.now()) {
  if (typeof token !== 'string' || token.length === 0) return null;
  const ticket = tickets.get(token);
  tickets.delete(token);
  if (!ticket || ticket.expiresAt <= now) return null;
  return { userId: ticket.userId, options: ticket.options };
}

export default {
  EXPORT_CATEGORIES,
  normalizeExportOptions,
  countExportCategories,
  readCategoryPages,
  streamExport,
  exportFilename,
  createExportTicket,
  consumeExportTicket,
};
