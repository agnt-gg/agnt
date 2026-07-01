// memory-dream.js — Auto-consolidation cycle (inspired by Claude Code's Auto Dream)
// Scans the top memories by access count to find duplicates, contradictions, and stale entries
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

function dbRun(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) { if (err) reject(err); else resolve({ changes: this.changes }); });
  });
}
function dbAll(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => { if (err) reject(err); else resolve(rows || []); });
  });
}
function dbGet(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => { if (err) reject(err); else resolve(row || null); });
  });
}

function tokenize(text) {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length >= 3);
}

function jaccardSimilarity(a, b) {
  const setA = new Set(tokenize(a));
  const setB = new Set(tokenize(b));
  if (setA.size === 0 && setB.size === 0) return 1.0;
  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return intersection.size / union.size;
}

const CONTRADICTION_MARKERS = [
  { pattern: /prefers?\s+(\w+)/i, type: 'preference' },
  { pattern: /uses?\s+(\w+)/i, type: 'tool' },
  { pattern: /(\w+)\s+is\s+(not|never|always|preferred|deprecated)/i, type: 'assertion' },
  { pattern: /switched?\s+(?:from|to)\s+(\w+)/i, type: 'change' },
  { pattern: /(?:moved|migrated|changed)\s+(?:from|to)\s+(\w+)/i, type: 'migration' },
];

function detectContradiction(memA, memB) {
  const contentA = memA.content.toLowerCase();
  const contentB = memB.content.toLowerCase();
  if (memA.memory_type === memB.memory_type) {
    if ((contentA.includes(' not ') && !contentB.includes(' not ') ||
         !contentA.includes(' not ') && contentB.includes(' not ')) &&
        jaccardSimilarity(memA.content, memB.content) > 0.4) {
      return { type: 'negation', confidence: 0.7 };
    }
    for (const marker of CONTRADICTION_MARKERS) {
      const matchA = contentA.match(marker.pattern);
      const matchB = contentB.match(marker.pattern);
      if (matchA && matchB && matchA[1] !== matchB[1]) {
        if (jaccardSimilarity(memA.content, memB.content) > 0.3) {
          return { type: marker.type, confidence: 0.6, valueA: matchA[1], valueB: matchB[1] };
        }
      }
    }
  }
  if (memA.memory_type === 'correction' && memB.memory_type === 'fact' && jaccardSimilarity(memA.content, memB.content) > 0.3) return { type: 'correction_supersedes', confidence: 0.8 };
  if (memB.memory_type === 'correction' && memA.memory_type === 'fact' && jaccardSimilarity(memA.content, memB.content) > 0.3) return { type: 'correction_supersedes', confidence: 0.8 };
  return null;
}

// The agent_memory table has 90K+ rows from auto-extraction.
// Dream scans only the TOP 500 by access_count (the actively-used memories).
// This keeps the O(n^2) scan under 250K comparisons — fast enough.
const DREAM_LIMIT = 500;

class MemoryDream {
  constructor() { this.name = 'memory-dream'; }

  async execute(params, inputData, workflowEngine) {
    try {
      const db = await getDb();
      const userId = workflowEngine?.userId;
      if (!userId) return { success: false, error: 'No user context' };
      const dryRun = params.dryRun === 'true' || params.dryRun === true;
      switch (params.action) {
        case 'FULL_DREAM': return await this.fullDream(db, userId, params, dryRun);
        case 'FIND_DUPLICATES': return await this.findDuplicates(db, userId);
        case 'FIND_CONTRADICTIONS': return await this.findContradictions(db, userId);
        case 'PRUNE_STALE': return await this.pruneStale(db, userId, params, dryRun);
        case 'GENERATE_REPORT': return await this.generateReport(db, userId);
        default: return { success: false, error: `Unknown action: ${params.action}` };
      }
    } catch (error) {
      console.error(`[${this.name}] Error:`, error);
      return { success: false, error: error.message };
    }
  }

  async _getActiveMemories(db, userId) {
    return dbAll(db, `SELECT * FROM agent_memory WHERE user_id = ? ORDER BY access_count DESC LIMIT ?`, [userId, DREAM_LIMIT]);
  }

