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
import { acquireConversationSave } from './conversationSaveLock.js';
import { randomUUID } from 'crypto';
import ContentOutputModel from '../models/ContentOutputModel.js';
import ConversationRoleModel from '../models/ConversationRoleModel.js';
import { serializeTranscript } from './orchestrator/transcriptProjection.js';
import { broadcastToUser, RealtimeEvents } from '../utils/realtimeSync.js';

export const MAIN_CHAT_TITLE = 'Main chat';

/**
 * RETIRED. The Main chat was a pinned conversation every new chat landed in.
 * With its sidebar row removed, anything typed into it became invisible, so a
 * cold start and every "ask" now open an ordinary conversation instead, and an
 * existing Main chat is handed back as one (releaseMainChat). ensure/clear are
 * kept, unrouted, so the change is reversible; nothing in the app calls them.
 */

/** The first line of the first thing the user said, as a list title. */
function titleFromTranscript(content) {
  let transcript;
  try { transcript = JSON.parse(content || '{}'); } catch { return null; }
  const messages = Array.isArray(transcript) ? transcript : transcript?.messages;
  const first = (Array.isArray(messages) ? messages : []).find((m) => m?.role === 'user' && typeof m.content === 'string' && m.content.trim());
  if (!first) return null;
  const line = first.content.trim().split(/\r?\n/)[0].trim();
  return line.length > 60 ? `${line.slice(0, 57).trimEnd()}...` : line;
}

/**
 * Turn the user's Main chat back into an ordinary conversation. Idempotent.
 *
 * A Main chat with something in it keeps every message, loses its pin, and is
 * named after its first request (only while it still carries the generic
 * system title; a name the user chose is kept). One that was never used is
 * archived, not deleted, so nothing is lost and the list gains no empty
 * "Main chat" row.
 *
 * @returns {Promise<{id: string, action: 'released'|'archived'}|null>}
 */
export function releaseMainChat(userId) {
  if (!userId) return Promise.reject(new Error('userId is required'));
  return serialized(userId, async () => {
    const id = await ConversationRoleModel.findMainOutputId(userId);
    if (!id) {
      await ConversationRoleModel.releaseMain(userId); // a role whose row was deleted
      return null;
    }
    const row = await ContentOutputModel.findOne(id);
    const title = titleFromTranscript(row?.content);
    await ConversationRoleModel.releaseMain(userId);
    if (!title) {
      await ContentOutputModel.setArchived(id, userId, true);
      return { id, action: 'archived' };
    }
    // setGeneratedTitle only overwrites derived/auto titles; this one is
    // 'system'. The guard keeps any name the user gave it.
    if (row?.title === MAIN_CHAT_TITLE) await ContentOutputModel.updateTitle(id, userId, title);
    const output = await ContentOutputModel.findMetaById(id);
    if (output) announce(userId, RealtimeEvents.CONTENT_UPDATED, output);
    return { id, action: 'released' };
  });
}

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
      { titleSource: 'system' },
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
    const release = await acquireConversationSave(userId, 'content-outputs');
    try {
      const conversationId = randomUUID();
      await ContentOutputModel.createOrUpdate(
        main.id, userId, null, null, emptyTranscript(conversationId), false, 'conversation', conversationId, MAIN_CHAT_TITLE,
        { titleSource: 'system' },
      );
      // Clearing is something the user did: it must not light an unread dot.
      await ContentOutputModel.setReadState(main.id, userId, true);
      const output = await ContentOutputModel.findMetaById(main.id);
      announce(userId, RealtimeEvents.CONTENT_UPDATED, output);
      return output;
    } finally { release(); }
  }));
}

/**
 * What the sidebar asks for on mount: sub-chat links, and never a Main chat.
 * Any Main chat this user still has is released first, so clients still on a
 * build that pins it get its conversation back in their ordinary list.
 */
export async function getMainChatState(userId) {
  await releaseMainChat(userId);
  return { main: null, subChats: await ConversationRoleModel.listSubChats(userId) };
}

export default { ensureMainChat, clearMainChat, releaseMainChat, getMainChatState, MAIN_CHAT_TITLE };
