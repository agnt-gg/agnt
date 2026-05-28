import db from '../models/database/index.js';

/**
 * MemorySearchService — hybrid full-text search across AGNT's history
 * tables (conversations, executions, outputs, insights, memory, workflow
 * versions). Powers the /api/memory/* endpoints and the orchestrator
 * `recall` / `list_recent` / `get_trace` tools.
 */

const dbAll = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });

const dbGet = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row || null);
    });
  });

/**
 * Sanitize a user-provided query for FTS5. Strips everything that isn't
 * alphanumeric, hyphen, or underscore, then prefix-matches each surviving
 * token (implicit AND). Empty result = caller should fall back to the
 * date-only path.
 */
function sanitizeFtsQuery(q) {
  if (!q || typeof q !== 'string') return '';
  const tokens = q
    .split(/\s+/)
    .map((t) => t.replace(/[^a-zA-Z0-9_-]/g, '').trim())
    .filter((t) => t.length >= 2);
  if (tokens.length === 0) return '';
  return tokens.map((t) => `${t}*`).join(' ');
}

function truncate(s, n = 200) {
  if (!s) return '';
  const str = typeof s === 'string' ? s : String(s);
  return str.length > n ? str.slice(0, n) + '…' : str;
}

const ALL_SOURCES = ['conversations', 'executions', 'outputs', 'insights', 'memory', 'versions'];

// ---------- per-source search queries (FTS5 path) ----------

async function searchConversations({ ftsQuery, since, until, userId, limit }) {
  const where = ['conversation_logs_fts MATCH ?', 'cl.user_id = ?'];
  const params = [ftsQuery, userId];
  if (since) { where.push('cl.updated_at >= ?'); params.push(since); }
  if (until) { where.push('cl.updated_at <= ?'); params.push(until); }
  params.push(limit);
  const sql = `
    SELECT
      cl.id AS row_id,
      cl.conversation_id,
      cl.initial_prompt,
      cl.final_response,
      cl.created_at,
      cl.updated_at,
      snippet(conversation_logs_fts, -1, '«', '»', '…', 16) AS snippet,
      bm25(conversation_logs_fts) AS score
    FROM conversation_logs_fts
    JOIN conversation_logs cl ON cl.id = conversation_logs_fts.rowid
    WHERE ${where.join(' AND ')}
    ORDER BY score LIMIT ?`;
  const rows = await dbAll(sql, params);
  return rows.map((r) => ({
    kind: 'conversation',
    id: r.conversation_id,
    timestamp: r.updated_at || r.created_at,
    title: truncate(r.initial_prompt, 100),
    snippet: r.snippet,
    score: r.score,
    meta: { conversation_id: r.conversation_id, row_id: r.row_id },
  }));
}

async function searchExecutions({ ftsQuery, since, until, userId, limit }) {
  const where = ['agent_executions_fts MATCH ?', 'agent_executions_fts.user_id = ?'];
  const params = [ftsQuery, userId];
  if (since) { where.push('agent_executions_fts.start_time >= ?'); params.push(since); }
  if (until) { where.push('agent_executions_fts.start_time <= ?'); params.push(until); }
  params.push(limit);
  const sql = `
    SELECT
      doc_id AS id,
      agent_id,
      conversation_id,
      agent_name,
      initial_prompt,
      final_response,
      status,
      start_time,
      end_time,
      provider,
      model,
      snippet(agent_executions_fts, -1, '«', '»', '…', 16) AS snippet,
      bm25(agent_executions_fts) AS score
    FROM agent_executions_fts
    WHERE ${where.join(' AND ')}
    ORDER BY score LIMIT ?`;
  const rows = await dbAll(sql, params);
  return rows.map((r) => ({
    kind: 'execution',
    id: r.id,
    timestamp: r.start_time,
    title: `${r.agent_name || 'Agent'} run · ${r.status}`,
    snippet: r.snippet || truncate(r.initial_prompt, 200),
    score: r.score,
    meta: {
      execution_id: r.id,
      conversation_id: r.conversation_id,
      agent_id: r.agent_id,
      agent_name: r.agent_name,
      status: r.status,
      provider: r.provider,
      model: r.model,
      end_time: r.end_time,
    },
  }));
}

