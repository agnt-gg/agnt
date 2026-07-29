import db from './database/index.js';

class ConversationLogModel {
  /**
   * Creates a new conversation record.
   * @param {object} logData
   * @returns {Promise<{conversationId: string}>}
   */
  static async create({ conversationId, userId, initial_prompt, full_history, final_response, tool_calls, errors }) {
    const insertQuery = `
      INSERT INTO conversation_logs (conversation_id, user_id, initial_prompt, full_history, final_response, tool_calls, errors)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    const params = [conversationId, userId, initial_prompt, full_history, final_response, tool_calls, errors];

    return new Promise((resolve, reject) => {
      db.run(insertQuery, params, function (err) {
        if (err) {
          console.error('Error creating conversation log:', err);
          return reject(err);
        }
        resolve({ conversationId });
      });
    });
  }

  /**
   * Updates an existing conversation record.
   * @param {object} logData
   * @returns {Promise<{conversationId: string, updated: boolean}>}
   */
  static async update({ conversationId, full_history, final_response, tool_calls, errors }) {
    const updateQuery = `
      UPDATE conversation_logs
      SET 
        full_history = ?,
        final_response = ?,
        tool_calls = ?,
        errors = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE conversation_id = ?
    `;
    const params = [full_history, final_response, tool_calls, errors, conversationId];

    return new Promise((resolve, reject) => {
      db.run(updateQuery, params, function (err) {
        if (err) {
          console.error('Error updating conversation log:', err);
          return reject(err);
        }
        if (this.changes === 0) {
          console.warn(`Attempted to update a conversation log that does not exist: ${conversationId}`);
        }
        resolve({ conversationId, updated: this.changes > 0 });
      });
    });
  }

  /**
   * Read a conversation back.
   *
   * This model was WRITE-ONLY until now: `create` and `update` persisted the
   * authoritative transcript — including the partial answer saved when a turn
   * was interrupted — into a table nothing could read. The complete copy of the
   * message existed on disk the whole time and no code path could reach it, so
   * the UI restored from the frontend's own snapshot instead and the partial was
   * invisible forever. A reader closes that gap.
   *
   * Scoped by userId: a conversation id is a bearer token for its own contents
   * otherwise.
   *
   * @returns {Promise<object|null>} Row with parsed `messages`, or null.
   */
  static async getByConversationId(conversationId, userId) {
    if (!conversationId) return null;

    const selectQuery = `
      SELECT conversation_id, user_id, initial_prompt, full_history,
             final_response, tool_calls, errors, created_at, updated_at
      FROM conversation_logs
      WHERE conversation_id = ?
      LIMIT 1
    `;

    return new Promise((resolve, reject) => {
      db.get(selectQuery, [conversationId], (err, row) => {
        if (err) {
          console.error('Error reading conversation log:', err);
          return reject(err);
        }
        if (!row) return resolve(null);

        // Ownership check happens here rather than in SQL so a mismatch is
        // indistinguishable from "not found" to the caller.
        if (userId != null && row.user_id != null && String(row.user_id) !== String(userId)) {
          return resolve(null);
        }

        const parse = (value, fallback) => {
          if (!value) return fallback;
          try {
            return JSON.parse(value);
          } catch {
            return fallback;
          }
        };

        resolve({
          conversationId: row.conversation_id,
          initialPrompt: row.initial_prompt,
          messages: parse(row.full_history, []),
          finalResponse: row.final_response || '',
          toolCalls: parse(row.tool_calls, []),
          errors: parse(row.errors, null),
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        });
      });
    });
  }
}

export default ConversationLogModel;
