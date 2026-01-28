import db from './database/index.js';

function normalizeConversationId(conversationId) {
  if (!conversationId) return '';
  return String(conversationId);
}

function normalizeScope(scope) {
  return scope === 'user' ? 'user' : 'conversation';
}

function normalizeProvider(provider) {
  if (!provider) return 'openai-codex-cli';
  return String(provider).toLowerCase();
}

class CodexThreadModel {
  static async upsert({ userId, provider, scope, conversationId, threadId }) {
    if (!userId || !threadId) return;

    const normalizedProvider = normalizeProvider(provider);
    const normalizedScope = normalizeScope(scope);
    const normalizedConversationId = normalizedScope === 'conversation' ? normalizeConversationId(conversationId) : '';

    const query = `
      INSERT INTO codex_threads (user_id, provider, scope, conversation_id, thread_id, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, provider, scope, conversation_id)
      DO UPDATE SET
        thread_id = excluded.thread_id,
        updated_at = CURRENT_TIMESTAMP
    `;

    const params = [String(userId), normalizedProvider, normalizedScope, normalizedConversationId, String(threadId)];

    return new Promise((resolve, reject) => {
      db.run(query, params, (err) => {
        if (err) {
          console.error('[CodexThreadModel] Failed to upsert codex thread:', err);
          return reject(err);
        }
        resolve();
      });
    });
  }

  static async findThreadId({ userId, provider, scope, conversationId }) {
    if (!userId) return null;

    const normalizedProvider = normalizeProvider(provider);
    const normalizedScope = normalizeScope(scope);
    const normalizedConversationId = normalizedScope === 'conversation' ? normalizeConversationId(conversationId) : '';

    const query = `
      SELECT thread_id
      FROM codex_threads
      WHERE user_id = ?
        AND provider = ?
        AND scope = ?
        AND conversation_id = ?
      LIMIT 1
    `;

    const params = [String(userId), normalizedProvider, normalizedScope, normalizedConversationId];

    return new Promise((resolve, reject) => {
      db.get(query, params, (err, row) => {
        if (err) {
          // Table might not exist yet during very early startup; treat as no result.
          if (err.message && err.message.includes('no such table')) {
            return resolve(null);
          }
          console.error('[CodexThreadModel] Failed to find codex thread:', err);
          return reject(err);
        }
        resolve(row?.thread_id ? String(row.thread_id) : null);
      });
    });
  }

  static async listAll() {
    const query = `
      SELECT user_id, provider, scope, conversation_id, thread_id, updated_at
      FROM codex_threads
    `;

    return new Promise((resolve, reject) => {
      db.all(query, [], (err, rows) => {
        if (err) {
          // Table might not exist yet during very early startup; treat as empty.
          if (err.message && err.message.includes('no such table')) {
            return resolve([]);
          }
          console.error('[CodexThreadModel] Failed to list codex threads:', err);
          return reject(err);
        }
        resolve(rows || []);
      });
    });
  }
}

export default CodexThreadModel;

