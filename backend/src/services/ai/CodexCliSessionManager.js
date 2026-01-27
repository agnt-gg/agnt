import CodexThreadModel from '../../models/CodexThreadModel.js';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_SESSIONS = 1000;
const INIT_MAX_RETRIES = 8;
const INIT_RETRY_DELAY_MS = 300;

function nowMs() {
  return Date.now();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizePart(value, fallback) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  return String(value);
}

function parseSessionKey(sessionKey) {
  if (!sessionKey || typeof sessionKey !== 'string') return null;
  const parts = sessionKey.split('::');
  if (parts.length < 3) return null;

  const provider = parts[0] || 'openai-codex-cli';
  const userIndex = parts.indexOf('user');
  const conversationIndex = parts.indexOf('conversation');

  const userId = userIndex !== -1 ? parts[userIndex + 1] : null;
  const hasConversation = conversationIndex !== -1 && conversationIndex + 1 < parts.length;
  const conversationId = hasConversation ? parts[conversationIndex + 1] : '';
  const scope = hasConversation ? 'conversation' : 'user';

  if (!userId) return null;
  return { provider, userId, scope, conversationId };
}

class CodexCliSessionManager {
  constructor() {
    this.sessions = new Map(); // sessionKey -> { threadId, lastUsedAt }
    this._initPromise = null;
    this._initialized = false;
  }

  _cleanupExpiredSessions() {
    const now = nowMs();
    for (const [key, session] of this.sessions.entries()) {
      if (!session || now - session.lastUsedAt > SESSION_TTL_MS) {
        this.sessions.delete(key);
      }
    }
  }

  _enforceLimit() {
    if (this.sessions.size <= MAX_SESSIONS) return;

    // Remove the least recently used sessions first.
    const entries = Array.from(this.sessions.entries()).sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt);
    const overflow = entries.length - MAX_SESSIONS;
    for (let i = 0; i < overflow; i += 1) {
      this.sessions.delete(entries[i][0]);
    }
  }

  _setInMemory(sessionKey, threadId, lastUsedAt = nowMs()) {
    const existing = this.sessions.get(sessionKey) || {};
    const session = {
      threadId: String(threadId),
      lastUsedAt,
      createdAt: existing.createdAt || lastUsedAt,
    };
    this.sessions.set(sessionKey, session);
    this._enforceLimit();
    return session.threadId;
  }

  async init() {
    if (this._initialized) return;
    if (this._initPromise) return this._initPromise;

    this._initPromise = (async () => {
      for (let attempt = 1; attempt <= INIT_MAX_RETRIES; attempt += 1) {
        try {
          const rows = await CodexThreadModel.listAll();
          for (const row of rows) {
            const sessionKey = this.getSessionKey({
              userId: row.user_id,
              provider: row.provider,
              scope: row.scope,
              conversationId: row.scope === 'conversation' ? row.conversation_id : null,
            });

            const lastUsedAt = row.updated_at ? Date.parse(row.updated_at) || nowMs() : nowMs();
            this._setInMemory(sessionKey, row.thread_id, lastUsedAt);
          }

          this._initialized = true;
          console.log(`[CodexCliSessionManager] Loaded ${rows.length} persisted Codex thread(s)`);
          return;
        } catch (error) {
          const isMissingTable = error?.message && error.message.includes('no such table');
          if (isMissingTable && attempt < INIT_MAX_RETRIES) {
            await sleep(INIT_RETRY_DELAY_MS);
            continue;
          }
          console.warn('[CodexCliSessionManager] Failed to initialize persisted threads:', error);
          return;
        }
      }
    })();

    return this._initPromise;
  }

  getSessionKey({ userId, conversationId, provider = 'openai-codex-cli', scope = 'conversation' } = {}) {
    const normalizedProvider = normalizePart(provider, 'openai-codex-cli').toLowerCase();
    const normalizedUserId = normalizePart(userId, 'anonymous-user');

    if (scope === 'user') {
      return `${normalizedProvider}::user::${normalizedUserId}`;
    }

    const normalizedConversationId = normalizePart(conversationId, 'default-conversation');
    return `${normalizedProvider}::user::${normalizedUserId}::conversation::${normalizedConversationId}`;
  }

  async getThreadId(sessionKey) {
    if (!sessionKey) return null;
    await this.init();
    this._cleanupExpiredSessions();
    const session = this.sessions.get(sessionKey);
    if (session?.threadId) {
      session.lastUsedAt = nowMs();
      return session.threadId;
    }

    // Not in memory yet; attempt to load from persistence.
    const parsed = parseSessionKey(sessionKey);
    if (!parsed) return null;

    try {
      const persistedThreadId = await CodexThreadModel.findThreadId(parsed);
      if (persistedThreadId) {
        this._setInMemory(sessionKey, persistedThreadId);
        return persistedThreadId;
      }
    } catch (error) {
      console.warn('[CodexCliSessionManager] Failed to load persisted thread:', error);
    }

    return null;
  }

  setThreadId(sessionKey, threadId) {
    if (!sessionKey || !threadId) return null;
    this._cleanupExpiredSessions();
    const storedThreadId = this._setInMemory(sessionKey, threadId);

    // Persist asynchronously so future process restarts can resume.
    const parsed = parseSessionKey(sessionKey);
    if (parsed?.userId) {
      CodexThreadModel.upsert({
        userId: parsed.userId,
        provider: parsed.provider,
        scope: parsed.scope,
        conversationId: parsed.scope === 'conversation' ? parsed.conversationId : '',
        threadId: storedThreadId,
      }).catch((error) => {
        console.warn('[CodexCliSessionManager] Failed to persist thread ID:', error);
      });
    }

    return storedThreadId;
  }

  touch(sessionKey) {
    if (!sessionKey) return;
    // Fire-and-forget initialization to reduce race windows.
    this.init().catch(() => {});
    const session = this.sessions.get(sessionKey);
    if (session) {
      session.lastUsedAt = nowMs();
    }
  }
}

export default new CodexCliSessionManager();
