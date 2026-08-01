import db from './database/index.js';
import generateUUID from '../utils/generateUUID.js';
import { memoryShape, isAutoExtractedMemoryType } from '../utils/memoryShape.js';
import {
  contentTokens,
  isNearDuplicate,
  buildMatchQuery,
  CANDIDATE_LIMIT,
} from '../utils/memorySimilarity.js';

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
   * Create a new memory entry, collapsing near-duplicates.
   *
   * TWO-STAGE MATCH, cheapest first:
   *   1. shape key   — one indexed lookup, catches verbatim-modulo-ids repeats
   *   2. FTS + containment — catches the paraphrases, which is most of them
   *
   * Stage 2 is the one that matters. The extractor is an LLM and it rewords
   * every time, so on the live store exactly TWO of 97,504 rows were
   * byte-identical and the shape key alone only collapses 1.56x. BM25 over the
   * already-populated agent_memory_fts index narrows to a handful of
   * vocabulary-sharing candidates and token containment makes the call —
   * measured at 51.6% of auto-writes blocked. See utils/memorySimilarity.js.
   *
   * A match bumps `occurrence_count` / `last_seen_at` and returns the existing
   * id. The stored CONTENT IS NOT REWRITTEN: we cannot tell which of two
   * paraphrases is better, and rewriting would churn the FTS row and the shape
   * key on every sighting. First wording wins and stays stable.
   *
   * User-set memories always insert — both matchers are lossy, and silently
   * discarding something the user asked to remember is far worse than keeping
   * a redundant row. See AUTO_EXTRACTED_MEMORY_TYPES.
   *
   * @returns {Promise<string>} the id of the new OR the matched existing row.
   */
  static async create({ agentId, userId, memoryType, content, sourceConversationId }) {
    if (agentId === 'orchestrator') {
      await this._ensureOrchestratorAgent(userId);
    }

    const shape = isAutoExtractedMemoryType(memoryType) ? memoryShape(content) : null;
    if (shape) {
      const existing = await this.findByShape(agentId, memoryType, shape);
      if (existing) {
        await this.recordDuplicateSighting(existing.id).catch(() => {});
        return existing.id;
      }
      const similar = await this.findSimilar(agentId, memoryType, content).catch(() => null);
      if (similar) {
        await this.recordDuplicateSighting(similar.id).catch(() => {});
        return similar.id;
      }
    }

    const id = generateUUID();
    const nowIso = new Date().toISOString();
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO agent_memory (id, agent_id, user_id, memory_type, content, source_conversation_id, content_shape, occurrence_count, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        [id, agentId, userId, memoryType, content, sourceConversationId || null, shape, nowIso],
        function (err) {
          if (err) reject(err);
          else resolve(id);
        }
      );
    });
  }

  /**
   * Nearest stored memory that describes the same finding, or null.
   *
   * FTS is the BLOCKER and containment is the DECISION — BM25 ranking alone is
   * far too loose to delete a write on, but it reduces 97k rows to a dozen with
   * one indexed query so the exact comparison stays cheap.
   *
   * Scoped to the same agent AND memory_type: a `pattern` and a
   * `workflow_insight` that share vocabulary are different KINDS of claim, and
   * collapsing across types would lose the distinction retrieval depends on.
   */
  static async findSimilar(agentId, memoryType, content) {
    const match = buildMatchQuery(content);
    if (!match) return null;

    const candidates = await new Promise((resolve, reject) => {
      db.all(
        `SELECT doc_id, content FROM agent_memory_fts
         WHERE agent_memory_fts MATCH ?
           AND agent_id = ? AND memory_type = ?
         ORDER BY bm25(agent_memory_fts) LIMIT ?`,
        [match, agentId, memoryType, CANDIDATE_LIMIT],
        (err, rows) => (err ? reject(err) : resolve(rows || []))
      );
    });
    if (candidates.length === 0) return null;

    const tokens = contentTokens(content);
    for (const cand of candidates) {
      if (isNearDuplicate(tokens, contentTokens(cand.content))) {
        return this.findById(cand.doc_id);
      }
    }
    return null;
  }

  static findById(id) {
    return new Promise((resolve, reject) => {
      db.get('SELECT * FROM agent_memory WHERE id = ?', [id], (err, row) => (err ? reject(err) : resolve(row || null)));
    });
  }

  /**
   * Record that a finding recurred.
   *
   * Deliberately does NOT touch `updated_at` — that column is a relevance sort
   * key, so writing it here would make recording a duplicate silently reorder
   * retrieval. Same reasoning as incrementAccess.
   */
  static recordDuplicateSighting(id) {
    return new Promise((resolve, reject) => {
      db.run(
        `UPDATE agent_memory
           SET occurrence_count = COALESCE(occurrence_count, 1) + 1,
               last_seen_at = ?,
               relevance_score = MIN(2.0, COALESCE(relevance_score, 1.0) + 0.05)
         WHERE id = ?`,
        [new Date().toISOString(), id],
        function (err) { return err ? reject(err) : resolve(this.changes); }
      );
    });
  }

  /** Existing row with the same normalised shape, if any. */
  static findByShape(agentId, memoryType, shape) {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT * FROM agent_memory
         WHERE agent_id = ? AND memory_type = ? AND content_shape = ?
         ORDER BY created_at ASC LIMIT 1`,
        [agentId, memoryType, shape],
        (err, row) => (err ? reject(err) : resolve(row || null))
      );
    });
  }

  /**
   * Memory types saved at the user's direction. Authoritative.
   * Shared with findRelevant so the read and write paths cannot disagree.
   */
  static get USER_SET_TYPE_LIST() {
    return ['fact', 'preference', 'correction', 'context', 'prompt_guidance'];
  }

  static get AUTO_TYPE_LIST() {
    return ['pattern', 'tool_insight', 'workflow_insight'];
  }

  /**
   * Tiered read for the `get_agent_memories` tool.
   *
   * The system-prompt path (findRelevant) has quota'd user-set vs
   * auto-extracted candidates since the memory digest work; the TOOL path
   * never got the same treatment and called findByAgentId flat with limit 30.
   * Because auto-extracted rows outnumber user-set ones 5:1 and sort by the
   * same relevance score, the tool returned almost entirely machine noise —
   * observed live as 26 of 30 results being duplicate workflow bottleneck
   * reports. Same tiering, same reason.
   */
  static async findTiered(agentId, { memoryType, limit = 30 } = {}) {
    if (memoryType) {
      return this.findByAgentId(agentId, { memoryType, limit });
    }
    const userQuota = Math.max(1, Math.ceil(limit * 0.8));
    const [userSet, auto] = await Promise.all([
      this.findByAgentId(agentId, { limit: userQuota, memoryTypes: this.USER_SET_TYPE_LIST }),
      this.findByAgentId(agentId, { limit: limit - userQuota, memoryTypes: this.AUTO_TYPE_LIST }),
    ]);
    return [...userSet, ...auto].slice(0, limit);
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

    // `id` is the final tiebreaker so equal-scoring rows come back in a
    // stable order. Without it SQLite is free to return ties in any order and
    // the memory digest silently reshuffles between builds.
    query += ' ORDER BY relevance_score DESC, updated_at DESC, id ASC LIMIT ?';
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
   *
   * DELIBERATELY DOES NOT TOUCH `updated_at`. That column is a SORT KEY for
   * relevance retrieval (`relevance_score DESC, updated_at DESC`), so bumping
   * it here made reading memory reorder memory: two identical retrievals, run
   * back to back with no writes in between, returned different sets. Observed
   * directly — building the same prompt twice produced digests that disagreed
   * about which memories were shown in full vs gisted.
   *
   * `updated_at` means "the content changed"; access is tracked by
   * `access_count`, which is not a sort key and therefore cannot feed back
   * into ordering.
   */
  static incrementAccess(id) {
    return new Promise((resolve, reject) => {
      db.run(
        'UPDATE agent_memory SET access_count = access_count + 1 WHERE id = ?',
        [id],
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
      ? 'relevance_score DESC, updated_at DESC, id ASC'
      : 'created_at DESC, id ASC';
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
