// memory-toolkit-api.js — Unified API for the Memory Toolkit widget
// Aggregates data from memory, insights, graph, and dream systems
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

function dbGet(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row || null);
    });
  });
}

class MemoryToolkitApi {
  constructor() {
    this.name = 'memory-toolkit-api';
  }

  async execute(params, inputData, workflowEngine) {
    try {
      const db = await getDb();
      const userId = workflowEngine?.userId;
      if (!userId) return { success: false, error: 'No user context' };

      switch (params.action) {
        case 'DASHBOARD_STATS': return await this.dashboardStats(db, userId);
        case 'GRAPH_DATA': return await this.graphData(db, userId, params);
        case 'SEARCH': return await this.search(db, userId, params);
        case 'ENTITY_DETAIL': return await this.entityDetail(db, userId, params);
        case 'DREAM_REPORT': return await this.dreamReport(db, userId);
        case 'RECENT_ACTIVITY': return await this.recentActivity(db, userId, params);
        default: return { success: false, error: `Unknown action: ${params.action}` };
      }
    } catch (error) {
      console.error(`[${this.name}] Error:`, error);
      return { success: false, error: error.message };
    }
  }

  async dashboardStats(db, userId) {
    // Core memory stats
    const memoryCount = await dbGet(db, 'SELECT COUNT(*) as count FROM agent_memory WHERE user_id = ?', [userId]);
    const memoryTypes = await dbAll(db, 'SELECT memory_type, COUNT(*) as count FROM agent_memory WHERE user_id = ? GROUP BY memory_type ORDER BY count DESC', [userId]);
    const avgAccess = await dbGet(db, 'SELECT AVG(access_count) as avg, MAX(access_count) as max FROM agent_memory WHERE user_id = ?', [userId]);
    
    // Insight stats
    const insightTotal = await dbGet(db, 'SELECT COUNT(*) as count FROM insights WHERE user_id = ?', [userId]);
    const insightStatus = await dbAll(db, 'SELECT status, COUNT(*) as count FROM insights WHERE user_id = ? GROUP BY status', [userId]);
    
    // Execution stats
    const execTotal = await dbGet(db, 'SELECT COUNT(*) as count FROM agent_executions WHERE user_id = ?', [userId]);
    const recentExecs = await dbGet(db, "SELECT COUNT(*) as count FROM agent_executions WHERE user_id = ? AND start_time > datetime('now', '-7 days')", [userId]);
    
    // Conversation stats
    const convTotal = await dbGet(db, 'SELECT COUNT(*) as count FROM conversation_logs WHERE user_id = ?', [userId]);
    
    // Graph stats (may not exist yet)
    let entityCount = 0, edgeCount = 0, topEntities = [];
    try {
      const ec = await dbGet(db, 'SELECT COUNT(*) as count FROM memory_entities WHERE user_id = ?', [userId]);
      const eg = await dbGet(db, 'SELECT COUNT(*) as count FROM memory_edges WHERE user_id = ?', [userId]);
      entityCount = ec?.count || 0;
      edgeCount = eg?.count || 0;
      topEntities = await dbAll(db, 'SELECT name, entity_type, mentions FROM memory_entities WHERE user_id = ? ORDER BY mentions DESC LIMIT 15', [userId]);
    } catch (e) { /* tables may not exist */ }

    // Memory timeline (last 30 days)
    const timeline = await dbAll(db, `
      SELECT DATE(created_at) as day, COUNT(*) as count
      FROM agent_memory WHERE user_id = ?
      AND created_at > datetime('now', '-30 days')
      GROUP BY DATE(created_at) ORDER BY day`, [userId]);

    return {
      success: true,
      data: {
        overview: {
          memories: memoryCount?.count || 0,
          insights: insightTotal?.count || 0,
          executions: execTotal?.count || 0,
          conversations: convTotal?.count || 0,
          graphEntities: entityCount,
          graphEdges: edgeCount
        },
        memoryTypes: Object.fromEntries(memoryTypes.map(r => [r.memory_type, r.count])),
        accessStats: {
          average: Math.round((avgAccess?.avg || 0) * 10) / 10,
          max: avgAccess?.max || 0
        },
        insightStatus: Object.fromEntries(insightStatus.map(r => [r.status, r.count])),
        recentExecutions: recentExecs?.count || 0,
        topEntities,
        timeline
      }
    };
  }

  async graphData(db, userId, params) {
    const limit = params.limit || 50;
    let entities = [], edges = [];
    
    try {
      entities = await dbAll(db, 'SELECT * FROM memory_entities WHERE user_id = ? ORDER BY mentions DESC LIMIT ?', [userId, limit]);
      
      if (entities.length > 0) {
        const entityIds = entities.map(e => `'${e.id}'`).join(',');
        edges = await dbAll(db, `SELECT * FROM memory_edges WHERE user_id = ? AND source_type = 'entity' AND target_type = 'entity' AND source_id IN (${entityIds}) AND target_id IN (${entityIds})`, [userId]);
      }
    } catch (e) { /* tables may not exist */ }

    return {
      success: true,
      data: {
        nodes: entities.map(e => ({
          id: e.id, name: e.name, type: e.entity_type,
          mentions: e.mentions, firstSeen: e.first_seen, lastSeen: e.last_seen
        })),
        edges: edges.map(e => ({
          id: e.id, source: e.source_id, target: e.target_id,
          relationship: e.relationship, confidence: e.confidence
        })),
        nodeCount: entities.length,
        edgeCount: edges.length
      }
    };
  }

