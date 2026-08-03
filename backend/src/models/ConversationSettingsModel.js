import db from './database/index.js';

/**
 * Per-conversation context bindings — the skill/goal currently attached to a
 * conversation, plus an optional AI override (provider + model). Lives in its
 * own table so the row can be UPSERTed whenever the user attaches before any
 * message has streamed (conversation_logs only gets a row after the first
 * completed turn).
 *
 * Field semantics for upsert(): `undefined` = leave unchanged, `null` = clear.
 */
class ConversationSettingsModel {
  static get(conversationId) {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT conversation_id, user_id, active_skill_id, active_goal_id, provider, model, created_at, updated_at
         FROM conversation_settings WHERE conversation_id = ?`,
        [conversationId],
        (err, row) => {
          if (err) return reject(err);
          resolve(row || null);
        }
      );
    });
  }

  /**
   * Upsert individual fields (active_skill_id, active_goal_id, provider,
   * model). Pass `null` to clear a field. Omitted (`undefined`) fields
   * preserve their current value.
   */
  static upsert({ conversationId, userId = null, activeSkillId, activeGoalId, provider, model }) {
    return new Promise((resolve, reject) => {
      // Read current row, then INSERT OR REPLACE with merged values so a
      // partial PATCH doesn't wipe the unrelated fields.
      db.get(
        `SELECT user_id, active_skill_id, active_goal_id, provider, model FROM conversation_settings WHERE conversation_id = ?`,
        [conversationId],
        (err, existing) => {
          if (err) return reject(err);

          const mergedUserId = userId || existing?.user_id || null;
          const mergedSkill =
            activeSkillId === undefined ? existing?.active_skill_id || null : activeSkillId;
          const mergedGoal =
            activeGoalId === undefined ? existing?.active_goal_id || null : activeGoalId;
          const mergedProvider =
            provider === undefined ? existing?.provider || null : provider;
          const mergedModel =
            model === undefined ? existing?.model || null : model;

          db.run(
            `INSERT INTO conversation_settings (conversation_id, user_id, active_skill_id, active_goal_id, provider, model, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
             ON CONFLICT(conversation_id) DO UPDATE SET
               user_id = COALESCE(excluded.user_id, conversation_settings.user_id),
               active_skill_id = excluded.active_skill_id,
               active_goal_id = excluded.active_goal_id,
               provider = excluded.provider,
               model = excluded.model,
               updated_at = datetime('now')`,
            [conversationId, mergedUserId, mergedSkill, mergedGoal, mergedProvider, mergedModel],
            function (runErr) {
              if (runErr) return reject(runErr);
              resolve({
                conversationId,
                userId: mergedUserId,
                activeSkillId: mergedSkill,
                activeGoalId: mergedGoal,
                provider: mergedProvider,
                model: mergedModel,
              });
            }
          );
        }
      );
    });
  }
}

export default ConversationSettingsModel;
