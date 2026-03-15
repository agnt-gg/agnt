import db from './database/index.js';
import generateUUID from '../utils/generateUUID.js';

/**
 * AgentMemoryModel — CRUD for the agent_memory table.
 * Persistent memory for agents across conversations.
 */
class AgentMemoryModel {
  /**
   * Create a new memory entry.
   */
  static create({ agentId, userId, memoryType, content, sourceConversationId }) {
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
   */
  static findByAgentId(agentId, { memoryType, limit = 50 } = {}) {
    let query = 'SELECT * FROM agent_memory WHERE agent_id = ?';
    const params = [agentId];

    if (memoryType) { query += ' AND memory_type = ?'; params.push(memoryType); }

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
   */
  static findByUserId(userId, { limit = 100 } = {}) {
    return new Promise((resolve, reject) => {
      db.all(
        'SELECT * FROM agent_memory WHERE user_id = ? ORDER BY relevance_score DESC, updated_at DESC LIMIT ?',
        [userId, limit],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
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
    // Get candidate memories — include global/orchestrator memories for agent-specific searches
    let candidates;
    if (agentId && agentId !== 'orchestrator') {
      const [agentMems, globalMems] = await Promise.all([
        this.findByAgentId(agentId, { limit: 150 }),
        this.findByAgentId('orchestrator', { limit: 50 }),
      ]);
      candidates = [...agentMems, ...globalMems];
    } else {
      candidates = await this.findByUserId(userId, { limit: 200 });
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

    // Score each memory by keyword overlap
    const scored = candidates.map(mem => {
      const contentLower = mem.content.toLowerCase();
      let matchCount = 0;
      for (const kw of keywords) {
        if (contentLower.includes(kw)) matchCount++;
      }
      // Combine keyword match ratio with stored relevance_score
      const matchRatio = matchCount / keywords.length;
      const score = (matchRatio * 0.7) + ((mem.relevance_score || 1.0) / 2.0 * 0.3);
      return { ...mem, _matchCount: matchCount, _score: score };
    });

    // Sort by score descending, then by relevance_score
    scored.sort((a, b) => b._score - a._score || b.relevance_score - a.relevance_score);

    // Take top matches, but ensure we include at least some high-relevance memories
    // even if they don't keyword-match (corrections/preferences are always relevant)
    const matched = scored.filter(m => m._matchCount > 0).slice(0, limit);
    const alwaysRelevant = candidates
      .filter(m => (m.memory_type === 'correction' || m.memory_type === 'preference') && !matched.some(mm => mm.id === m.id))
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
