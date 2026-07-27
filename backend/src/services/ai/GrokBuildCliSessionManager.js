/**
 * GrokBuildCliSessionManager — maps AGNT conversations to Grok Build session ids.
 *
 * Reuses CodexThreadModel (provider-scoped) so sessions survive process restarts.
 * Session keys: grok-build::user::<userId>::conversation::<conversationId>
 */

import CodexThreadModel from '../../models/CodexThreadModel.js';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_SESSIONS = 1000;
const INIT_MAX_RETRIES = 8;
const INIT_RETRY_DELAY_MS = 300;
const DEFAULT_PROVIDER = 'grok-build';

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

  const provider = parts[0] || DEFAULT_PROVIDER;
  const userIndex = parts.indexOf('user');
  const conversationIndex = parts.indexOf('conversation');

  const userId = userIndex !== -1 ? parts[userIndex + 1] : null;
  const hasConversation = conversationIndex !== -1 && conversationIndex + 1 < parts.length;
  const conversationId = hasConversation ? parts[conversationIndex + 1] : '';
  const scope = hasConversation ? 'conversation' : 'user';

  if (!userId) return null;
  return { provider, userId, scope, conversationId };
}

class GrokBuildCliSessionManager {
  constructor() {
    this.sessions = new Map();
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
    const entries = Array.from(this.sessions.entries()).sort(
      (a, b) => a[1].lastUsedAt - b[1].lastUsedAt
    );
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
          let loaded = 0;
          for (const row of rows) {
            // CodexThreadModel.normalizeProvider treats a missing provider as
            // 'openai-codex' (legacy rows predate the column). Mirror that
            // here: only rows explicitly tagged grok-build belong to us. The
            // previous pair of guards let untagged legacy Codex rows through
            // and be adopted as Grok sessions.
            const rowProvider = String(row.provider || 'openai-codex').toLowerCase();
            if (rowProvider !== DEFAULT_PROVIDER) {
              continue;
            }
            const sessionKey = this.getSessionKey({
              userId: row.user_id,
              provider: row.provider || DEFAULT_PROVIDER,
              scope: row.scope,
              conversationId: row.scope === 'conversation' ? row.conversation_id : null,
            });
            const lastUsedAt = row.updated_at ? Date.parse(row.updated_at) || nowMs() : nowMs();
            this._setInMemory(sessionKey, row.thread_id, lastUsedAt);
            loaded += 1;
          }
          this._initialized = true;
          console.log(`[GrokBuildCliSessionManager] Loaded ${loaded} persisted Grok session(s)`);
          return;
        } catch (error) {
          const isMissingTable = error?.message && error.message.includes('no such table');
          if (isMissingTable && attempt < INIT_MAX_RETRIES) {
            await sleep(INIT_RETRY_DELAY_MS);
            continue;
          }
          console.warn('[GrokBuildCliSessionManager] Failed to initialize persisted sessions:', error);
          return;
        }
      }
    })();

    return this._initPromise;
  }

  getSessionKey({
    userId,
    conversationId,
    provider = DEFAULT_PROVIDER,
    scope = 'conversation',
  } = {}) {
    const normalizedProvider = normalizePart(provider, DEFAULT_PROVIDER).toLowerCase();
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

    const parsed = parseSessionKey(sessionKey);
    if (!parsed) return null;

    try {
      const persistedThreadId = await CodexThreadModel.findThreadId(parsed);
      if (persistedThreadId) {
        this._setInMemory(sessionKey, persistedThreadId);
        return persistedThreadId;
      }
    } catch (error) {
      console.warn('[GrokBuildCliSessionManager] Failed to load persisted session:', error);
    }

    return null;
  }

  setThreadId(sessionKey, threadId) {
    if (!sessionKey || !threadId) return null;
    this._cleanupExpiredSessions();
    const storedThreadId = this._setInMemory(sessionKey, threadId);

    const parsed = parseSessionKey(sessionKey);
    if (parsed?.userId) {
      CodexThreadModel.upsert({
        userId: parsed.userId,
        provider: parsed.provider || DEFAULT_PROVIDER,
        scope: parsed.scope,
        conversationId: parsed.scope === 'conversation' ? parsed.conversationId : '',
        threadId: storedThreadId,
      }).catch((error) => {
        console.warn('[GrokBuildCliSessionManager] Failed to persist session ID:', error);
      });
    }

    return storedThreadId;
  }

  touch(sessionKey) {
    if (!sessionKey) return;
    this.init().catch(() => {});
    const session = this.sessions.get(sessionKey);
    if (session) {
      session.lastUsedAt = nowMs();
    }
  }
}

export default new GrokBuildCliSessionManager();
