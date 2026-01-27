const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_SESSIONS = 1000;

function nowMs() {
  return Date.now();
}

function normalizePart(value, fallback) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  return String(value);
}

class CodexCliSessionManager {
  constructor() {
    this.sessions = new Map(); // sessionKey -> { threadId, lastUsedAt }
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

  getSessionKey({ userId, conversationId, provider = 'openai-codex-cli', scope = 'conversation' } = {}) {
    const normalizedProvider = normalizePart(provider, 'openai-codex-cli').toLowerCase();
    const normalizedUserId = normalizePart(userId, 'anonymous-user');

    if (scope === 'user') {
      return `${normalizedProvider}::user::${normalizedUserId}`;
    }

    const normalizedConversationId = normalizePart(conversationId, 'default-conversation');
    return `${normalizedProvider}::user::${normalizedUserId}::conversation::${normalizedConversationId}`;
  }

  getThreadId(sessionKey) {
    if (!sessionKey) return null;
    this._cleanupExpiredSessions();
    const session = this.sessions.get(sessionKey);
    if (!session?.threadId) return null;
    session.lastUsedAt = nowMs();
    return session.threadId;
  }

  setThreadId(sessionKey, threadId) {
    if (!sessionKey || !threadId) return null;
    this._cleanupExpiredSessions();
    const existing = this.sessions.get(sessionKey) || {};
    const session = {
      threadId: String(threadId),
      lastUsedAt: nowMs(),
      createdAt: existing.createdAt || nowMs(),
    };
    this.sessions.set(sessionKey, session);
    this._enforceLimit();
    return session.threadId;
  }

  touch(sessionKey) {
    if (!sessionKey) return;
    const session = this.sessions.get(sessionKey);
    if (session) {
      session.lastUsedAt = nowMs();
    }
  }
}

export default new CodexCliSessionManager();

