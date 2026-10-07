/**
 * conversationRole — what the Main chat and its sub-chats are for.
 *
 * The Main chat is the one place the user talks to; it hands real work to new
 * conversations (start_chat) and reports their results. A sub-chat is the
 * worker: it does one task to completion, and its final message is what the
 * Main chat reads back.
 *
 * Appended at the TAIL of the assembled prompt, like the voice register: the
 * role is fixed for the life of a conversation, so it never disturbs the
 * cached prefix ahead of it.
 */
import ContentOutputModel from '../../../models/ContentOutputModel.js';
import ConversationRoleModel from '../../../models/ConversationRoleModel.js';

export function buildMainChatSection() {
  return [
    '## THIS IS THE MAIN CHAT — YOU ARE THE PROJECT MANAGER',
    '',
    'The user keeps one permanent conversation with you: this one. They should never',
    'have to leave it. You keep it clear by handing real work to workers.',
    '',
    '- Answer quick questions, decisions and small lookups yourself, right here.',
    '- Any substantial task (research, building, writing, analysis, multi-step tool',
    '  work) goes to a NEW chat with start_chat. Write its prompt as a complete,',
    '  self-contained brief: the new chat cannot see this conversation.',
    '- Independent tasks run in parallel: one start_chat call per task.',
    '- After starting work, say in one line what you started and stop. Do not wait,',
    '  poll, or guess at the result.',
    '- Each worker reports back here automatically when it finishes. Relay the outcome',
    '  briefly, name the chat it lives in, and propose the next step.',
    '- If the user has a phone linked, that relay is also texted to them, so they hear',
    '  back wherever they are. Do not text it yourself.',
  ].join('\n');
}

export function buildSubChatSection() {
  return [
    '## THIS IS A SUB-CHAT — YOU ARE THE WORKER',
    '',
    'The Main chat started this conversation to do the task in the first message.',
    'Do it completely here; no one is waiting to answer questions, so make reasonable',
    'choices and state them. You cannot start further chats.',
    '',
    'Your FINAL message is reported back to the Main chat. End with a short, plain',
    'summary: what you did, what you found or made (with file paths or links), and',
    'anything that still needs the user.',
  ].join('\n');
}

/**
 * 'main' | 'sub' | null for this conversation. Fixed for its life (the role row
 * is written before its first turn), so it is resolved once per context. An
 * unsaved conversation has no role; a lookup failure reads as no role.
 */
export async function conversationRoleOf(context, models = { ContentOutputModel, ConversationRoleModel }) {
  const { conversationId, userId } = context || {};
  if (!conversationId || !userId) return null;
  // Cached per conversation: a context object may be reused across conversations.
  if (context._conversationRole?.conversationId === conversationId) return context._conversationRole.role;
  let role = null;
  try {
    const row = await models.ContentOutputModel.findMetaByConversationId(conversationId, userId);
    if (row) role = (await models.ConversationRoleModel.roleOf(row.id, userId))?.role || null;
  } catch (error) {
    console.warn('[ConversationRole] Could not resolve role:', error?.message || error);
    return null; // not cached: the next turn tries again
  }
  const resolved = role === 'main' || role === 'sub' ? role : null;
  context._conversationRole = { conversationId, role: resolved };
  return resolved;
}

/**
 * Tools only the Main chat has. Every other conversation would otherwise be
 * offered start_chat (it rides in DEFAULT_TOOLS) and could spawn "sub-chats"
 * of its own — reported 2026-10-07. startSubChat refuses them too.
 */
export const MAIN_CHAT_ONLY_TOOLS = Object.freeze(new Set(['start_chat']));

/** Drop Main-chat-only tools from any other conversation's surface. */
export async function withoutMainChatOnlyTools(schemas, context, models) {
  if (!Array.isArray(schemas) || !schemas.some((s) => MAIN_CHAT_ONLY_TOOLS.has(s?.function?.name))) return schemas;
  if ((await conversationRoleOf(context, models)) === 'main') return schemas;
  return schemas.filter((s) => !MAIN_CHAT_ONLY_TOOLS.has(s?.function?.name));
}

/** The role section for this conversation, or '' when it has no role. Never throws. */
export async function loadConversationRoleSection(context, models = { ContentOutputModel, ConversationRoleModel }) {
  const role = await conversationRoleOf(context, models);
  if (role === 'main') return buildMainChatSection();
  if (role === 'sub') return buildSubChatSection();
  return '';
}

export default { loadConversationRoleSection, conversationRoleOf, withoutMainChatOnlyTools, buildMainChatSection, buildSubChatSection };
