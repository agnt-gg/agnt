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

/** The role section for this conversation, or '' when it has no role. Never throws. */
export async function loadConversationRoleSection(context, models = { ContentOutputModel, ConversationRoleModel }) {
  const { conversationId, userId } = context || {};
  if (!conversationId || !userId) return '';
  try {
    const row = await models.ContentOutputModel.findMetaByConversationId(conversationId, userId);
    if (!row) return '';
    const role = await models.ConversationRoleModel.roleOf(row.id, userId);
    if (role?.role === 'main') return buildMainChatSection();
    if (role?.role === 'sub') return buildSubChatSection();
    return '';
  } catch (error) {
    // A missing section costs guidance, never the turn.
    console.warn('[ConversationRole] Could not resolve role:', error?.message || error);
    return '';
  }
}

export default { loadConversationRoleSection, buildMainChatSection, buildSubChatSection };
