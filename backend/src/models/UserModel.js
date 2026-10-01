import fs from 'fs';
import path from 'path';
import db from './database/index.js';
import PathManager from '../utils/PathManager.js';
import { parseFallbackChain, serializeFallbackChain } from '../services/orchestrator/fallbackChain.js';
import {
  normalizeGlobalRoutingMode,
  parseRoutingPolicy,
  serializeRoutingPolicy,
} from '../services/orchestrator/routingMode.js';
import {
  parsePreferences,
  mergePreferences,
  serializePreferences,
} from '../utils/userPreferences.js';

/**
 * Serializes preference read-modify-write per user.
 *
 * THE BUG THIS PREVENTS
 * ─────────────────────
 * Preferences are ONE JSON column, so an update is read → merge → write. Two
 * requests interleaving between the read and the write both start from the
 * same snapshot and the second write erases the first. That is not
 * theoretical here: the frontend saves theme and panel geometry from separate
 * watchers, so a single user action (switch theme while a panel animates)
 * fires two PUTs milliseconds apart. The loser vanishes with no error on
 * either side — the exact failure mode this whole feature exists to fix.
 *
 * A promise chain per user is sufficient because the backend is a single
 * process sharing one sqlite connection. It would NOT be sufficient across
 * processes; if AGNT ever forks workers, this has to become a real
 * `BEGIN IMMEDIATE` transaction. Documented rather than pre-solved, because a
 * transaction on node-sqlite3's shared connection serializes every other
 * writer too, and that is a real cost to pay for a hypothetical.
 */
const preferenceWriteQueues = new Map();

function withPreferenceLock(userId, task) {
  const prev = preferenceWriteQueues.get(userId) || Promise.resolve();
  // Swallow the predecessor's rejection: one failed write must not poison
  // every subsequent write for that user.
  const next = prev.catch(() => {}).then(task);
  preferenceWriteQueues.set(userId, next);
  // Drop the entry once drained so a long-lived process does not accumulate
  // one resolved promise per user forever.
  next.catch(() => {}).finally(() => {
    if (preferenceWriteQueues.get(userId) === next) preferenceWriteQueues.delete(userId);
  });
  return next;
}

/**
 * What each subscription seat costs per month (PRD-122), as
 * `{ providerKey: monthlyUsd }`.
 *
 * Tolerant on read and strict on write: a malformed or legacy value becomes
 * `{}` rather than throwing, because this is optional enrichment for one
 * dashboard panel and must never be able to break loading a user's settings.
 * Non-finite and negative amounts are dropped — a negative subscription fee is
 * not a thing, and letting one through would invert every figure derived from
 * it.
 */
function parseSubscriptionCosts(raw) {
  if (!raw) return {};
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out = {};
    for (const [provider, amount] of Object.entries(parsed)) {
      const n = Number(amount);
      if (Number.isFinite(n) && n > 0) out[String(provider).toLowerCase()] = n;
    }
    return out;
  } catch {
    return {};
  }
}

function serializeSubscriptionCosts(value) {
  const clean = parseSubscriptionCosts(value);
  // An empty map is stored as NULL, so "never told us" and "told us nothing"
  // are the same state rather than two.
  return Object.keys(clean).length ? JSON.stringify(clean) : null;
}

/**
 * Node-execution counts for getUserStats, kept incrementally per user.
 *
 * THE READ STORM THIS PREVENTS (2026-09-30)
 * ─────────────────────────────────────────
 * getUserStats joined every node execution the user ever ran to its workflow
 * run on every call. Measured on a live install (277k runs, 1.1M node rows):
 * 1,115 MB read and ~1.9 s per call, and the right panel polls it every 60 s.
 *
 * History only ever grows by appended rows (rowid increases), so the count is
 * kept per user with a rowid watermark: rows at or below `through` are already
 * counted, and each call reads only the rows added since. The first call after
 * boot, and one call every NODE_STATS_RECOUNT_MS, recount from scratch, which
 * bounds any drift from a deletion nothing told us about.
 *
 * SETTLED VS UNSETTLED ROWS. A node row is inserted as 'started' and updated
 * when the node finishes, and that UPDATE matches on (execution_id, node_id),
 * so a node re-run in a loop rewrites earlier rows of the same run too. A
 * row's status is therefore final only once its whole run is finalized
 * (end_time is written exactly once, by the terminal write). Rows from the
 * oldest still-running run onward are re-counted on every call and never
 * folded into the cache. A run with no end_time that started more than
 * NODE_STATS_UNSETTLED_WINDOW ago crashed without finalizing and is treated as
 * settled — otherwise one crashed run would pin the watermark forever.
 *
 * ACROSS RESTARTS. The first call after every boot used to be the full
 * recount — 1.1 GB, fired by the app's own startup data load, at the moment the
 * disk was busiest. The cache is therefore also kept in a small file in the
 * data directory. A persisted entry is trusted only if it is younger than
 * NODE_STATS_RECOUNT_MS AND the node row at its watermark still has the id it
 * had when counted (`anchorId`): a restored, reset or swapped database fails
 * that check and is recounted. It is a cache — deleting it costs one recount.
 *
 * Deletions (Settings → Reset, retention) must call invalidateNodeStats().
 */
