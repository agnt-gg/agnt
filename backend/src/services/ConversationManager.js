/**
 * Conversation Manager
 * Keeps conversation contexts alive after SSE responses end
 * Enables autonomous AI messages without user interaction
 */

import log from '../utils/logger.js';

class ConversationManager {
  constructor() {
    // Map of active conversations
    // Key: conversationId, Value: conversation context
    this.conversations = new Map();

    // Conversation expiry time (24 hours of inactivity)
    this.expiryMs = 24 * 60 * 60 * 1000;

    // Start cleanup timer
    this.startCleanupTimer();
  }

  /**
   * Store conversation context for later autonomous messages
   * @param {string} conversationId - Conversation ID
   * @param {object} context - Conversation context
   */
  store(conversationId, context) {
    // Deep clone messages to avoid reference issues
    const clonedContext = {
      ...context,
      messages: context.messages ? JSON.parse(JSON.stringify(context.messages)) : [],
      lastActivity: Date.now(),
      createdAt: this.conversations.has(conversationId)
        ? this.conversations.get(conversationId).createdAt
        : Date.now(),
    };

    this.conversations.set(conversationId, clonedContext);

    log(`[ConversationManager] Stored context for conversation ${conversationId} (${clonedContext.messages.length} messages)`);
  }

  /**
   * Get conversation context
   * @param {string} conversationId
   * @returns {object|null} - Conversation context or null if not found
   */
  get(conversationId) {
    return this.conversations.get(conversationId) || null;
  }

  /**
   * Update conversation with new messages
   * @param {string} conversationId
   * @param {array} newMessages - Array of messages to append
   */
  appendMessages(conversationId, newMessages) {
    const context = this.conversations.get(conversationId);
    if (!context) {
      console.warn(`[ConversationManager] Cannot append messages - conversation ${conversationId} not found`);
      return false;
    }

    context.messages.push(...newMessages);
    context.lastActivity = Date.now();

    log(`[ConversationManager] Appended ${newMessages.length} message(s) to conversation ${conversationId}`);
    return true;
  }

  /**
   * Update last activity timestamp
   * @param {string} conversationId
   */
  touch(conversationId) {
    const context = this.conversations.get(conversationId);
    if (context) {
      context.lastActivity = Date.now();
    }
  }

  /**
   * Check if conversation exists and is active
   * @param {string} conversationId
   * @returns {boolean}
   */
  isActive(conversationId) {
    const context = this.conversations.get(conversationId);
    if (!context) return false;

    const age = Date.now() - context.lastActivity;
    return age < this.expiryMs;
  }

  /**
   * Delete conversation context
   * @param {string} conversationId
   */
  delete(conversationId) {
    const existed = this.conversations.delete(conversationId);
    if (existed) {
      log(`[ConversationManager] Deleted conversation ${conversationId}`);
    }
    return existed;
  }

  /**
   * Cleanup expired conversations periodically
   */
  startCleanupTimer() {
    setInterval(() => {
      const now = Date.now();
      let cleanedCount = 0;

      for (const [conversationId, context] of this.conversations.entries()) {
        const age = now - context.lastActivity;
        if (age > this.expiryMs) {
          this.conversations.delete(conversationId);
          cleanedCount++;
        }
      }

      if (cleanedCount > 0) {
        log(`[ConversationManager] Cleaned up ${cleanedCount} expired conversation(s)`);
      }
    }, 60 * 60 * 1000); // Check every hour
  }

  /**
   * Get statistics
   */
  getStats() {
    const contexts = Array.from(this.conversations.values());
    const now = Date.now();

    return {
      total: contexts.length,
      active: contexts.filter((c) => now - c.lastActivity < 60 * 60 * 1000).length, // Active in last hour
      totalMessages: contexts.reduce((sum, c) => sum + c.messages.length, 0),
      avgMessagesPerConversation: contexts.length > 0
        ? Math.round(contexts.reduce((sum, c) => sum + c.messages.length, 0) / contexts.length)
        : 0,
    };
  }

  /**
   * Get all active conversation IDs
   */
  getActiveConversationIds() {
    const now = Date.now();
    return Array.from(this.conversations.entries())
      .filter(([_, context]) => now - context.lastActivity < this.expiryMs)
      .map(([conversationId, _]) => conversationId);
  }
}

// Singleton instance
const conversationManager = new ConversationManager();
export default conversationManager;
