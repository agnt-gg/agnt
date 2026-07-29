/**
 * Storage keys for the Workspaces page.
 *
 * This module exists so that reading workspace state never costs you the
 * workspace MODULE. useWorkspaces.js is a singleton with boot side effects —
 * it mints a workspace and writes it down on import, which is exactly what
 * makes a workspace's conversation durable. canvasBridge needs only the key,
 * and it is loaded on demand when Annie asks what is on the canvas; importing
 * useWorkspaces for a constant meant a pure READ could CREATE the very
 * workspace it was asked to report on.
 *
 * Keep this file free of imports and side effects. Anything that needs a key
 * without wanting the singleton depends on this instead.
 */

/** Workspaces + their widget instances (v2 shape). */
export const STORAGE_KEY = 'agnt:workspaces:v2';

/** Pre-widget "surfaces" shape, read once for migration. */
export const LEGACY_KEY = 'agnt:workspaces:v1';

/** Every chat surface's transcripts, keyed by channel (chatUnified owns it). */
export const CHAT_STORAGE_KEY = 'unifiedChatConversations';

/** One-shot marker for the orphaned-conversation repair pass. */
export const RECOVERY_FLAG = 'agnt:workspaces:recovered:v1';