  async findDuplicates(db, userId) {
    const memories = await this._getActiveMemories(db, userId);
    const duplicates = [];
    for (let i = 0; i < memories.length; i++) {
      for (let j = i + 1; j < memories.length; j++) {
        const similarity = jaccardSimilarity(memories[i].content, memories[j].content);
        if (similarity >= 0.7) {
          duplicates.push({
            memoryA: { id: memories[i].id, content: memories[i].content.substring(0, 100), type: memories[i].memory_type, created: memories[i].created_at },
            memoryB: { id: memories[j].id, content: memories[j].content.substring(0, 100), type: memories[j].memory_type, created: memories[j].created_at },
            similarity: Math.round(similarity * 100) + '%',
            recommendation: similarity >= 0.9 ? 'MERGE (near-identical)' : 'REVIEW (high overlap)'
          });
        }
      }
    }
    return { success: true, duplicates, totalChecked: memories.length, duplicatesFound: duplicates.length };
  }

  async findContradictions(db, userId) {
    const memories = await this._getActiveMemories(db, userId);
    const contradictions = [];
    for (let i = 0; i < memories.length; i++) {
      for (let j = i + 1; j < memories.length; j++) {
        const contradiction = detectContradiction(memories[i], memories[j]);
        if (contradiction) {
          const newer = new Date(memories[i].updated_at || memories[i].created_at) >
                        new Date(memories[j].updated_at || memories[j].created_at) ? memories[i] : memories[j];
          const older = newer === memories[i] ? memories[j] : memories[i];
          contradictions.push({
            newer: { id: newer.id, content: newer.content.substring(0, 120), type: newer.memory_type, date: newer.updated_at || newer.created_at },
            older: { id: older.id, content: older.content.substring(0, 120), type: older.memory_type, date: older.updated_at || older.created_at },
            contradictionType: contradiction.type, confidence: contradiction.confidence,
            recommendation: `Keep newer (${newer.memory_type}), supersede older (${older.memory_type})`
          });
        }
      }
    }
    return { success: true, contradictions, totalChecked: memories.length, contradictionsFound: contradictions.length };
  }

  async pruneStale(db, userId, params, dryRun) {
    const staleDays = params.staleDays || 90;
    const cutoff = new Date(Date.now() - staleDays * 24 * 60 * 60 * 1000).toISOString();
    const staleMemories = await dbAll(db, `
      SELECT * FROM agent_memory
      WHERE user_id = ? AND updated_at < ? AND access_count < 3
        AND memory_type IN ('pattern', 'tool_insight', 'workflow_insight')
      ORDER BY access_count ASC, updated_at ASC LIMIT 100`, [userId, cutoff]);

    if (dryRun) {
      return { success: true, pruned: 0, data: {
        wouldPrune: staleMemories.length,
        candidates: staleMemories.slice(0, 20).map(m => ({ id: m.id, content: m.content.substring(0, 100), type: m.memory_type, accessCount: m.access_count, lastUpdated: m.updated_at })),
        dryRun: true, staleDays
      }};
    }
    let pruned = 0;
    for (const mem of staleMemories) {
      await dbRun(db, 'DELETE FROM agent_memory WHERE id = ? AND user_id = ?', [mem.id, userId]);
      pruned++;
    }
    return { success: true, pruned, data: { staleDays, totalCandidates: staleMemories.length } };
  }

