import { inject, provide, computed, unref } from 'vue';

/**
 * Which conversation a transcript's browser cards belong to.
 *
 * Each conversation drives its own browser tab (backend browserLanes.js), so a
 * live card must ask for THIS conversation's browser. MessageItem renders in
 * several chat surfaces and does not know which conversation it is in; the
 * surface that owns the transcript provides it here.
 *
 * Three states, kept distinct on purpose:
 *   - a real id    — watch that conversation's browser;
 *   - ''           — this surface has no conversation id (the sidebar
 *                    forges); its turns use the shared default browser;
 *   - null         — the conversation is still on a client-side `temp-` id.
 *                    The server replaces it when the turn starts. A card
 *                    rendered now would open a browser under an id nobody will
 *                    use again, so it waits for the real one instead.
 */
const BROWSER_CONVERSATION = Symbol('browser-conversation-id');

export function normaliseConversationId(id) {
  const value = typeof id === 'string' ? id.trim() : '';
  if (value.startsWith('temp-')) return null;
  return value;
}

/** @param {import('vue').Ref<string>|(() => string)|string} source */
export function provideBrowserConversation(source) {
  provide(BROWSER_CONVERSATION, computed(() => normaliseConversationId(
    typeof source === 'function' ? source() : unref(source),
  )));
}

/** The provided conversation id; '' when no surface provided one. */
export function useBrowserConversation() {
  return inject(BROWSER_CONVERSATION, computed(() => ''));
}