const NODE_STATS_RECOUNT_MS = 6 * 60 * 60 * 1000;
const NODE_STATS_UNSETTLED_WINDOW = '-6 hours';
const UNSETTLED_RUN = `e.end_time IS NULL AND julianday(e.start_time) > julianday('now', '${NODE_STATS_UNSETTLED_WINDOW}')`;
const NODE_STATS_COLUMNS = `count(*) AS total,
  coalesce(sum(ne.status = 'completed'), 0) AS completed,
  coalesce(sum(ne.status = 'error'), 0) AS error,
  min(CASE WHEN ${UNSETTLED_RUN} THEN ne.rowid END) AS firstUnsettled`;

export const NODE_STATS_SQL = {
  // Whole history: the user's runs, then the covering (execution_id, status)
  // node index. Only on a cold or expired cache. The unary `+` keeps the rowid
  // bound out of index selection: as a plain `ne.rowid <= ?` SQLite chose the
  // NON-covering execution_id index for it and read every node row — measured
  // 58 s and 2.5 GB, against 1.9 s and 1.1 GB for the covering plan.
  full: `SELECT ${NODE_STATS_COLUMNS}
    FROM node_executions ne JOIN workflow_executions e ON ne.execution_id = e.id
    WHERE e.user_id = ? AND +ne.rowid <= ?`,
  // Only rows added since the watermark. CROSS JOIN pins node-first order:
  // left to itself SQLite starts from the user's 277k runs (measured 11 s).
  since: `SELECT ${NODE_STATS_COLUMNS}
    FROM node_executions ne CROSS JOIN workflow_executions e
    WHERE ne.rowid > ? AND ne.rowid <= ? AND e.id = ne.execution_id AND e.user_id = ?`,
};

const nonEmpty = (value) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);

/** A SQLite `dflt_value` ('text', quoted) as the plain string, or null. */
function unquoteColumnDefault(raw) {
  if (raw === null || raw === undefined) return null;
  const text = String(raw);
  const quoted = /^'(.*)'$/s.exec(text);
  return nonEmpty(quoted ? quoted[1].replace(/''/g, "'") : text);
}

let columnDefaultAiPromise = null;

/**
 * The default_provider/default_model COLUMN DEFAULTS this install's `users`
 * table was created with, read from the schema itself.
 *
 * Older installs created both columns with a vendor default. SQLite cannot
 * drop a column default without rebuilding the table, so any row inserted
 * without naming the columns was stamped with a provider and model nobody
 * chose. The values are read here rather than written in code, so nothing in
 * the code names a vendor. On first use, rows still carrying the stamp are
 * cleared once; new installs have no column default and this is a no-op.
 */
export function columnDefaultAi() {
  columnDefaultAiPromise ??= new Promise((resolve) => {
    db.all('PRAGMA table_info(users)', [], (err, columns) => {
      if (err || !Array.isArray(columns)) {
        columnDefaultAiPromise = null; // transient: try again next time
        return resolve({ provider: null, model: null });
      }
      const columnDefault = (name) => unquoteColumnDefault(columns.find((c) => c.name === name)?.dflt_value);
      const stamp = { provider: columnDefault('default_provider'), model: columnDefault('default_model') };
      if (!stamp.provider || !stamp.model) return resolve(stamp);
      db.run(
        'UPDATE users SET default_provider = NULL, default_model = NULL WHERE default_provider = ? AND default_model = ?',
        [stamp.provider, stamp.model],
        function (updateErr) {
          if (updateErr) console.warn('[UserModel] Could not clear unchosen default AI rows:', updateErr.message);
          else if (this.changes > 0) console.info(`[UserModel] Cleared ${this.changes} unchosen default AI row(s) stamped by the legacy schema.`);
          resolve(stamp);
        }
      );
    });
  });
  return columnDefaultAiPromise;
}

