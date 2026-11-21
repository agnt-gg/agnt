/**
 * useStudioPageNav — what AGNT One's pages ask their frame for (`focusedNav`),
 * answered by a Studio screen that shows one of those pages in its center panel
 * (Team, Plugins). OneShell provides the same service in One.
 *
 * Every move is a route push, so Back and links work. Dialogs go through the
 * screen's own SimpleModal: bind `modalRef` to it, and show `toastText`.
 */
import { nextTick, onBeforeUnmount, ref } from 'vue';
import { useRouter } from 'vue-router';
import { screenRoute } from '@/views/Terminal/screenRoute.js';

const TOAST_MS = 2600;
const ASK_SEED_DELAY_MS = 300;

export function useStudioPageNav() {
  const router = useRouter();

  function pushScreen(screen, opts = {}) {
    const target = screenRoute(screen, opts);
    if (target) router.push({ path: target.path, query: target.query }).catch(() => {});
  }
  const chat = () => router.push('/chat').catch(() => {});
  const openConversation = (outputId) => router.push({ path: '/chat', query: { 'content-id': outputId } }).catch(() => {});
  /** A new chat with the request typed in; nothing is sent until Enter. */
  async function ask(text) {
    await router.push('/chat').catch(() => {});
    await nextTick();
    window.dispatchEvent(new CustomEvent('trigger-new-chat'));
    setTimeout(() => window.dispatchEvent(new CustomEvent('agnt:ask-annie', { detail: { text, send: false } })), ASK_SEED_DELAY_MS);
  }

  const modalRef = ref(null);
  function confirm({ title, message, confirmText = 'OK', danger = false }) {
    return modalRef.value?.showModal({ title, message, confirmText, cancelText: 'Cancel', showCancel: true, confirmClass: danger ? 'btn-danger' : 'btn-primary' });
  }
  async function prompt({ title, message, placeholder = '', secret = false, confirmText = 'Save' }) {
    const value = await modalRef.value?.showModal({ title, message, isPrompt: true, inputType: secret ? 'password' : 'text', placeholder, defaultValue: '', confirmText, cancelText: 'Cancel', confirmClass: 'btn-primary', showCancel: true });
    return typeof value === 'string' ? value : null;
  }

  const toastText = ref('');
  let toastTimer = null;
  function toast(text) {
    toastText.value = text;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastText.value = ''), TOAST_MS);
  }
  onBeforeUnmount(() => clearTimeout(toastTimer));

  return { pushScreen, chat, ask, openConversation, modalRef, confirm, prompt, toastText, toast };
}
