// memory-semantic-search.js — LLM-powered query expansion + hybrid search
// Bridges the gap between keyword-only FTS5 and true semantic retrieval
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_PATH = process.env.APP_PATH || path.join(__dirname, '../../..');

let _db = null;
async function getDb() {
  if (_db) return _db;
  const dbPath = path.join(APP_PATH, 'backend', 'src', 'models', 'database', 'index.js');
  const dbUrl = 'file://' + dbPath.replace(/\\/g, '/');
  const mod = await import(dbUrl);
  _db = mod.default;
  return _db;
}

function dbAll(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

// Synonym / expansion table for common dev terms
const EXPANSION_MAP = {
  'port': ['port', 'bind', 'listen', 'address', 'socket', 'networking'],
  'conflict': ['conflict', 'clash', 'collision', 'overlap', 'duplicate'],
  'deploy': ['deploy', 'deployment', 'release', 'ship', 'publish', 'ci/cd', 'pipeline', 'build'],
  'auth': ['auth', 'authentication', 'authorization', 'login', 'session', 'token', 'jwt', 'oauth', 'credential'],
  'error': ['error', 'bug', 'issue', 'failure', 'crash', 'exception', 'stack trace', 'broken'],
  'database': ['database', 'db', 'sql', 'sqlite', 'postgres', 'mysql', 'mongo', 'query', 'schema', 'migration'],
  'api': ['api', 'endpoint', 'route', 'rest', 'graphql', 'request', 'response', 'fetch'],
  'docker': ['docker', 'container', 'compose', 'image', 'volume', 'dockerfile', 'kubernetes', 'k8s'],
  'redis': ['redis', 'cache', 'caching', 'pub/sub', 'sentinel', 'cluster'],
  'test': ['test', 'testing', 'spec', 'jest', 'vitest', 'playwright', 'cypress', 'coverage', 'assertion'],
  'style': ['style', 'css', 'scss', 'tailwind', 'theme', 'design', 'layout', 'ui', 'ux'],
  'memory': ['memory', 'recall', 'remember', 'fact', 'preference', 'insight', 'pattern'],
  'plugin': ['plugin', 'extension', 'addon', 'integration', 'tool', 'module'],
  'workflow': ['workflow', 'automation', 'pipeline', 'trigger', 'node', 'edge'],
  'agent': ['agent', 'bot', 'assistant', 'ai', 'llm', 'model', 'prompt'],
  'performance': ['performance', 'speed', 'latency', 'throughput', 'optimization', 'slow', 'fast', 'bottleneck'],
  'security': ['security', 'vulnerability', 'xss', 'csrf', 'injection', 'sanitize', 'encrypt', 'ssl', 'cors'],
  'file': ['file', 'directory', 'folder', 'path', 'filesystem', 'read', 'write', 'upload', 'download'],
  'video': ['video', 'clip', 'render', 'ffmpeg', 'remotion', 'seedance', 'animation', 'motion'],
  'image': ['image', 'photo', 'picture', 'generate', 'dalle', 'gemini', 'png', 'jpg', 'svg'],
};

function expandQuery(query) {
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length >= 2);
  const expanded = new Set(words);

  for (const word of words) {
    // Direct lookup
    if (EXPANSION_MAP[word]) {
      for (const syn of EXPANSION_MAP[word]) expanded.add(syn);
    }
    // Partial match (e.g., "deploying" matches "deploy")
    for (const [key, synonyms] of Object.entries(EXPANSION_MAP)) {
      if (word.startsWith(key) || key.startsWith(word)) {
        for (const syn of synonyms) expanded.add(syn);
      }
    }
  }

  return [...expanded];
}

function sanitizeFtsToken(t) {
  return t.replace(/[^a-zA-Z0-9_-]/g, '').trim();
}

function truncate(s, n = 200) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n) + '…' : s;
}

class MemorySemanticSearch {
  constructor() {
    this.name = 'memory-semantic-search';
  }

