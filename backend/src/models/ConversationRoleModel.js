import db from './database/index.js';

/**
 * Which saved conversation is a user's Main chat, and which conversations
 * were started from another one (sub-chats). See the conversation_roles
 * table in database/index.js for why this is a side table.
 *
 * Every read joins content_outputs, so a role whose conversation was deleted
 * reads as absent rather than as a dangling id (SQLite does not enforce the
 * foreign key unless the connection turns foreign_keys on).
 */

const get = (sql, params) => new Promise((resolve, reject) => db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null))));
const all = (sql, params) => new Promise((resolve, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || []))));
const run = (sql, params) => new Promise((resolve, reject) => db.run(sql, params, function (err) { if (err) reject(err); else resolve({ changes: this.changes }); }));

class ConversationRoleModel {
  /** The user's Main chat row id, or null when there is none (or it was deleted). */
  static async findMainOutputId(userId) {
    const row = await get(
      `SELECT r.output_id FROM conversation_roles r
       JOIN content_outputs co ON co.id = r.output_id AND co.user_id = r.user_id
       WHERE r.user_id = ? AND r.role = 'main'`,
      [userId],
    );
    return row ? row.output_id : null;
  }

  /** Make `outputId` the user's Main chat, replacing any previous one. */
  static async setMain(userId, outputId) {
    await run(`DELETE FROM conversation_roles WHERE user_id = ? AND role = 'main'`, [userId]);
    await run(`INSERT OR REPLACE INTO conversation_roles (output_id, user_id, role, parent_output_id) VALUES (?, ?, 'main', NULL)`, [outputId, userId]);
  }

  /** Record that `outputId` was started from `parentOutputId` (may be null). */
  static addSub(userId, outputId, parentOutputId) {
    return run(
      `INSERT OR REPLACE INTO conversation_roles (output_id, user_id, role, parent_output_id) VALUES (?, ?, 'sub', ?)`,
      [outputId, userId, parentOutputId || null],
    );
  }

  /** Drop the user's 'main' marker. The conversation row itself is untouched. */
  static releaseMain(userId) {
    return run(`DELETE FROM conversation_roles WHERE user_id = ? AND role = 'main'`, [userId]);
  }

  /** { role, parent_output_id } for one row, or null when it has no role. */
  static roleOf(outputId, userId) {
    return get(`SELECT role, parent_output_id FROM conversation_roles WHERE output_id = ? AND user_id = ?`, [outputId, userId]);
  }

  /** Every live sub-chat link for a user: [{ id, parentId }]. Small: one row per delegated task. */
  static async listSubChats(userId) {
    const rows = await all(
      `SELECT r.output_id AS id, r.parent_output_id AS parentId FROM conversation_roles r
       JOIN content_outputs co ON co.id = r.output_id AND co.user_id = r.user_id
       WHERE r.user_id = ? AND r.role = 'sub'`,
      [userId],
    );
    return rows.map((row) => ({ id: row.id, parentId: row.parentId || null }));
  }
}

export default ConversationRoleModel;
