/**
 * Open a saved output that is NOT a conversation (old HTML snapshots from
 * before outputs were saved as conversations) in a chat slot of its own.
 *
 * It used to be appended to whatever conversation was on screen, which put an
 * unrelated old answer into the user's current chat. These records carry no
 * conversation, tool or workflow id, so there is no origin to reopen; the
 * snapshot gets its own slot, keyed by the output id, and reopening it
 * switches back to that slot rather than duplicating or overwriting it.
 *
 * No savedOutputId is set on purpose: if the user replies in this slot, the
 * reply autosaves as a NEW conversation and the old snapshot is never
 * rewritten into a different format.
 *
 * @returns {string} the slot id that is now active
 */
export function openLegacyOutputSlot(store, { contentId, output, messageId }) {
  const slotId = `saved-${contentId}`;
  if (!store.state.chat.conversations?.[slotId]) {
    const createdAt = output?.created_at ? new Date(output.created_at) : new Date();
    store.commit('chat/ENSURE_CONVERSATION', slotId);
    store.commit('chat/SCOPED_SET_MESSAGES', {
      conversationId: slotId,
      messages: [
        {
          id: messageId,
          role: 'assistant',
          content: output?.content || '',
          timestamp: createdAt.getTime(),
          metadata: ['Saved output', `Created: ${createdAt.toLocaleDateString()}`],
        },
      ],
    });
  }
  store.commit('chat/SET_ACTIVE_CONVERSATION', slotId);
  return slotId;
}