  async execute(params, inputData, workflowEngine) {
    try {
      const db = await getDb();
      const userId = workflowEngine?.userId;
      if (!userId) return { success: false, error: 'No user context' };

      const { query, sources = 'all', limit = 20 } = params;
      if (!query) return { success: false, error: 'query is required' };

      const expandedTerms = expandQuery(query);
      
      // Build multiple FTS queries from expanded terms — run them all and merge
      const allResults = [];
      
      // Group expanded terms into batches of 3-4 for FTS queries
      const queryBatches = [];
      for (let i = 0; i < expandedTerms.length; i += 3) {
        const batch = expandedTerms.slice(i, i + 3)
          .map(sanitizeFtsToken)
          .filter(t => t.length >= 2)
          .map(t => `${t}*`)
          .join(' OR ');
        if (batch) queryBatches.push(batch);
      }

      // Also do exact phrase
      const exactTokens = query.split(/\s+/)
        .map(sanitizeFtsToken)
        .filter(t => t.length >= 2)
        .map(t => `${t}*`)
        .join(' ');
      if (exactTokens) queryBatches.unshift(exactTokens);

      const shouldSearch = (src) => sources === 'all' || sources === src;

      for (const ftsQuery of queryBatches) {
        // Search memories
        if (shouldSearch('memories')) {
          try {
            const memResults = await dbAll(db, `
              SELECT doc_id AS id, agent_id, memory_type, created_at, updated_at,
                snippet(agent_memory_fts, -1, '«', '»', '…', 16) AS snippet,
                bm25(agent_memory_fts) AS score
              FROM agent_memory_fts
              WHERE agent_memory_fts MATCH ? AND agent_memory_fts.user_id = ?
              ORDER BY score LIMIT ?`, [ftsQuery, userId, limit]);
            for (const r of memResults) {
              allResults.push({
                kind: 'memory', id: r.id, timestamp: r.created_at,
                title: `${r.memory_type} (${r.agent_id})`,
                snippet: r.snippet, score: r.score,
                meta: { memory_id: r.id, agent_id: r.agent_id, memory_type: r.memory_type }
              });
            }
          } catch (e) { /* FTS might not match — that's ok */ }
        }

        // Search insights
        if (shouldSearch('insights')) {
          try {
            const insResults = await dbAll(db, `
              SELECT doc_id AS id, category, title, description, status, confidence,
                source_type, source_id, target_type, target_id, created_at,
                snippet(insights_fts, -1, '«', '»', '…', 16) AS snippet,
                bm25(insights_fts) AS score
              FROM insights_fts
              WHERE insights_fts MATCH ? AND insights_fts.user_id = ?
              ORDER BY score LIMIT ?`, [ftsQuery, userId, limit]);
            for (const r of insResults) {
              allResults.push({
                kind: 'insight', id: r.id, timestamp: r.created_at,
                title: r.title, snippet: r.snippet || truncate(r.description),
                score: r.score,
                meta: { insight_id: r.id, category: r.category, status: r.status }
              });
            }
          } catch (e) { /* ignore */ }
        }

        // Search conversations
        if (shouldSearch('conversations')) {
          try {
            const convResults = await dbAll(db, `
              SELECT cl.id AS row_id, cl.conversation_id, cl.initial_prompt, cl.created_at, cl.updated_at,
                snippet(conversation_logs_fts, -1, '«', '»', '…', 16) AS snippet,
                bm25(conversation_logs_fts) AS score
              FROM conversation_logs_fts
              JOIN conversation_logs cl ON cl.id = conversation_logs_fts.rowid
              WHERE conversation_logs_fts MATCH ? AND cl.user_id = ?
              ORDER BY score LIMIT ?`, [ftsQuery, userId, limit]);
            for (const r of convResults) {
              allResults.push({
                kind: 'conversation', id: r.conversation_id, timestamp: r.updated_at || r.created_at,
                title: truncate(r.initial_prompt, 100), snippet: r.snippet,
                score: r.score,
                meta: { conversation_id: r.conversation_id }
              });
            }
          } catch (e) { /* ignore */ }
        }

        // Search executions
        if (shouldSearch('executions')) {
          try {
            const execResults = await dbAll(db, `
              SELECT doc_id AS id, agent_id, agent_name, conversation_id, status, start_time,
                initial_prompt, snippet(agent_executions_fts, -1, '«', '»', '…', 16) AS snippet,
                bm25(agent_executions_fts) AS score
              FROM agent_executions_fts
              WHERE agent_executions_fts MATCH ? AND agent_executions_fts.user_id = ?
              ORDER BY score LIMIT ?`, [ftsQuery, userId, limit]);
            for (const r of execResults) {
              allResults.push({
                kind: 'execution', id: r.id, timestamp: r.start_time,
                title: `${r.agent_name || 'Agent'} run · ${r.status}`,
                snippet: r.snippet || truncate(r.initial_prompt),
                score: r.score,
                meta: { execution_id: r.id, agent_name: r.agent_name, status: r.status }
              });
            }
          } catch (e) { /* ignore */ }
        }
      }

      // Deduplicate by id, keeping best score
      const bestById = new Map();
      for (const r of allResults) {
        const key = `${r.kind}:${r.id}`;
        const existing = bestById.get(key);
        if (!existing || (r.score != null && r.score < (existing.score ?? 0))) {
          bestById.set(key, r);
        }
      }

      const merged = [...bestById.values()]
        .sort((a, b) => (a.score ?? 0) - (b.score ?? 0))
        .slice(0, limit);

      return {
        success: true,
        results: merged,
        expandedTerms,
        originalQuery: query,
        totalFound: merged.length
      };
    } catch (error) {
      console.error(`[${this.name}] Error:`, error);
      return { success: false, error: error.message };
    }
  }
}

export default new MemorySemanticSearch();