async function searchOutputs({ ftsQuery, since, until, userId, limit }) {
  const where = ['content_outputs_fts MATCH ?', 'content_outputs_fts.user_id = ?'];
  const params = [ftsQuery, userId];
  if (since) { where.push('content_outputs_fts.updated_at >= ?'); params.push(since); }
  if (until) { where.push('content_outputs_fts.updated_at <= ?'); params.push(until); }
  params.push(limit);
  const sql = `
    SELECT
      doc_id AS id,
      title,
      content_type,
      workflow_id,
      conversation_id,
      created_at,
      updated_at,
      snippet(content_outputs_fts, -1, '«', '»', '…', 16) AS snippet,
      bm25(content_outputs_fts) AS score
    FROM content_outputs_fts
    WHERE ${where.join(' AND ')}
    ORDER BY score LIMIT ?`;
  const rows = await dbAll(sql, params);
  return rows.map((r) => ({
    kind: 'output',
    id: r.id,
    timestamp: r.updated_at || r.created_at,
    title: r.title || `(${r.content_type || 'output'})`,
    snippet: r.snippet,
    score: r.score,
    meta: {
      output_id: r.id,
      content_type: r.content_type,
      workflow_id: r.workflow_id,
      conversation_id: r.conversation_id,
    },
  }));
}

async function searchInsights({ ftsQuery, since, until, userId, limit }) {
  const where = ['insights_fts MATCH ?', 'insights_fts.user_id = ?'];
  const params = [ftsQuery, userId];
  if (since) { where.push('insights_fts.created_at >= ?'); params.push(since); }
  if (until) { where.push('insights_fts.created_at <= ?'); params.push(until); }
  params.push(limit);
  const sql = `
    SELECT
      doc_id AS id,
      category,
      title,
      description,
      status,
      confidence,
      source_type,
      source_id,
      target_type,
      target_id,
      created_at,
      snippet(insights_fts, -1, '«', '»', '…', 16) AS snippet,
      bm25(insights_fts) AS score
    FROM insights_fts
    WHERE ${where.join(' AND ')}
    ORDER BY score LIMIT ?`;
  const rows = await dbAll(sql, params);
  return rows.map((r) => ({
    kind: 'insight',
    id: r.id,
    timestamp: r.created_at,
    title: r.title,
    snippet: r.snippet || truncate(r.description, 200),
    score: r.score,
    meta: {
      insight_id: r.id,
      category: r.category,
      status: r.status,
      confidence: r.confidence,
      source_type: r.source_type,
      source_id: r.source_id,
      target_type: r.target_type,
      target_id: r.target_id,
    },
  }));
}

async function searchMemory({ ftsQuery, since, until, userId, limit }) {
  const where = ['agent_memory_fts MATCH ?', 'agent_memory_fts.user_id = ?'];
  const params = [ftsQuery, userId];
  if (since) { where.push('agent_memory_fts.created_at >= ?'); params.push(since); }
  if (until) { where.push('agent_memory_fts.created_at <= ?'); params.push(until); }
  params.push(limit);
  const sql = `
    SELECT
      doc_id AS id,
      agent_id,
      memory_type,
      created_at,
      updated_at,
      snippet(agent_memory_fts, -1, '«', '»', '…', 16) AS snippet,
      bm25(agent_memory_fts) AS score
    FROM agent_memory_fts
    WHERE ${where.join(' AND ')}
    ORDER BY score LIMIT ?`;
  const rows = await dbAll(sql, params);
  return rows.map((r) => ({
    kind: 'memory',
    id: r.id,
    timestamp: r.created_at,
    title: `${r.memory_type} (${r.agent_id})`,
    snippet: r.snippet,
    score: r.score,
    meta: {
      memory_id: r.id,
      agent_id: r.agent_id,
      memory_type: r.memory_type,
    },
  }));
}

async function searchVersions({ ftsQuery, since, until, userId, limit }) {
  // workflow_versions has no user_id column; join via workflows to scope by user.
  const where = ['workflow_versions_fts MATCH ?', 'w.user_id = ?'];
  const params = [ftsQuery, userId];
  if (since) { where.push('wv.created_at >= ?'); params.push(since); }
  if (until) { where.push('wv.created_at <= ?'); params.push(until); }
  params.push(limit);
  const sql = `
    SELECT
      wv.id AS row_id,
      wv.workflow_id,
      wv.version_number,
      wv.change_type,
      wv.change_summary,
      wv.created_at,
      w.name AS workflow_name,
      snippet(workflow_versions_fts, -1, '«', '»', '…', 16) AS snippet,
      bm25(workflow_versions_fts) AS score
    FROM workflow_versions_fts
    JOIN workflow_versions wv ON wv.id = workflow_versions_fts.rowid
    JOIN workflows w ON w.id = wv.workflow_id
    WHERE ${where.join(' AND ')}
    ORDER BY score LIMIT ?`;
  const rows = await dbAll(sql, params);
  return rows.map((r) => ({
    kind: 'version',
    id: r.row_id,
    timestamp: r.created_at,
    title: `${r.workflow_name || r.workflow_id} v${r.version_number}`,
    snippet: r.snippet || truncate(r.change_summary, 200),
    score: r.score,
    meta: {
      workflow_id: r.workflow_id,
      version_number: r.version_number,
      change_type: r.change_type,
    },
  }));
}

