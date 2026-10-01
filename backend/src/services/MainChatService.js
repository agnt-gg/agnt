/**
 * MainChatService — the one conversation every user always has.
 *
 * The Main chat is an ordinary saved conversation (a content_outputs row) that
 * conversation_roles marks as role 'main'. Being ordinary is the point: it is
 * loaded, streamed, autosaved, searched and remembered by exactly the code
 * every other conversation uses. This file only answers three questions:
 *
 *   ensure — which row is it? (created on first ask)
 *   clear  — empty it, keeping the same row and its sub-chat links
 *   links  — which conversations were started from which (for the sidebar)
 */
import { randomUUID } from 'crypto';
import ContentOutputModel from '../models/ContentOutputModel.js';
import ConversationRoleModel from '../models/ConversationRoleModel.js';
import { serializeTranscript } from './orchestrator/transcriptProjection.js';
import { broadcastToUser, RealtimeEvents } from '../utils/realtimeSync.js';

export const MAIN_CHAT_TITLE = 'Main chat';

// Get-or-create must not race itself: two tabs booting at once would each see
// "no main" and each create one. The partial unique index would reject the
// second role row, but only after a second orphan conversation was written.
// One backend process owns this database, so a per-user promise chain is a
// complete answer.
const pendingByUser = new Map();
function serialized(userId, task) {
  const previous = pendingByUser.get(userId) || Promise.resolve();
  const next = previous.catch(() => {}).then(task);
  const settled = next.finally(() => {
    if (pendingByUser.get(userId) === settled) pendingByUser.delete(userId);
  });
  pendingByUser.set(userId, settled);
  return next;
}

function emptyTranscript(conversationId) {
  return serializeTranscript({ conversationId, title: MAIN_CHAT_TITLE, messages: [] });
}

function announce(userId, eventName, output) {
  broadcastToUser(userId, eventName, {
    id: output.id,
    title: output.title,
    contentType: 'conversation',
    userId,
    output,
    timestamp: new Date().toISOString(),
  });
}

/** The user's Main chat row (list metadata, no content). Created if missing. */
export function ensureMainChat(userId) {
  if (!userId) return Promise.reject(new Error('userId is required'));
  return serialized(userId, async () => {
    const existingId = await ConversationRoleModel.findMainOutputId(userId);
    if (existingId) {
      const output = await ContentOutputModel.findMetaById(existingId);
      if (output) return output;
    }
    const outputId = randomUUID();
    const conversationId = randomUUID();
    await ContentOutputModel.createOrUpdate(
      outputId, userId, null, null, emptyTranscript(conversationId), false, 'conversation', conversationId, MAIN_CHAT_TITLE,
    );
    await ConversationRoleModel.setMain(userId, outputId);
    const output = await ContentOutputModel.findMetaById(outputId);
    announce(userId, RealtimeEvents.CONTENT_CREATED, output);
    return output;
  });
}

/**
 * Empty the Main chat.
 *
 * Same row id — so the sidebar entry, and every sub-chat's parent link, stay
 * put — but a NEW conversation id. The old id names server-side history
 * (conversation_logs, cached context); reusing it would let the next turn
 * resume the very conversation the user just cleared.
 */
export function clearMainChat(userId) {
  if (!userId) return Promise.reject(new Error('userId is required'));
  return ensureMainChat(userId).then((main) => serialized(userId, async () => {
    const conversationId = randomUUID();
    await ContentOutputModel.createOrUpdate(
      main.id, userId, null, null, emptyTranscript(conversationId), false, 'conversation', conversationId, MAIN_CHAT_TITLE,
    );
    // Clearing is something the user did: it must not light an unread dot.
    await ContentOutputModel.setReadState(main.id, userId, true);
    const output = await ContentOutputModel.findMetaById(main.id);
    announce(userId, RealtimeEvents.CONTENT_UPDATED, output);
    return output;
  }));
}

/** The Main chat plus every sub-chat link, in one call for the sidebar. */
export async function getMainChatState(userId) {
  const [main, subChats] = await Promise.all([ensureMainChat(userId), ConversationRoleModel.listSubChats(userId)]);
  return { main, subChats };
}

export default { ensureMainChat, clearMainChat, getMainChatState, MAIN_CHAT_TITLE };
