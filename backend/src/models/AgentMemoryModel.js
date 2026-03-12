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
