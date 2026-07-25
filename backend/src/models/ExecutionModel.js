import db, { dbRunWithRetry } from './database/index.js';
import generateUUID from '../utils/generateUUID.js';
import PayloadStore from '../services/storage/PayloadStore.js';

// --- Promisified db helpers (module-local) ---------------------------------
const dbAll = (query, params) =>
  new Promise((resolve, reject) => db.all(query, params, (err, rows) => (err ? reject(err) : resolve(rows || []))));
const dbGet = (query, params) =>
  new Promise((resolve, reject) => db.get(query, params, (err, row) => (err ? reject(err) : resolve(row))));
const dbRun = (query, params) =>
  new Promise((resolve, reject) =>
    db.run(query, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    })
  );

// 'YYYY-MM-DD' + n days -> 'YYYY-MM-DD', computed in the server's local
// timezone — the same clock SQLite's 'localtime' modifier uses, so day
// boundaries agree between JS and the SQL grouping.
const addDays = (ymd, n) => {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
};

const eachDay = (fromYmd, toYmd) => {
  const days = [];
  for (let d = fromYmd; d <= toYmd; d = addDays(d, 1)) days.push(d);
  return days;
};

// Bounded-concurrency map. Hydrating a node list can open one file per
// externalized payload; an unbounded Promise.all over a 1,000-node execution
// would try to open them all at once and can hit EMFILE. 16 is well under any
// platform's descriptor budget and still saturates NVMe queue depth.
const mapLimited = async (items, limit, fn) => {
  const out = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
};

