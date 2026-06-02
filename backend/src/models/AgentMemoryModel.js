import db from './database/index.js';
import generateUUID from '../utils/generateUUID.js';

/**
 * AgentMemoryModel — CRUD for the agent_memory table.
 * Persistent memory for agents across conversations.
 */
class AgentMemoryModel {
  /**
   * Ensure the sentinel 'orchestrator' agent row exists before any FK-dependent insert.
   * Why: agent_memory.agent_id has a FK to agents(id), but 'orchestrator' is a virtual
   * ID for global memories, not a user-created agent. We lazy-seed the row here using
   * the current userId as created_by so the FK is always satisfied on first use.
   */
  static _ensureOrchestratorAgent(userId) {
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT OR IGNORE INTO agents (id, name, status, created_by) VALUES ('orchestrator', 'Orchestrator', 'system', ?)`,
        [userId],
        (err) => (err ? reject(err) : resolve())
      );
    });
  }

  /**
   * Create a new memory entry.
   */
  static async create({ agentId, userId, memoryType, content, sourceConversationId }) {
    if (agentId === 'orchestrator') {
      await this._ensureOrchestratorAgent(userId);
    }
    const id = generateUUID();
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO agent_memory (id, agent_id, user_id, memory_type, content, source_conversation_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, agentId, userId, memoryType, content, sourceConversationId || null],
        function (err) {
          if (err) reject(err);
          else resolve(id);
        }
      );
    });
  }

  /**
   * Find all memories for a specific agent.
   *
   * `memoryType` filters to a single type; `memoryTypes` filters to an
   * IN-list of types (used by retrieval to quota user-set vs. auto-extracted
   * tiers in the candidate pool).
   */
  static findByAgentId(agentId, { memoryType, memoryTypes, limit = 50 } = {}) {
    let query = 'SELECT * FROM agent_memory WHERE agent_id = ?';
    const params = [agentId];

    if (memoryType) { query += ' AND memory_type = ?'; params.push(memoryType); }
    if (Array.isArray(memoryTypes) && memoryTypes.length > 0) {
      const placeholders = memoryTypes.map(() => '?').join(',');
      query += ` AND memory_type IN (${placeholders})`;
      params.push(...memoryTypes);
    }

    query += ' ORDER BY relevance_score DESC, updated_at DESC LIMIT ?';
    params.push(limit);

    return new Promise((resolve, reject) => {
      db.all(query, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  /**
   * Find a single memory by ID.
   */
  static findOne(id) {
    return new Promise((resolve, reject) => {
      db.get('SELECT * FROM agent_memory WHERE id = ?', [id], (err, row) => {
        if (err) reject(err);
        else resolve(row || null);
      });
    });
  }

  /**
   * Find duplicate memory by content similarity (exact match).
   */
  static findDuplicate(agentId, content) {
    return new Promise((resolve, reject) => {
      db.get(
        'SELECT * FROM agent_memory WHERE agent_id = ? AND content = ?',
        [agentId, content],
        (err, row) => {
          if (err) reject(err);
          else resolve(row || null);
        }
      );
    });
  }

  /**
   * Update memory content and relevance.
   */
  static update(id, { content, relevanceScore, memoryType }) {
    const updates = [];
    const params = [];

    if (content !== undefined) { updates.push('content = ?'); params.push(content); }
    if (relevanceScore !== undefined) { updates.push('relevance_score = ?'); params.push(relevanceScore); }
    if (memoryType !== undefined) { updates.push('memory_type = ?'); params.push(memoryType); }

    updates.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(id);

    return new Promise((resolve, reject) => {
      db.run(
        `UPDATE agent_memory SET ${updates.join(', ')} WHERE id = ?`,
        params,
        function (err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }

  /**
   * Increment access count (called when memory is used in a prompt).
   */
  static incrementAccess(id) {
    return new Promise((resolve, reject) => {
      db.run(
        'UPDATE agent_memory SET access_count = access_count + 1, updated_at = ? WHERE id = ?',
        [new Date().toISOString(), id],
        function (err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }

  /**
   * Delete a memory entry.
   */
  static delete(id, userId) {
    return new Promise((resolve, reject) => {
      db.run('DELETE FROM agent_memory WHERE id = ? AND user_id = ?', [id, userId], function (err) {
        if (err) reject(err);
        else resolve(this.changes);
      });
    });
  }

  /**
   * Delete all memories for an agent.
   */
  static deleteByAgentId(agentId) {
    return new Promise((resolve, reject) => {
      db.run('DELETE FROM agent_memory WHERE agent_id = ?', [agentId], function (err) {
        if (err) reject(err);
        else resolve(this.changes);
      });
    });
  }

  /**
   * Find all memories for a user (across all agents).
   *
   * Sort defaults to `created_at DESC` so freshly-saved memories never get
   * culled by the LIMIT before the user can see them. Pass `sort: 'relevance'`
   * to fall back to the previous relevance-weighted ordering (used by
   * keyword retrieval, not by the Lab > Memories UI).
   */
  static findByUserId(userId, { limit = 5000, sort = 'recent', memoryTypes } = {}) {
    const orderBy = sort === 'relevance'
      ? 'relevance_score DESC, updated_at DESC'
      : 'created_at DESC';
    let query = 'SELECT * FROM agent_memory WHERE user_id = ?';
    const params = [userId];
    if (Array.isArray(memoryTypes) && memoryTypes.length > 0) {
      const placeholders = memoryTypes.map(() => '?').join(',');
      query += ` AND memory_type IN (${placeholders})`;
      params.push(...memoryTypes);
    }
    query += ` ORDER BY ${orderBy} LIMIT ?`;
    params.push(limit);
    return new Promise((resolve, reject) => {
      db.all(query, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  /**
   * Find memories relevant to a query using keyword matching.
   * Extracts keywords from the query and scores each memory by how many keywords match.
   * Returns top N memories sorted by match score, falling back to high-relevance memories.
   *
   * @param {string} agentId - Agent ID, or null for all agents for this user
   * @param {string} userId - User ID
   * @param {string} query - The user's message to match against
   * @param {number} limit - Max memories to return
   */
  static async findRelevant(agentId, userId, query, limit = 10) {
    // Type tiers — defined once at the top of the function and reused for
    // both candidate-pool quotas and downstream score weighting.
    //
    // User-set: saved at the user's direction (or `save_agent_memory` from
    //   chat). These are authoritative and should always have a floor in
    //   the candidate window.
    // Auto-extracted: emitted by the insight system (pattern/tool_insight/
    //   workflow_insight). Useful but noisier; with tens of thousands of
    //   rows they will otherwise drown out user-set memories.
    const USER_SET_TYPE_LIST = ['fact', 'preference', 'correction', 'context', 'prompt_guidance'];
    const AUTO_TYPE_LIST = ['pattern', 'tool_insight', 'workflow_insight'];
    const USER_SET_TYPES = new Set(USER_SET_TYPE_LIST);

    let candidates;
    if (agentId && agentId !== 'orchestrator') {
      const [agentUser, agentAuto, globalUser, globalAuto] = await Promise.all([
        this.findByAgentId(agentId, { limit: 120, memoryTypes: USER_SET_TYPE_LIST }),
        this.findByAgentId(agentId, { limit: 30, memoryTypes: AUTO_TYPE_LIST }),
        this.findByAgentId('orchestrator', { limit: 40, memoryTypes: USER_SET_TYPE_LIST }),
        this.findByAgentId('orchestrator', { limit: 10, memoryTypes: AUTO_TYPE_LIST }),
      ]);
      candidates = [...agentUser, ...agentAuto, ...globalUser, ...globalAuto];
    } else {
      const [userSet, autoExtracted] = await Promise.all([
        this.findByUserId(userId, { limit: 150, sort: 'relevance', memoryTypes: USER_SET_TYPE_LIST }),
        this.findByUserId(userId, { limit: 50, sort: 'relevance', memoryTypes: AUTO_TYPE_LIST }),
      ]);
      candidates = [...userSet, ...autoExtracted];
    }

    if (candidates.length === 0) return [];

    // Extract keywords from query (3+ char words, lowercased, deduplicated)
    const stopWords = new Set(['the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'her', 'was', 'one', 'our', 'out', 'has', 'have', 'been', 'some', 'them', 'than', 'its', 'over', 'such', 'that', 'this', 'with', 'will', 'each', 'make', 'like', 'from', 'just', 'into', 'what', 'when', 'how', 'where', 'which', 'their', 'would', 'there', 'about', 'could', 'other', 'after', 'these', 'also', 'should', 'please', 'want', 'need', 'help', 'does', 'don']);
    const keywords = [...new Set(
      query.toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length >= 3 && !stopWords.has(w))
    )];

    if (keywords.length === 0) {
      // No meaningful keywords — return highest relevance memories
      return candidates.slice(0, limit);
    }

    // Type priority: memories saved at the user's direction outrank memories
    // auto-extracted by the insight pipeline. Same tier split as the
    // candidate-pool quotas above; reused for score weighting here.
    const typeWeight = (mem) => USER_SET_TYPES.has(mem.memory_type) ? 1.0 : 0.4;

    // Score each memory by keyword overlap, relevance, and type tier.
    const scored = candidates.map(mem => {
      const contentLower = mem.content.toLowerCase();
      let matchCount = 0;
      for (const kw of keywords) {
        if (contentLower.includes(kw)) matchCount++;
      }
      const matchRatio = matchCount / keywords.length;
      const base = (matchRatio * 0.7) + ((mem.relevance_score || 1.0) / 2.0 * 0.3);
      const score = base * typeWeight(mem);
      return { ...mem, _matchCount: matchCount, _score: score };
    });

    // Sort by score, then user-set tier, then stored relevance.
    scored.sort((a, b) =>
      b._score - a._score ||
      typeWeight(b) - typeWeight(a) ||
      b.relevance_score - a.relevance_score
    );

    // Take top matches, but ensure we include at least some high-signal
    // user-set memories even if they don't keyword-match (facts, corrections,
    // and preferences are always relevant background context).
    const matched = scored.filter(m => m._matchCount > 0).slice(0, limit);
    const ALWAYS_RELEVANT_TYPES = new Set(['fact', 'correction', 'preference']);
    const alwaysRelevant = candidates
      .filter(m => ALWAYS_RELEVANT_TYPES.has(m.memory_type) && !matched.some(mm => mm.id === m.id))
      .slice(0, Math.max(2, limit - matched.length));

    const result = [...matched, ...alwaysRelevant].slice(0, limit);

    // Increment access counts for returned memories
    for (const mem of result) {
      this.incrementAccess(mem.id).catch(() => {});
    }

    return result;
  }

  /**
   * Count memories for an agent.
   */
  static countByAgentId(agentId) {
    return new Promise((resolve, reject) => {
      db.get('SELECT COUNT(*) as count FROM agent_memory WHERE agent_id = ?', [agentId], (err, row) => {
        if (err) reject(err);
        else resolve(row?.count || 0);
      });
    });
  }
}

export default AgentMemoryModel;