// ---------- per-source recent (no keyword) ----------

async function recentConversations({ since, until, userId, limit }) {
  const where = ['user_id = ?'];
  const params = [userId];
  if (since) { where.push('updated_at >= ?'); params.push(since); }
  if (until) { where.push('updated_at <= ?'); params.push(until); }
  params.push(limit);
  const sql = `SELECT id AS row_id, conversation_id, initial_prompt, final_response, updated_at, created_at
    FROM conversation_logs
    WHERE ${where.join(' AND ')}
    ORDER BY updated_at DESC LIMIT ?`;
  const rows = await dbAll(sql, params);
  return rows.map((r) => ({
    kind: 'conversation',
    id: r.conversation_id,
    timestamp: r.updated_at || r.created_at,
    title: truncate(r.initial_prompt, 100),
    snippet: truncate(r.final_response, 200),
    meta: { conversation_id: r.conversation_id, row_id: r.row_id },
  }));
}

async function recentExecutions({ since, until, userId, limit }) {
  const where = ['user_id = ?'];
  const params = [userId];
  if (since) { where.push('start_time >= ?'); params.push(since); }
  if (until) { where.push('start_time <= ?'); params.push(until); }
  params.push(limit);
  const sql = `SELECT id, agent_id, agent_name, conversation_id, status, start_time, end_time, provider, model,
                 initial_prompt, final_response
    FROM agent_executions
    WHERE ${where.join(' AND ')}
    ORDER BY start_time DESC LIMIT ?`;
  const rows = await dbAll(sql, params);
  return rows.map((r) => ({
    kind: 'execution',
    id: r.id,
    timestamp: r.start_time,
    title: `${r.agent_name || 'Agent'} run · ${r.status}`,
    snippet: truncate(r.initial_prompt, 200),
    meta: {
      execution_id: r.id,
      conversation_id: r.conversation_id,
      agent_id: r.agent_id,
      agent_name: r.agent_name,
      status: r.status,
      provider: r.provider,
      model: r.model,
      end_time: r.end_time,
    },
  }));
}

async function recentOutputs({ since, until, userId, limit }) {
  const where = ['user_id = ?'];
  const params = [userId];
  if (since) { where.push('updated_at >= ?'); params.push(since); }
  if (until) { where.push('updated_at <= ?'); params.push(until); }
  params.push(limit);
  const sql = `SELECT id, title, content_type, workflow_id, conversation_id, created_at, updated_at,
                 substr(content, 1, 200) AS content_preview
    FROM content_outputs
    WHERE ${where.join(' AND ')}
    ORDER BY updated_at DESC LIMIT ?`;
  const rows = await dbAll(sql, params);
  return rows.map((r) => ({
    kind: 'output',
    id: r.id,
    timestamp: r.updated_at || r.created_at,
    title: r.title || `(${r.content_type || 'output'})`,
    snippet: truncate(r.content_preview, 200),
    meta: {
      output_id: r.id,
      content_type: r.content_type,
      workflow_id: r.workflow_id,
      conversation_id: r.conversation_id,
    },
  }));
}

async function recentInsights({ since, until, userId, limit }) {
  const where = ['user_id = ?'];
  const params = [userId];
  if (since) { where.push('created_at >= ?'); params.push(since); }
  if (until) { where.push('created_at <= ?'); params.push(until); }
  params.push(limit);
  const sql = `SELECT id, category, title, description, status, confidence,
                 source_type, source_id, target_type, target_id, created_at
    FROM insights
    WHERE ${where.join(' AND ')}
    ORDER BY created_at DESC LIMIT ?`;
  const rows = await dbAll(sql, params);
  return rows.map((r) => ({
    kind: 'insight',
    id: r.id,
    timestamp: r.created_at,
    title: r.title,
    snippet: truncate(r.description, 200),
    meta: {
      insight_id: r.id,
      category: r.category,
      status: r.status,
      confidence: r.confidence,
      source_type: r.source_type,
      source_id: r.source_id,
      target_type: r.target_type,
      target_id: r.target_id,
    },
  }));
}

async function recentMemory({ since, until, userId, limit }) {
  const where = ['user_id = ?'];
  const params = [userId];
  if (since) { where.push('created_at >= ?'); params.push(since); }
  if (until) { where.push('created_at <= ?'); params.push(until); }
  params.push(limit);
  const sql = `SELECT id, agent_id, memory_type, content, created_at, updated_at
    FROM agent_memory
    WHERE ${where.join(' AND ')}
    ORDER BY created_at DESC LIMIT ?`;
  const rows = await dbAll(sql, params);
  return rows.map((r) => ({
    kind: 'memory',
    id: r.id,
    timestamp: r.created_at,
    title: `${r.memory_type} (${r.agent_id})`,
    snippet: truncate(r.content, 200),
    meta: {
      memory_id: r.id,
      agent_id: r.agent_id,
      memory_type: r.memory_type,
    },
  }));
}