  async search(db, userId, params) {
    const query = params.query;
    if (!query) return { success: false, error: 'query is required' };

    const results = [];
    const tokens = query.split(/\s+/).map(t => t.replace(/[^a-zA-Z0-9_-]/g, '')).filter(t => t.length >= 2);
    if (tokens.length === 0) return { success: true, data: { results: [], total: 0 } };

    const ftsQuery = tokens.map(t => `${t}*`).join(' ');

    // Search memories
    try {
      const memResults = await dbAll(db, `
        SELECT doc_id AS id, agent_id, memory_type, created_at,
          snippet(agent_memory_fts, -1, '«', '»', '…', 16) AS snippet,
          bm25(agent_memory_fts) AS score
        FROM agent_memory_fts
        WHERE agent_memory_fts MATCH ? AND agent_memory_fts.user_id = ?
        ORDER BY score LIMIT 20`, [ftsQuery, userId]);
      for (const r of memResults) {
        results.push({ kind: 'memory', id: r.id, snippet: r.snippet, score: r.score, type: r.memory_type, date: r.created_at });
      }
    } catch (e) { /* ignore */ }

    // Search entities
    try {
      const entityResults = await dbAll(db, 'SELECT * FROM memory_entities WHERE user_id = ? AND name LIKE ? LIMIT 20', [userId, `%${query}%`]);
      for (const e of entityResults) {
        results.push({ kind: 'entity', id: e.id, snippet: e.name, score: -100, type: e.entity_type, date: e.last_seen, mentions: e.mentions });
      }
    } catch (e) { /* ignore */ }

    results.sort((a, b) => (a.score ?? 0) - (b.score ?? 0));

    return { success: true, data: { results: results.slice(0, params.limit || 50), total: results.length, query } };
  }

  async entityDetail(db, userId, params) {
    if (!params.entityId) return { success: false, error: 'entityId is required' };
    
    try {
      const entity = await dbGet(db, 'SELECT * FROM memory_entities WHERE id = ? AND user_id = ?', [params.entityId, userId]);
      if (!entity) return { success: false, error: 'Entity not found' };

      const edges = await dbAll(db, 'SELECT * FROM memory_edges WHERE (source_id = ? OR target_id = ?) AND user_id = ?', [entity.id, entity.id, userId]);
      
      const connectedIds = new Set();
      for (const e of edges) {
        if (e.source_id !== entity.id) connectedIds.add(e.source_id);
        if (e.target_id !== entity.id) connectedIds.add(e.target_id);
      }

      const connected = [];
      for (const cid of connectedIds) {
        const ent = await dbGet(db, 'SELECT id, name, entity_type, mentions FROM memory_entities WHERE id = ?', [cid]);
        if (ent) connected.push(ent);
      }

      // Find memories that mention this entity
      const relatedMemories = await dbAll(db, "SELECT id, content, memory_type, created_at FROM agent_memory WHERE user_id = ? AND LOWER(content) LIKE LOWER(?) LIMIT 10", [userId, `%${entity.name}%`]);

      return {
        success: true,
        data: {
          entity,
          connected,
          edges: edges.length,
          relatedMemories: relatedMemories.map(m => ({ id: m.id, content: m.content.substring(0, 150), type: m.memory_type, date: m.created_at }))
        }
      };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async dreamReport(db, userId) {
    // Light version of the dream report for the widget
    const memories = await dbAll(db, 'SELECT * FROM agent_memory WHERE user_id = ?', [userId]);
    
    // Simple duplicate check
    let duplicateCount = 0;
    for (let i = 0; i < memories.length; i++) {
      for (let j = i + 1; j < memories.length; j++) {
        const wordsA = new Set(memories[i].content.toLowerCase().split(/\s+/));
        const wordsB = new Set(memories[j].content.toLowerCase().split(/\s+/));
        const intersection = [...wordsA].filter(w => wordsB.has(w));
        const union = new Set([...wordsA, ...wordsB]);
        if (intersection.length / union.size > 0.7) duplicateCount++;
      }
    }

    // Stale memory check (90+ days, low access)
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const staleCount = await dbGet(db, `
      SELECT COUNT(*) as count FROM agent_memory
      WHERE user_id = ? AND updated_at < ? AND access_count < 3
      AND memory_type IN ('pattern', 'tool_insight', 'workflow_insight')`, [userId, cutoff]);

    const healthScore = Math.max(0, 100 - (duplicateCount * 5) - ((staleCount?.count || 0) * 2));

    return {
      success: true,
      data: {
        healthScore,
        totalMemories: memories.length,
        duplicates: duplicateCount,
        staleMemories: staleCount?.count || 0,
        recommendation: healthScore > 80 ? 'Memory system is healthy' :
                        healthScore > 50 ? 'Consider running a dream cycle to clean up' :
                        'Memory needs attention — run FULL_DREAM'
      }
    };
  }

  async recentActivity(db, userId, params) {
    const limit = params.limit || 20;
    
    const recentMemories = await dbAll(db, 'SELECT id, content, memory_type, created_at FROM agent_memory WHERE user_id = ? ORDER BY created_at DESC LIMIT ?', [userId, limit]);
    const recentInsights = await dbAll(db, 'SELECT id, title, category, status, created_at FROM insights WHERE user_id = ? ORDER BY created_at DESC LIMIT ?', [userId, limit]);

    const combined = [
      ...recentMemories.map(m => ({ kind: 'memory', id: m.id, text: m.content.substring(0, 100), type: m.memory_type, date: m.created_at })),
      ...recentInsights.map(i => ({ kind: 'insight', id: i.id, text: i.title, type: i.category, status: i.status, date: i.created_at }))
    ].sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, limit);

    return { success: true, data: { items: combined, total: combined.length } };
  }
}

export default new MemoryToolkitApi();