  async fullDream(db, userId, params, dryRun) {
    const report = { startedAt: new Date().toISOString(), dryRun, phases: {} };

    const dupResult = await this.findDuplicates(db, userId);
    report.phases.duplicates = { found: dupResult.duplicatesFound, checked: dupResult.totalChecked, pairs: dupResult.duplicates.slice(0, 10) };

    const contraResult = await this.findContradictions(db, userId);
    report.phases.contradictions = { found: contraResult.contradictionsFound, checked: contraResult.totalChecked, pairs: contraResult.contradictions.slice(0, 10) };

    const pruneResult = await this.pruneStale(db, userId, params, dryRun);
    report.phases.prune = { pruned: pruneResult.pruned, candidates: pruneResult.data?.wouldPrune || pruneResult.data?.totalCandidates || 0 };

    const totalMemories = await dbGet(db, 'SELECT COUNT(*) as count FROM agent_memory WHERE user_id = ?', [userId]);
    const byType = await dbAll(db, 'SELECT memory_type, COUNT(*) as count FROM agent_memory WHERE user_id = ? GROUP BY memory_type', [userId]);
    const avgAccess = await dbGet(db, 'SELECT AVG(access_count) as avg FROM agent_memory WHERE user_id = ?', [userId]);
    const oldestMemory = await dbGet(db, 'SELECT MIN(created_at) as oldest FROM agent_memory WHERE user_id = ?', [userId]);
    const newestMemory = await dbGet(db, 'SELECT MAX(created_at) as newest FROM agent_memory WHERE user_id = ?', [userId]);

    report.phases.health = {
      totalMemories: totalMemories?.count || 0,
      byType: Object.fromEntries(byType.map(r => [r.memory_type, r.count])),
      avgAccessCount: Math.round((avgAccess?.avg || 0) * 10) / 10,
      oldestMemory: oldestMemory?.oldest, newestMemory: newestMemory?.newest,
      memorySpanDays: oldestMemory?.oldest ? Math.round((Date.now() - new Date(oldestMemory.oldest).getTime()) / (24 * 60 * 60 * 1000)) : 0
    };
    report.completedAt = new Date().toISOString();
    return { success: true, report, duplicates: dupResult.duplicates, contradictions: contraResult.contradictions, pruned: pruneResult.pruned };
  }

  async generateReport(db, userId) {
    const totalMemories = await dbGet(db, 'SELECT COUNT(*) as count FROM agent_memory WHERE user_id = ?', [userId]);
    const byType = await dbAll(db, 'SELECT memory_type, COUNT(*) as count FROM agent_memory WHERE user_id = ? GROUP BY memory_type ORDER BY count DESC', [userId]);
    const topAccessed = await dbAll(db, 'SELECT content, memory_type, access_count, updated_at FROM agent_memory WHERE user_id = ? ORDER BY access_count DESC LIMIT 10', [userId]);
    const leastAccessed = await dbAll(db, 'SELECT content, memory_type, access_count, created_at FROM agent_memory WHERE user_id = ? AND access_count > 0 ORDER BY access_count ASC LIMIT 10', [userId]);
    const avgAccess = await dbGet(db, 'SELECT AVG(access_count) as avg, MAX(access_count) as max, MIN(access_count) as min FROM agent_memory WHERE user_id = ?', [userId]);
    const insightStats = await dbAll(db, 'SELECT status, COUNT(*) as count FROM insights WHERE user_id = ? GROUP BY status', [userId]);
    const insightCategories = await dbAll(db, 'SELECT category, COUNT(*) as count FROM insights WHERE user_id = ? GROUP BY category ORDER BY count DESC', [userId]);
    let entityCount = 0, edgeCount = 0;
    try {
      entityCount = (await dbGet(db, 'SELECT COUNT(*) as count FROM memory_entities WHERE user_id = ?', [userId]))?.count || 0;
      edgeCount = (await dbGet(db, 'SELECT COUNT(*) as count FROM memory_edges WHERE user_id = ?', [userId]))?.count || 0;
    } catch (e) {}

    return { success: true, report: {
      generatedAt: new Date().toISOString(),
      memories: { total: totalMemories?.count || 0, byType: Object.fromEntries(byType.map(r => [r.memory_type, r.count])), accessStats: { average: Math.round((avgAccess?.avg || 0) * 10) / 10, max: avgAccess?.max || 0, min: avgAccess?.min || 0 } },
      topAccessed: topAccessed.map(m => ({ content: m.content.substring(0, 100), type: m.memory_type, accessCount: m.access_count })),
      leastAccessed: leastAccessed.map(m => ({ content: m.content.substring(0, 100), type: m.memory_type, accessCount: m.access_count, created: m.created_at })),
      insights: { byStatus: Object.fromEntries(insightStats.map(r => [r.status, r.count])), byCategory: Object.fromEntries(insightCategories.map(r => [r.category, r.count])) },
      graph: { entities: entityCount, edges: edgeCount }
    }};
  }
}

export default new MemoryDream();
