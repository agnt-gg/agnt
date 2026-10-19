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
  return !list.some((m) => m?.role === 'user');
}

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