class ExecutionModel {
  static create(workflowId, userId, workflowName) {
    const id = generateUUID();
    const startTime = new Date().toISOString();
    return new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO workflow_executions (id, workflow_id, user_id, workflow_name, status, start_time) VALUES (?, ?, ?, ?, ?, ?)',
        [id, workflowId, userId, workflowName, 'started', startTime],
        function (err) {
          if (err) reject(err);
          else resolve(id);
        }
      );
    });
  }
  static update(id, status, log, creditsUsed) {
    return new Promise((resolve, reject) => {
      const safeStatus = status || 'stopped';

      db.run(
        'UPDATE workflow_executions SET status = ?, log = ?, end_time = ?, credits_used = ? WHERE id = ?',
        [safeStatus, log, new Date().toISOString(), creditsUsed, id],
        function (err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }  static async createNodeExecution(executionId, nodeId, input) {
    const id = generateUUID();
    const startTime = new Date().toISOString();
    // PayloadStore.pack is a drop-in for JSON.stringify: identical bytes below
    // the 4 KiB threshold, an envelope + durable blob above it. Awaited BEFORE
    // the INSERT so the row can never reference a blob that isn't on disk.
    const packedInput = await PayloadStore.pack(input);
    return new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO node_executions (id, execution_id, node_id, status, input, start_time) VALUES (?, ?, ?, ?, ?, ?)',
        [id, executionId, nodeId, 'started', packedInput, startTime],
        function (err) {
          if (err) reject(err);
          else resolve(id);
        }
      );
    });
  }
  static async updateNodeExecution(executionId, nodeId, status, output, error, executionDuration, tokenUsage = null) {
    const endTime = new Date().toISOString();
    try {
      const nodeExecution = await this.getNodeExecution(executionId, nodeId);
      const durationInSeconds = executionDuration / 1000;
      const creditsUsed = executionDuration === 0 ? 0 : durationInSeconds; // 1 credit per 1 second, 0 if duration is 0

      // Extract token usage from output if available (e.g., from generate-with-ai-llm tool)
      const inputTokens = tokenUsage?.inputTokens || 0;
      const outputTokens = tokenUsage?.outputTokens || 0;

      // Blob durably written before the UPDATE commits. This is the write that
      // used to push 5 MB base64 payloads straight into the table (and, under
      // Litestream, straight into object storage).
      const packedOutput = await PayloadStore.pack(output);

      return new Promise((resolve, reject) => {
        db.run(
          'UPDATE node_executions SET status = ?, output = ?, error = ?, end_time = ?, credits_used = ?, input_tokens = ?, output_tokens = ? WHERE execution_id = ? AND node_id = ?',
          [status, packedOutput, error, endTime, creditsUsed, inputTokens, outputTokens, executionId, nodeId],
          function (err) {
            if (err) reject(err);
            else resolve(this.changes);
          }
        );
      });
    } catch (error) {
      console.error('Error updating node execution:', error);
      throw error;
    }
  }
  static getExecutions(userId, { startDate, endDate } = {}) {
    const dateFilter = startDate
      ? `AND we.start_time >= ? AND we.start_time <= ?`
      : `AND we.start_time >= datetime('now', '-7 days')`;
    const params = startDate ? [userId, startDate, endDate] : [userId];

    return new Promise((resolve, reject) => {
      db.all(
        `SELECT we.id, we.workflow_id, we.workflow_name, we.start_time, we.end_time, we.status, we.credits_used,
                (SELECT COUNT(*) FROM node_executions ne WHERE ne.execution_id = we.id) as node_count
         FROM workflow_executions we
         WHERE we.user_id = ? ${dateFilter}
         ORDER BY we.start_time DESC
         LIMIT 10000`,
        params,
        (err, rows) => {
          if (err) reject(err);
          else {
            const executions = rows.map((row) => ({
              id: row.id,
              workflowId: row.workflow_id,
              workflowName: row.workflow_name || 'Unknown Workflow',
              startTime: row.start_time,
              endTime: row.end_time,
              status: row.status,
              creditsUsed: row.credits_used || 0,
              nodeCount: row.node_count || 0,
            }));
            resolve(executions);
          }
        }
      );
    });
  }
  static getNodeExecution(executionId, nodeId) {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT ne.*, we.user_id 
         FROM node_executions ne
         JOIN workflow_executions we ON ne.execution_id = we.id
         WHERE ne.execution_id = ? AND ne.node_id = ?`,
        [executionId, nodeId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });
  }
  static async getExecutionDetails(executionId) {
    const execQuery = new Promise((resolve, reject) => {
      db.get(
        `SELECT we.id, we.workflow_id, we.workflow_name, we.start_time, we.end_time, we.status, we.log
         FROM workflow_executions we
         WHERE we.id = ?`,
        [executionId],
        (err, row) => err ? reject(err) : resolve(row)
      );
    });

    const nodesQuery = new Promise((resolve, reject) => {
      db.all(
        `SELECT id, node_id, start_time, end_time, status, input, output, error, credits_used,
                input_tokens, output_tokens
         FROM node_executions
         WHERE execution_id = ?
         ORDER BY start_time`,
        [executionId],
        (err, rows) => err ? reject(err) : resolve(rows || [])
      );
    });

    const [execution, nodeExecutions] = await Promise.all([execQuery, nodesQuery]);
    if (!execution) return null;    const totalCreditsUsed = nodeExecutions.reduce((sum, ne) => sum + (ne.credits_used || 0), 0);

    // Rehydrate payloads. Inline rows (86% in practice) resolve without any
    // I/O; externalized rows read one compressed blob each. unpack() falls
    // through to plain JSON.parse for every pre-existing row, which is what
    // makes this change zero-migration.
    const hydrated = await mapLimited(nodeExecutions, 16, async (ne) => ({
      ...ne,
      input: await PayloadStore.unpack(ne.input),
      output: await PayloadStore.unpack(ne.output),
    }));

    return {
      id: execution.id,
      workflowId: execution.workflow_id,
      workflowName: execution.workflow_name || 'Unknown Workflow',
      startTime: execution.start_time,
      endTime: execution.end_time,
      status: execution.status,
      log: execution.log,      creditsUsed: totalCreditsUsed,
      nodeExecutions: hydrated,
    };
  }  // Public entry point for POST /executions/activity.
  //
  // Serves finished days from the daily_usage_stats rollup (O(days) reads) and
  // computes only "today" live. Historical days are immutable, so each is
  // aggregated from the execution tables at most once, then cached forever.
  // Any rollup failure falls back to the original full-window aggregation —
  // slower, but never wrong.
  static async getAgentActivityData(userId, startDate, endDate) {
    try {
      return await ExecutionModel._getActivityViaRollup(userId, startDate, endDate);
    } catch (error) {
      console.error('[activity] rollup path failed, falling back to raw aggregation:', error);
      return ExecutionModel._computeActivityRaw(userId, startDate, endDate);
    }
  }

  static async _getActivityViaRollup(userId, startDate, endDate) {
    // Normalize to plain local-date strings (the frontend sends 'YYYY-MM-DD',
    // with endDate = tomorrow, i.e. the chart displays [startDate, endDate)).
    const reqStart = String(startDate).slice(0, 10);
    const reqEnd = String(endDate).slice(0, 10);
    // Use SQLite's clock for "today" so the boundary matches the
    // DATE(..., 'localtime') grouping in the raw query.
    const { today } = await dbGet(`SELECT DATE('now', 'localtime') AS today`, []);
    const yesterday = addDays(today, -1);

    // --- 1. Finished days, served from the rollup ---------------------------
    const lastRequested = addDays(reqEnd, -1);
    const rollEnd = lastRequested < yesterday ? lastRequested : yesterday;
    const rowsByDate = new Map();
    if (reqStart <= rollEnd) {
      // Yesterday gets a 1-hour freshness window: a workflow that was still
      // running when yesterday's rollup was computed may have finished (and
      // written credits) since. Treating a stale yesterday-row as missing
      // forces one cheap single-day recompute; older days stay cached forever.
      const cached = await dbAll(
        `SELECT date, credits_used, total_tokens, estimated_cost
         FROM daily_usage_stats
         WHERE user_id = ? AND date >= ? AND date <= ?
           AND NOT (date = ? AND computed_at < datetime('now', '-1 hour'))`,
        [userId, reqStart, rollEnd, yesterday]
      );
      for (const r of cached) rowsByDate.set(r.date, r);
      const missing = eachDay(reqStart, rollEnd).filter((d) => !rowsByDate.has(d));

      if (missing.length > 0) {
        // Compute the missing span in one raw query, padded by a day on each
        // side: start_time is stored in UTC but days are grouped in localtime,
        // so executions belonging to the edge days can carry UTC timestamps
        // outside the local-date range. Padding + keeping only the missing
        // days guarantees every persisted day is complete in any timezone.
        const spanStart = missing[0];
        const spanEnd = missing[missing.length - 1];
        const raw = await ExecutionModel._computeActivityRaw(userId, addDays(spanStart, -1), addDays(spanEnd, 2));
        const rawByDate = new Map(raw.map((r) => [r.date, r]));

        for (const day of missing) {
          const row = rawByDate.get(day) || { credits_used: 0, total_tokens: 0, estimated_cost: 0 };
          // Persist zero-rows too — "no activity" must be cacheable, or empty
          // days would be recomputed on every request. Only finished days are
          // ever persisted (rollEnd <= yesterday), never today.
          // Retry on SQLITE_BUSY: the workflow process writes concurrently, and
          // one transient lock collision shouldn't abort the whole backfill into
          // the slow raw-query fallback path.
          await dbRunWithRetry(() => dbRun(
            `INSERT INTO daily_usage_stats (user_id, date, credits_used, total_tokens, estimated_cost, computed_at)
             VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(user_id, date) DO UPDATE SET
               credits_used = excluded.credits_used,
               total_tokens = excluded.total_tokens,
               estimated_cost = excluded.estimated_cost,
               computed_at = CURRENT_TIMESTAMP`,
            [userId, day, row.credits_used || 0, row.total_tokens || 0, row.estimated_cost || 0]
          ));
          rowsByDate.set(day, {
            date: day,
            credits_used: row.credits_used || 0,
            total_tokens: row.total_tokens || 0,
            estimated_cost: row.estimated_cost || 0,
          });
        }
      }
    }

    // --- 2. Today (still mutating) is always computed live, never cached ----
    let todayRows = [];
    if (lastRequested >= today) {
      const rawToday = await ExecutionModel._computeActivityRaw(userId, yesterday, reqEnd);
      todayRows = rawToday.filter((r) => r.date >= today);
    }

    // Match the raw query's response shape: only days with activity, ascending
    // by date. (The frontend zero-fills the window itself via fillMissingDates,
    // and clips anything outside [startDate, endDate) — so dropping the raw
    // query's partial out-of-window edge rows changes nothing it displays.)
    return [...rowsByDate.values(), ...todayRows]
      .filter((r) => r.credits_used || r.total_tokens || r.estimated_cost)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }

  static _computeActivityRaw(userId, startDate, endDate) {
    return new Promise((resolve, reject) => {
      // The dashboard's Cumulative Credits chart calls this on every mount.
      // Output is one row per date (small response), but the work to compute
      // it scales with execution history. Two things that matter here:
      //
      // 1. Pre-aggregate node_executions ONCE via a derived LEFT JOIN
      //    instead of running a correlated SUM subquery per workflow row
      //    (was O(N*M); now O(N+M)).
      //
      // 2. Scope the inner node_executions aggregate to the SAME date+user
      //    window as the outer query. Without the inner WHERE the planner
      //    happily sums every node_execution row ever, across all users,
      //    just to throw most of it away — that's the "huge" cost on
      //    365-day windows even though the response is tiny.
      //
      // idx_node_executions_execution_id covers the join + inner group by.
      const query = `
        SELECT
          date,
          SUM(credits_used) as credits_used,
          SUM(total_tokens) as total_tokens,
          SUM(estimated_cost) as estimated_cost
        FROM (
          SELECT
            DATE(we.start_time, 'localtime') as date,
            SUM(we.credits_used) as credits_used,
            COALESCE(SUM(ne_sum.tokens), 0) as total_tokens,
            0 as estimated_cost
          FROM workflow_executions we
          LEFT JOIN (
            SELECT ne.execution_id,
                   SUM(ne.input_tokens + ne.output_tokens) as tokens
            FROM node_executions ne
            INNER JOIN workflow_executions we2 ON we2.id = ne.execution_id
            WHERE we2.user_id = ? AND we2.start_time BETWEEN ? AND ?
            GROUP BY ne.execution_id
          ) ne_sum ON ne_sum.execution_id = we.id
          WHERE we.user_id = ? AND we.start_time BETWEEN ? AND ?
          GROUP BY DATE(we.start_time, 'localtime')
          UNION ALL
          SELECT
            DATE(start_time, 'localtime') as date,
            SUM(credits_used) as credits_used,
            COALESCE(SUM(total_tokens), 0) as total_tokens,
            COALESCE(SUM(estimated_cost), 0) as estimated_cost
          FROM agent_executions
          WHERE user_id = ? AND start_time BETWEEN ? AND ?
          GROUP BY DATE(start_time, 'localtime')
        )
        GROUP BY date
        ORDER BY date
      `;

      db.all(
        query,
        [userId, startDate, endDate, userId, startDate, endDate, userId, startDate, endDate],
        (err, rows) => {
          if (err) {
            console.error('Database error:', err);
            reject(err);
          } else {
            resolve(rows);
          }
        }
      );
    });
  }
  static async getTotalCreditsUsed(executionId) {
    return new Promise((resolve, reject) => {
      db.get('SELECT SUM(credits_used) as total_credits FROM node_executions WHERE execution_id = ?', [executionId], (err, row) => {
        if (err) reject(err);
        else resolve(row.total_credits || 0);
      });
    });
  }
}

export default ExecutionModel;
