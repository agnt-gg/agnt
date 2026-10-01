/**
 * useMainChat — the pinned Main chat, shared by Studio's and Focused's sidebars.
 *
 * The Main chat is an ordinary saved conversation the server marks as the
 * user's one permanent chat (backend/src/services/MainChatService.js). Opening
 * it is opening any saved conversation; this composable only knows WHICH one,
 * and how to clear it without a cached copy writing the old transcript back.
 */
import { computed, nextTick } from 'vue';
import { useStore } from 'vuex';
import { useRoute, useRouter } from 'vue-router';

export const MAIN_CHAT_LABEL = 'Main chat';

export function useMainChat() {
  const store = useStore();
  const route = useRoute();
  const router = useRouter();

  const mainChatId = computed(() => store.getters['contentOutputs/mainChatId']);
  const mainChat = computed(() => store.getters['contentOutputs/mainChatOutput']);
  const isMainUnread = computed(() => !!mainChatId.value && !!store.getters['contentOutputs/unreadOutputIdSet']?.has(mainChatId.value));
  const isMainStreaming = computed(() => !!mainChatId.value && !!store.getters['chat/streamingOutputIds']?.has(mainChatId.value));
  // Same precedence as both sidebars' active row: the route while a load is
  // in flight, then the store once it lands.
  const isMainOpen = computed(() => {
    const active = route.query['content-id'] || store.state.chat?.savedOutputId || null;
    return !!mainChatId.value && active === mainChatId.value;
  });

  async function ensureMainChatId() {
    if (mainChatId.value) return mainChatId.value;
    const main = await store.dispatch('contentOutputs/fetchMainChat');
    return main?.id || null;
  }

  /** Navigate to the Main chat. Falls back to a plain new chat if the server is unreachable. */
  async function openMainChat() {
    const id = await ensureMainChatId();
    if (!id) {
      await router.push('/chat').catch(() => {});
      return;
    }
    // Pushing the content-id the route already holds is not a navigation, so
    // Chat would never hear it. Step off it first.
    if (route.query['content-id'] === id) {
      await router.replace('/chat').catch(() => {});
      await nextTick();
    }
    await router.push({ path: '/chat', query: { 'content-id': id } }).catch(() => {});
  }

  /**
   * Empty the Main chat, after `confirm()` resolves truthy. Returns true when
   * it was cleared. Refused while a reply is still streaming into it: that
   * reply would land in a transcript the user just threw away.
   */
  async function clearMainChat(confirm) {
    const id = await ensureMainChatId();
    if (!id) return false;
    if (isMainStreaming.value) return false;
    if (typeof confirm === 'function' && !(await confirm())) return false;
    await store.dispatch('contentOutputs/clearMainChat');
    await store.dispatch('chat/detachSavedOutput', id);
    await openMainChat();
    return true;
  }

  return { mainChatId, mainChat, isMainUnread, isMainStreaming, isMainOpen, openMainChat, clearMainChat, ensureMainChatId };
}

export default useMainChat;
