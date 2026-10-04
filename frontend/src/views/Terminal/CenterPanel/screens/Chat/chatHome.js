/**
 * Whether a conversation is still at its start screen: nobody has spoken yet
 * (only the greeting, if anything), and no provider-setup card is waiting.
 *
 * One rule for both halves of Focused's home: Chat.vue swaps the transcript
 * for the hero, and FocusedShell drops the title bar. They used to decide
 * separately. A blank Main chat has a title ("Main chat"), so the shell drew a
 * 48px bar over a screen Chat was centring as a home, and the whole home sat
 * 24px lower than a new chat's.
 */
export function isUnstartedConversation(messages) {
  const list = Array.isArray(messages) ? messages : [];
  if (list.some((m) => m?.showProviderSetup)) return false;
  return !list.some((m) => m?.role === 'user');
}
