/**
 * What you can do to a saved conversation: rename it, mark it read or unread,
 * archive it, delete it. One implementation for every list that offers them
 * (Studio's chat list, Focused's sidebar), so they cannot drift.
 *
 * Each change is optimistic: the list updates at once, the request runs in
 * the background, and a failure puts the row back and rejects, so the caller
 * can say so. The caller owns all UI (prompts, confirmations, navigation).
 */

/** Rename. Resolves when saved; on failure the old title is restored, then it rejects. */
export async function renameConversation(store, output, title) {
  const trimmed = String(title || '').trim();
  if (!output?.id || !trimmed || trimmed === output.title) return;
  const originalTitle = output.title;
  store.commit('contentOutputs/PATCH_OUTPUT', { id: output.id, updates: { title: trimmed } });
  try {
    await store.dispatch('chat/updateConversationTitle', { outputId: output.id, title: trimmed });
  } catch (error) {
    store.commit('contentOutputs/PATCH_OUTPUT', { id: output.id, updates: { title: originalTitle } });
    throw error;
  }
}

/** Mark read or unread. The store rolls its own optimistic flip back on failure. */
export function setConversationRead(store, outputId, read) {
  if (!outputId) return Promise.resolve();
  return store.dispatch(read ? 'contentOutputs/markRead' : 'contentOutputs/markUnread', outputId);
}

/** Archive or unarchive. */
export function setConversationArchived(store, outputId, archived) {
  if (!outputId) return Promise.resolve();
  return store.dispatch('contentOutputs/setArchived', { outputId, archived: !!archived });
}

/** Delete. The row leaves the list at once; on failure it comes back, then it rejects. */
export async function deleteConversation(store, output) {
  if (!output?.id) return;
  store.commit('contentOutputs/REMOVE_OUTPUT', output.id);
  try {
    await store.dispatch('contentOutputs/deleteOutput', output.id);
  } catch (error) {
    store.commit('contentOutputs/ADD_OUTPUT', output);
    throw error;
  }
}
