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
}

export default ConversationLogModel;
