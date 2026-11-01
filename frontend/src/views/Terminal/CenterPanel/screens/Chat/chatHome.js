import { isGreeting } from './providerGreeting.js';

/**
 * Whether a conversation is still at its start screen: nobody has spoken yet
 * (only the greeting, if anything), and no provider-setup card is waiting.
 *
 * One rule for both halves of AGNT One's home: Chat.vue swaps the transcript
 * for the welcome, and OneShell drops the title. They used to decide
 * separately (in Focused). A blank Main chat has a title ("Main chat"), so the
 * shell drew a 48px bar over a screen Chat was centring as a home, and the
 * whole home sat 24px lower than a new chat's.
 */
export function isUnstartedConversation(messages) {
  const list = Array.isArray(messages) ? messages : [];
  if (list.some((m) => m?.showProviderSetup)) return false;
  // Started once anyone has said something real. Not only the user: a conversation
  // AGNT opens itself (a flagged issue, a scheduled report, a text) starts with an
  // assistant message and no user turn, and used to open to the empty home.
  return !list.some((m) => m?.role === 'user' || (m?.role === 'assistant' && !isGreeting(m) && hasContent(m)));
}

const hasContent = (m) => (typeof m.content === 'string' && m.content.trim() !== '')
  || (Array.isArray(m.contentParts) && m.contentParts.length > 0)
  || (Array.isArray(m.toolCalls) && m.toolCalls.length > 0);

/**
 * The transcript AGNT One draws: without the welcome greeting, which One's
 * home already said. Kept, it reappeared above the first message with its
 * status chips once the conversation started. Display only: the store,
 * autosave and history still hold it. The provider-setup card is a greeting
 * too, but it is the one thing a new user must act on, so it always stays.
 */
export function withoutWelcome(messages) {
  const list = Array.isArray(messages) ? messages : [];
  return list.filter((m) => !(isGreeting(m) && !m.showProviderSetup));
}