/**
 * The stored default pair, or nulls. Never a substituted default, and never
 * the schema's own column-default stamp, which no user chose.
 */
export function readStoredDefaultAi(storedProvider, storedModel, columnDefault = {}) {
  const provider = nonEmpty(storedProvider);
  const model = nonEmpty(storedModel);
  if (!provider) return { provider: null, model: null };
  if (columnDefault.provider && columnDefault.model && provider === columnDefault.provider && model === columnDefault.model) {
    return { provider: null, model: null };
  }
  return { provider, model };
}

// Bounded per user: this is a diagnostic trail, not an audit archive.
const DEFAULT_AI_HISTORY_LIMIT = 200;
const CHANGE_SOURCE_PATTERN = /^[a-z0-9][a-z0-9:._-]{0,63}$/i;

/** A caller-supplied change source, or 'unknown'. Untrusted input: never stored raw. */
export function normalizeChangeSource(source) {
  return typeof source === 'string' && CHANGE_SOURCE_PATTERN.test(source) ? source : 'unknown';
}

const dbRunStatement = (sql, params) =>
  new Promise((resolve, reject) => db.run(sql, params, function (err) { return err ? reject(err) : resolve(this); }));

/**
 * Record a change to the account default provider/model.
 *
 * Exists because the default has been rewritten by code paths nobody could
 * name afterwards; a row per real change, with the writer that made it, is
 * what turns the next "it switched to Anthropic again" into a lookup. Logging
 * failures are reported and swallowed: a diagnostic must never fail the write.
 */
