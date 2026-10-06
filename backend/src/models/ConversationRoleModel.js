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

  /**
   * Make `outputId` the user's Main chat, replacing any previous one.
   *
   * ONE statement. It was DELETE-then-INSERT, so a failed INSERT left the user
   * with no Main chat at all. REPLACE resolves the one-main-per-user partial
   * unique index by removing the old marker in the same write.
   */
  static setMain(userId, outputId) {
    return run(`INSERT OR REPLACE INTO conversation_roles (output_id, user_id, role, parent_output_id) VALUES (?, ?, 'main', NULL)`, [outputId, userId]);
  }

  /**
   * A Main chat row that lost (or never got) its marker: the system-named
   * "Main chat" with no role. The newest, so the most recent one is adopted.
   */
  static async findUnmarkedMain(userId, title) {
    const row = await get(
      `SELECT co.id FROM content_outputs co
       LEFT JOIN conversation_roles r ON r.output_id = co.id
       WHERE co.user_id = ? AND co.title = ? AND co.title_source = 'system'
         AND co.content_type = 'conversation' AND co.archived_at IS NULL AND r.output_id IS NULL
       ORDER BY co.created_at DESC LIMIT 1`,
      [userId, title],
    );
    return row ? row.id : null;
  }

  /** Record that `outputId` was started from `parentOutputId` (may be null). Its work starts 'running'. */
  static addSub(userId, outputId, parentOutputId) {
    return run(
      `INSERT OR REPLACE INTO conversation_roles (output_id, user_id, role, parent_output_id, task_state) VALUES (?, ?, 'sub', ?, 'running')`,
      [outputId, userId, parentOutputId || null],
    );
  }

  /** Move sub-chats' work to `state` (running | done | reported | interrupted | expired). */
  static setTaskState(userId, outputIds, state) {
    const ids = (Array.isArray(outputIds) ? outputIds : [outputIds]).filter(Boolean);
    if (!ids.length) return Promise.resolve({ changes: 0 });
    return run(
      `UPDATE conversation_roles SET task_state = ? WHERE user_id = ? AND role = 'sub' AND output_id IN (${ids.map(() => '?').join(',')})`,
      [state, userId, ...ids],
    );
  }

  /**
   * Sub-chats whose work never reached their parent: still 'running' (the app
   * stopped mid-run) or 'done' but unreported. With what a report needs: the
   * title, the sub-chat's saved transcript, and the parent's CURRENT
   * conversation id (clearing the Main chat mints a new one; the row id holds).
   */
  static listUnreported() {
    return all(
      `SELECT r.output_id AS outputId, r.user_id AS userId, r.task_state AS taskState, r.created_at AS createdAt,
              co.title AS title, co.content AS content, co.conversation_id AS conversationId, parent.conversation_id AS parentConversationId
       FROM conversation_roles r
       JOIN content_outputs co ON co.id = r.output_id AND co.user_id = r.user_id
       LEFT JOIN content_outputs parent ON parent.id = r.parent_output_id AND parent.user_id = r.user_id
       WHERE r.role = 'sub' AND r.task_state IN ('running', 'done')
       ORDER BY r.created_at`,
      [],
    );
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