async function recentVersions({ since, until, userId, limit }) {
  const where = ['w.user_id = ?'];
  const params = [userId];
  if (since) { where.push('wv.created_at >= ?'); params.push(since); }
  if (until) { where.push('wv.created_at <= ?'); params.push(until); }
  params.push(limit);
  const sql = `SELECT wv.id AS row_id, wv.workflow_id, wv.version_number, wv.change_type, wv.change_summary, wv.created_at,
                 w.name AS workflow_name
    FROM workflow_versions wv
    JOIN workflows w ON w.id = wv.workflow_id
    WHERE ${where.join(' AND ')}
    ORDER BY wv.created_at DESC LIMIT ?`;
  const rows = await dbAll(sql, params);
  return rows.map((r) => ({
    kind: 'version',
    id: r.row_id,
    timestamp: r.created_at,
    title: `${r.workflow_name || r.workflow_id} v${r.version_number}`,
    snippet: truncate(r.change_summary, 200),
    meta: {
      workflow_id: r.workflow_id,
      version_number: r.version_number,
      change_type: r.change_type,
    },
  }));
}

const SEARCH_BY_KIND = {
  conversations: searchConversations,
  executions: searchExecutions,
  outputs: searchOutputs,
  insights: searchInsights,
  memory: searchMemory,
  versions: searchVersions,
};

const RECENT_BY_KIND = {
  conversations: recentConversations,
  executions: recentExecutions,
  outputs: recentOutputs,
  insights: recentInsights,
  memory: recentMemory,
  versions: recentVersions,
};

/**
 * Hybrid search across sources. If `q` is provided, FTS5 is used per source;
 * otherwise it falls back to time-ordered recent rows.
 *
 * Returned rows are normalized: { kind, id, timestamp, title, snippet, score?, meta }.
 * When `q` is provided, lower BM25 score = more relevant; the merged list is
 * sorted by score within each source then interleaved by relevance. When `q`
 * is absent, the merged list is sorted by timestamp DESC.
 */
async function search({ userId, q, since, until, sources, limit = 50 }) {
  if (!userId) throw new Error('search() requires userId');

  const requested = Array.isArray(sources) && sources.length > 0
    ? sources.filter((s) => ALL_SOURCES.includes(s))
    : ALL_SOURCES;

  const perSourceLimit = Math.max(5, Math.ceil(limit / requested.length) * 2);
  const ftsQuery = sanitizeFtsQuery(q);

  const tasks = requested.map(async (src) => {
    try {
      if (ftsQuery) {
        return await SEARCH_BY_KIND[src]({ ftsQuery, since, until, userId, limit: perSourceLimit });
      }
      return await RECENT_BY_KIND[src]({ since, until, userId, limit: perSourceLimit });
    } catch (err) {
      console.warn(`[MemorySearch] ${src} failed:`, err.message);
      return [];
    }
  });

  const grouped = await Promise.all(tasks);
  const merged = grouped.flat();

  if (ftsQuery) {
    merged.sort((a, b) => (a.score ?? 0) - (b.score ?? 0));
  } else {
    merged.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
  }

  return merged.slice(0, limit);
}

/**
 * Convenience wrapper for "what did you do last N days?" queries — no keyword
 * required.
 */
async function listRecent({ userId, days = 7, kind, limit = 100 }) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const sources = kind ? [kind] : ALL_SOURCES;
  return search({ userId, since, sources, limit });
}

/**
 * Fetch full detail for a single trace (agent_executions row + its tool calls).
 */
async function getTrace({ executionId, userId }) {
  const exec = await dbGet(
    `SELECT * FROM agent_executions WHERE id = ? AND user_id = ?`,
    [executionId, userId]
  );
  if (!exec) return null;
  const toolCalls = await dbAll(
    `SELECT id, tool_name, tool_call_id, start_time, end_time, status, input, output, error, credits_used
     FROM agent_tool_executions WHERE execution_id = ? ORDER BY start_time ASC`,
    [executionId]
  );
  // Parse JSON tool args/outputs lazily — leave as strings if parse fails.
  for (const tc of toolCalls) {
    try { if (tc.input) tc.input = JSON.parse(tc.input); } catch (_) { /* keep string */ }
    try { if (tc.output) tc.output = JSON.parse(tc.output); } catch (_) { /* keep string */ }
  }
  return { ...exec, toolExecutions: toolCalls };
}

export default { search, listRecent, getTrace, sanitizeFtsQuery, ALL_SOURCES };