async function recordDefaultAiChange(userId, previous, next, source) {
  if (previous.provider === next.provider && previous.model === next.model) return;
  console.info(
    `[UserModel] default AI ${previous.provider || '(none)'}/${previous.model || '(none)'} -> ` +
      `${next.provider || '(none)'}/${next.model || '(none)'} (source: ${source})`
  );
  try {
    await dbRunStatement(
      `INSERT INTO default_ai_changes (user_id, previous_provider, previous_model, provider, model, source)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, previous.provider, previous.model, next.provider, next.model, source]
    );
    await dbRunStatement(
      `DELETE FROM default_ai_changes WHERE user_id = ? AND id NOT IN (
         SELECT id FROM default_ai_changes WHERE user_id = ? ORDER BY id DESC LIMIT ?)`,
      [userId, userId, DEFAULT_AI_HISTORY_LIMIT]
    );
  } catch (err) {
    console.warn('[UserModel] Could not record default AI change:', err.message);
  }
}

const nodeStatsCache = new Map(); // userId -> { through, anchorId, total, completed, error, countedAt }
const nodeStatsInFlight = new Map(); // userId -> Promise
let nodeStatsGeneration = 0;

const dbGetRow = (sql, params) =>
  new Promise((resolve, reject) => db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row))));

const nodeStatsFile = () => path.join(PathManager.dataDir, 'node-stats-cache.json');
// Every write and delete of the file goes through this chain, in order, so an
// invalidation can never be overtaken by a write that started before it.
let nodeStatsFileQueue = Promise.resolve();
const enqueueFileTask = (task) => {
  nodeStatsFileQueue = nodeStatsFileQueue.then(task).catch((err) => {
    console.warn('[UserModel] node stats cache file:', err.message);
  });
  return nodeStatsFileQueue;
};

function persistNodeStats() {
  return enqueueFileTask(async () => {
    // Written from the cache as it is when the write RUNS, not when it was
    // requested: an invalidation queued meanwhile has already emptied it.
    const file = nodeStatsFile();
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(Object.fromEntries(nodeStatsCache)));
    await fs.promises.rename(tmp, file);
  });
}

async function anchorIdAt(rowid) {
  if (!rowid) return null;
  return (await dbGetRow('SELECT id FROM node_executions WHERE rowid = ?', [rowid]))?.id ?? null;
}

/** A persisted entry for `userId` that still describes THIS database, or null. */
async function loadPersistedBase(userId) {
  // Let queued file work land first. An invalidation deletes the file through
  // the queue; reading past it would resurrect a count for history that is
  // gone — and the anchor check cannot catch that when only OLDER rows went.
  await nodeStatsFileQueue;
  let entry;
  try {
    entry = JSON.parse(await fs.promises.readFile(nodeStatsFile(), 'utf8'))?.[userId];
  } catch {
    return null; // missing or unreadable: recount
  }
  if (!entry || !Number.isInteger(entry.through) || Date.now() - entry.countedAt > NODE_STATS_RECOUNT_MS) return null;
  if (entry.through > 0 && (await anchorIdAt(entry.through)) !== entry.anchorId) return null;
  return entry;
}

function countNodeRows(userId, afterRowid, uptoRowid) {
  return afterRowid === 0
    ? dbGetRow(NODE_STATS_SQL.full, [userId, uptoRowid])
    : dbGetRow(NODE_STATS_SQL.since, [afterRowid, uptoRowid, userId]);
}

async function computeNodeStats(userId) {
  const generation = nodeStatsGeneration;
  // Bound every read by the rowid seen now, so rows appended mid-call are
  // counted by the next call instead of half-counted by this one.
  const upto = (await dbGetRow('SELECT max(rowid) AS m FROM node_executions', [])).m || 0;
  let base = nodeStatsCache.get(userId) || (await loadPersistedBase(userId));
  if (!base || Date.now() - base.countedAt > NODE_STATS_RECOUNT_MS || upto < base.through) {
    base = { through: 0, anchorId: null, total: 0, completed: 0, error: 0, countedAt: Date.now() };
  }

  const added = upto > base.through ? await countNodeRows(userId, base.through, upto) : null;
  let settled = added;
  let unsettled = null;
  if (added?.firstUnsettled != null) {
    unsettled = await countNodeRows(userId, added.firstUnsettled - 1, upto);
    settled = {
      total: added.total - unsettled.total,
      completed: added.completed - unsettled.completed,
      error: added.error - unsettled.error,
    };
  }

  const through = added?.firstUnsettled != null ? added.firstUnsettled - 1 : upto;
  const next = {
    through,
    anchorId: through === base.through ? base.anchorId : await anchorIdAt(through),
    total: base.total + (settled?.total || 0),
    completed: base.completed + (settled?.completed || 0),
    error: base.error + (settled?.error || 0),
    countedAt: base.countedAt,
  };
  // An invalidation that landed while this ran makes `next` stale; do not keep it.
  if (generation === nodeStatsGeneration) {
    const moved = nodeStatsCache.get(userId)?.through !== next.through;
    nodeStatsCache.set(userId, next);
    if (moved) persistNodeStats();
  }
  return {
    total: next.total + (unsettled?.total || 0),
    completed: next.completed + (unsettled?.completed || 0),
    error: next.error + (unsettled?.error || 0),
  };
}

class UserModel {
  /**
   * Node-execution totals for one user. Concurrent callers share one
   * computation. Not for correctness — each computation reads the cached
   * watermark and totals as one snapshot and writes back snapshot + delta, so
   * interleaving cannot double-count — but for cost: the boot prefetch and the
   * panels fire stats together, and on a cold cache each would otherwise run
   * its own full recount (1.1 GB on a real install).
   */
  static getNodeExecutionStats(userId) {
    const pending = nodeStatsInFlight.get(userId);
    if (pending) return pending;
    const computation = computeNodeStats(userId).finally(() => nodeStatsInFlight.delete(userId));
    nodeStatsInFlight.set(userId, computation);
    return computation;
  }

  /** Forget every cached count; the next call recounts. Call after deleting execution history. */
  static invalidateNodeStats() {
    nodeStatsGeneration += 1;
    nodeStatsCache.clear();
    return enqueueFileTask(() => fs.promises.rm(nodeStatsFile(), { force: true }));
  }

  /** Tests only: drop the in-memory cache as a process restart would, keeping the file. */
  static _forgetNodeStatsInMemoryForTests() {
    nodeStatsGeneration += 1;
    nodeStatsCache.clear();
    return nodeStatsFileQueue;
  }

  static async getUserStats(userId) {
    const [row, nodes] = await Promise.all([UserModel.getUserSummaryCounts(userId), UserModel.getNodeExecutionStats(userId)]);
    row.totalNodeExecutions = nodes.total;
    row.successfulNodeExecutions = nodes.completed;
    row.failedNodeExecutions = nodes.error;
    row.workflowStatuses = {
      complete: row.successfulExecutions,
      error: row.failedExecutions,
      started: row.startedExecutions,
    };
    return row;
  }

  static getUserSummaryCounts(userId) {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT
          w.totalWorkflows,
          t.totalCustomTools,
          a.totalAgents,
          COALESCE(we.totalExecutions, 0) as totalExecutions,
          COALESCE(we.successfulExecutions, 0) as successfulExecutions,
          COALESCE(we.failedExecutions, 0) as failedExecutions,
          COALESCE(we.startedExecutions, 0) as startedExecutions
        FROM
          (SELECT COUNT(*) as totalWorkflows FROM workflows WHERE user_id = ?) w,
          (SELECT COUNT(*) as totalCustomTools FROM tools WHERE created_by = ?) t,
          (SELECT COUNT(*) as totalAgents FROM agents WHERE created_by = ? AND id != 'orchestrator') a,
          (SELECT
            COUNT(*) as totalExecutions,
            SUM(status = 'completed') as successfulExecutions,
            SUM(status = 'error') as failedExecutions,
            SUM(status = 'started') as startedExecutions
          FROM workflow_executions WHERE user_id = ?) we
        `,
        [userId, userId, userId, userId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });
  }

  static async getUserSettings(userId) {
    const columnDefault = await columnDefaultAi();
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT default_provider as selectedProvider, default_model as selectedModel, custom_instructions as customInstructions, async_tools_enabled as asyncToolsEnabled, tool_output_cap as toolOutputCap, max_tool_rounds as maxToolRounds, fallback_providers as fallbackProviders, fallback_enabled as fallbackEnabled, subscription_costs as subscriptionCosts, routing_mode as routingMode, routing_policy as routingPolicy
         FROM users WHERE id = ?`,
        [userId],
        (err, row) => {
          if (err) {
            reject(err);
          } else if (row) {
            // No substitution: a missing default is reported as missing, so the
            // orchestrator falls through to the user's own fallback chain rather
            // than to a vendor this account may not have.
            const storedDefault = readStoredDefaultAi(row.selectedProvider, row.selectedModel, columnDefault);
            resolve({
              selectedProvider: storedDefault.provider,
              selectedModel: storedDefault.model,
              customInstructions: row.customInstructions || '',
              // Stored as INTEGER (0/1) in SQLite. Coerce to boolean for the
              // API layer. NULL (legacy rows that pre-date the column) is
              // treated as the documented default — false (off) — since
              // async tool execution is an experimental opt-in capability.
              asyncToolsEnabled: row.asyncToolsEnabled === null || row.asyncToolsEnabled === undefined
                ? false
                : Boolean(row.asyncToolsEnabled),
              // Legacy rows that pre-date the column come back as null —
              // fall back to the documented default (100k chars).
              toolOutputCap: Number.isFinite(row.toolOutputCap) ? row.toolOutputCap : 100000,
              // Legacy rows return null — fall back to the documented default (100).
              maxToolRounds: Number.isFinite(row.maxToolRounds) ? row.maxToolRounds : 100,
              // Cross-provider failover chain. Stored as a JSON array of
              // { provider, model } tiers (TEXT). Legacy/NULL rows → [].
              // Malformed JSON is tolerated and treated as no fallbacks.
              fallbackProviders: parseFallbackChain(row.fallbackProviders),
              // Stored as INTEGER (0/1). NULL (legacy) → false (feature off).
              fallbackEnabled: row.fallbackEnabled === null || row.fallbackEnabled === undefined
                ? false
                : Boolean(row.fallbackEnabled),
              // Optional: what each flat-rate seat costs per month. {} means
              // the user has not said, which is a normal state — every seat
              // figure still renders, just without a cost comparison.
              subscriptionCosts: parseSubscriptionCosts(row.subscriptionCosts),
              // Dynamic routing. Legacy/NULL rows → 'static', i.e. exactly
              // today's behaviour — the feature is opt-in and its OFF state is
              // byte-identical to not having it.
              routingMode: normalizeGlobalRoutingMode(row.routingMode),
              routingPolicy: parseRoutingPolicy(row.routingPolicy).mode,
            });
          } else {
            // User not found: no default provider, documented defaults elsewhere.
            resolve({
              selectedProvider: null,
              selectedModel: null,
              customInstructions: '',
              asyncToolsEnabled: false,
              toolOutputCap: 100000,
              maxToolRounds: 100,
              fallbackProviders: [],
              fallbackEnabled: false,
              subscriptionCosts: {},
              routingMode: 'static',
              routingPolicy: 'balanced',
            });
          }
        }
      );
    });
  }

  static updateUserSettings(userId, settings) {
    // Legacy stamps are cleared first, so a model-only write can never be
    // paired with a provider nobody chose.
    return columnDefaultAi().then(() => new Promise((resolve, reject) => {
      const { selectedProvider, selectedModel, customInstructions, asyncToolsEnabled, toolOutputCap, maxToolRounds, fallbackProviders, fallbackEnabled, subscriptionCosts, routingMode, routingPolicy } = settings;

      const fields = [];
      const params = [];

      // A null/empty provider is NEVER a user intent: the product has no
      // "clear my default provider" action. It arrives when a client writes a
      // MODEL while its own provider state is still unhydrated — setModel and
      // ensureValidModel both send `state.selectedProvider` verbatim, and that
      // is null during the boot race and after any code path that clears the
      // selection.
      //
      // Honouring it nulled BOTH columns. getUserSettings then masks a NULL
      // provider as 'Anthropic' / 'claude-3-5-sonnet-20240620', so a WIPED row
      // is indistinguishable from a deliberate switch to Anthropic — which is
      // exactly the reported "my default keeps becoming Anthropic", and
      // exactly the pair a settings watcher captured on the flip.
      //
      // Fall through to the model-only branch instead, so the model still
      // lands and the provider the user chose survives.
      //
      // The mirror rule: a provider WITHOUT a model is refused outright. That
      // write is what a client sends when it switches provider before the
      // provider's models have loaded, and storing it left a default that
      // could not run (a provider with no model). Keeping the previous pair is
      // strictly better than storing half of a new one.
      const providerToWrite = nonEmpty(selectedProvider);
      const modelToWrite = nonEmpty(selectedModel);
      const changeSource = normalizeChangeSource(settings.changeSource);
      let defaultWrite = null;

      if (providerToWrite && modelToWrite) {
        fields.push('default_provider = ?');
        params.push(providerToWrite);
        fields.push('default_model = ?');
        params.push(modelToWrite);
        defaultWrite = { provider: providerToWrite, model: modelToWrite };
      } else if (providerToWrite) {
        console.warn(
          `[UserModel] Refused default provider '${providerToWrite}' without a model (source: ${changeSource}); keeping the stored default.`
        );
      } else if (modelToWrite) {
        fields.push('default_model = ?');
        params.push(modelToWrite);
        defaultWrite = { provider: undefined, model: modelToWrite };
      }

      if (customInstructions !== undefined) {
        fields.push('custom_instructions = ?');
        params.push(customInstructions ? String(customInstructions).trim() : null);
      }

      if (asyncToolsEnabled !== undefined) {
        fields.push('async_tools_enabled = ?');
        params.push(asyncToolsEnabled ? 1 : 0);
      }

      if (toolOutputCap !== undefined) {
        fields.push('tool_output_cap = ?');
        params.push(toolOutputCap);
      }

      if (maxToolRounds !== undefined) {
        fields.push('max_tool_rounds = ?');
        params.push(maxToolRounds);
      }

      if (fallbackProviders !== undefined) {
        // Persist as a JSON string; accept either an array or a pre-stringified
        // value. Invalid input collapses to an empty array so we never write junk.
        fields.push('fallback_providers = ?');
        params.push(serializeFallbackChain(fallbackProviders));
      }

      if (fallbackEnabled !== undefined) {
        fields.push('fallback_enabled = ?');
        params.push(fallbackEnabled ? 1 : 0);
      }

      if (routingMode !== undefined) {
        // Normalised on the way in so an unrecognised value can never turn the
        // router on by accident — anything unknown means 'static'.
        fields.push('routing_mode = ?');
        params.push(normalizeGlobalRoutingMode(routingMode));
      }

      if (routingPolicy !== undefined) {
        fields.push('routing_policy = ?');
        params.push(serializeRoutingPolicy(routingPolicy));
      }

      if (subscriptionCosts !== undefined) {
        fields.push('subscription_costs = ?');
        params.push(serializeSubscriptionCosts(subscriptionCosts));
      }

      if (fields.length === 0) {
        return resolve({ changes: 0 });
      }

      fields.push('updated_at = CURRENT_TIMESTAMP');
      params.push(userId);

      const query = `UPDATE users SET ${fields.join(', ')} WHERE id = ?`;

      // Read the previous pair only when the default is being written, so the
      // change log can say what it changed FROM. Diagnostic only: a concurrent
      // writer between this read and the UPDATE can make one log row's
      // "previous" stale, never the stored setting.
      const previousDefault = defaultWrite
        ? dbGetRow('SELECT default_provider AS provider, default_model AS model FROM users WHERE id = ?', [userId]).catch(() => null)
        : Promise.resolve(null);

      previousDefault.then((previousRow) => db.run(query, params,
        function (err) {
          if (err) {
            reject(err);
          } else if (this.changes === 0) {
            // User doesn't exist, create with settings. No default AI is
            // invented here: the columns are named explicitly so a legacy
            // column default (see columnDefaultAi) never applies.
            db.run(
              `INSERT INTO users (id, default_provider, default_model, custom_instructions, async_tools_enabled, tool_output_cap, max_tool_rounds, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
              [
                userId,
                defaultWrite?.provider || null,
                defaultWrite?.provider ? defaultWrite.model : null,
                customInstructions ? String(customInstructions).trim() : null,
                // New rows default to async OFF (experimental opt-in).
                asyncToolsEnabled === undefined ? 0 : (asyncToolsEnabled ? 1 : 0),
                toolOutputCap === undefined ? 100000 : toolOutputCap,
                maxToolRounds === undefined ? 100 : maxToolRounds,
              ],
              function (insertErr) {
                if (insertErr) {
                  reject(insertErr);
                } else {
                  resolve({ changes: this.changes, created: true });
                }
              }
            );
          } else {
            const result = { changes: this.changes, updated: true };
            if (!defaultWrite || !previousRow) return resolve(result);
            const previous = { provider: previousRow.provider ?? null, model: previousRow.model ?? null };
            const next = {
              provider: defaultWrite.provider === undefined ? previous.provider : defaultWrite.provider,
              model: defaultWrite.model,
            };
            recordDefaultAiChange(userId, previous, next, changeSource).then(() => resolve(result));
          }
        }
      ));
    }));
  }

  /** Most recent changes to the account default AI, newest first. */
  static getDefaultAiHistory(userId, limit = 50) {
    const boundedLimit = Math.max(1, Math.min(DEFAULT_AI_HISTORY_LIMIT, Number.parseInt(limit, 10) || 50));
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT previous_provider AS previousProvider, previous_model AS previousModel, provider, model, source, created_at AS createdAt
         FROM default_ai_changes WHERE user_id = ? ORDER BY id DESC LIMIT ?`,
        [userId, boundedLimit],
        (err, rows) => (err ? reject(err) : resolve(rows || []))
      );
    });
  }

  /**
   * Read a user's stored UI preferences.
   *
   * Returns the parsed structure (never null). A user row that does not exist
   * and a user with nothing stored are the same answer — empty preferences —
   * because a preferences GET has no business 404ing a browser that is simply
   * booting for the first time.
   */
  static getPreferences(userId) {
    return new Promise((resolve, reject) => {
      db.get(`SELECT preferences FROM users WHERE id = ?`, [userId], (err, row) => {
        if (err) reject(err);
        else resolve(parsePreferences(row ? row.preferences : null));
      });
    });
  }

  /**
   * Merge a patch into a user's stored preferences.
   *
   * @returns { preferences, result } — `result` reports which keys were
   *   applied, deleted or rejected, so the caller can hand that back to the
   *   client instead of a bare 200 that hides a dropped key.
   */
  static updatePreferences(userId, patch) {
    return withPreferenceLock(userId, async () => {
      const stored = await UserModel.getPreferences(userId);
      const { next, result } = mergePreferences(stored, patch);
      const serialized = serializePreferences(next);

      const changes = await new Promise((resolve, reject) => {
        db.run(
          `UPDATE users SET preferences = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [serialized, userId],
          function (err) {
            if (err) reject(err);
            else resolve(this.changes);
          },
        );
      });

      // No row updated means no such user. Surfaced explicitly rather than
      // reported as a silent success — a write that stored nothing must not
      // look identical to one that stored everything.
      if (changes === 0) {
        const err = new Error('User not found');
        err.code = 'USER_NOT_FOUND';
        throw err;
      }

      return { preferences: next, result };
    });
  }
}

export default UserModel;
