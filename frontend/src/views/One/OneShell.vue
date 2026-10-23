<template>
  <div
    class="ui-one ui-focused"
    :class="{ 'is-compact': isMobile, 'is-borrowed': borrowed, 'has-window-bar': isElectron, 'is-drawer-open': drawerShown }"
  >
    <!-- AGNT One: the app's only frame. A rail, one top bar, and the chat.
         `.ui-focused` on the root is deliberate: focused.css holds the measured
         rules that fit the shared Chat screen and the pages into a minimal
         frame (one column, centred home, folded steps). one.css draws One over
         them. Comments stay INSIDE the root: one before it makes a fragment. -->
    <OneRail v-if="!isMobile" :items="railItems" :settings-active="page === 'settings'" @select="selectRail" />

    <!-- Chats: your chats only (Main chat, search, recents, right-click
         actions, account), as a drawer behind the rail's Chats icon. The rail
         is the one navigation; page links appear in the drawer only on a
         phone, where there is no rail. -->
    <FocusedSidebar
      v-if="drawerShown"
      class="one-drawer"
      :open="true"
      :navigation="isMobile"
      :active-page="page"
      :on-chat="!page && screenName === 'ChatScreen'"
      @close="setDrawer(false)"
      @new-chat="newChat"
      @open-page="openPage"
      @open-conversation="openConversation"
      @open-main="openMain"
      @clear-main="clearMain"
    />
    <button v-if="isMobile && drawerShown" type="button" class="focused-scrim" aria-label="Close chats" @click="setDrawer(false)"></button>

    <main class="focused-main one-main">
      <!-- ONE top bar: the conversation's title, the getting-started capsule
           and (desktop) the window buttons. In the desktop app it is also what
           drags the frameless window. -->
      <header class="one-topbar" :class="{ 'is-window-bar': isElectron }" data-testid="one-topbar">
        <template v-if="isMobile">
          <button type="button" class="one-icon-btn" aria-label="Open chats" @click="setDrawer(true)">
            <i class="fas fa-bars" aria-hidden="true"></i>
          </button>
          <button type="button" class="one-icon-btn" aria-label="New chat" @click="newChat">
            <i class="fas fa-edit" aria-hidden="true"></i>
          </button>
        </template>
        <h1 v-if="chatTitle" class="one-title">{{ chatTitle }}</h1>
        <span class="one-topbar-fill"></span>
        <OneCapsule @ask="ask" @open-models="openModels" />
        <FocusedWindowControls />
      </header>

      <!-- A screen with no One page (a forge's full editor, run traces…):
           shown in full, untouched, with one way back. -->
      <div v-if="borrowed" class="focused-borrowed-bar" role="navigation" aria-label="Full screen">
        <button type="button" class="focused-back" @click="backToChat">
          <i class="fas fa-arrow-left" aria-hidden="true"></i> Back to chat
        </button>
        <span class="focused-borrowed-title">{{ borrowedTitle }}</span>
      </div>

      <FocusedLibrary v-if="page === 'library'" :location="location" />
      <FocusedConnectors v-else-if="page === 'connectors'" :item="location.item" :tab="location.tab" />
      <FocusedScheduled v-else-if="page === 'scheduled'" :item="location.item" :is-new="location.isNew" />
      <FocusedMemory v-else-if="page === 'memory'" :item="location.item" :is-new="location.isNew" />
      <FocusedSettings v-else-if="page === 'settings'" :section="location.section" />
      <FocusedMarket v-else-if="page === 'market'" :item="location.item" />

      <!-- The screen Terminal mounted. On a page that is Chat, kept alive
           underneath (v-show) so a reply keeps streaming.
           data-fullscreen-host: the one box a screen's "fullscreen" may fill. -->
      <div v-show="!page" class="focused-screen" data-fullscreen-host>
        <slot />
      </div>
    </main>

    <div v-if="toastText" class="focused-toast" role="status" aria-live="polite">{{ toastText }}</div>
    <SimpleModal ref="modalRef" />
    <JumpPalette @navigate="pushScreen" />
  </div>
</template>

<script setup>
import { ref, computed, inject, provide, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { useStore } from 'vuex';
import { useRouter, useRoute } from 'vue-router';
import JumpPalette from '@/canvas/JumpPalette.vue';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import { screenRoute } from '@/views/Terminal/screenRoute.js';
import { useElectron } from '@/composables/useElectron';
import { useMainChat } from '@/composables/useMainChat.js';
import { isUnstartedConversation } from '@/views/Terminal/CenterPanel/screens/Chat/chatHome.js';
import FocusedSidebar from '@/views/Focused/FocusedSidebar.vue';
import FocusedWindowControls from '@/views/Focused/FocusedWindowControls.vue';
import FocusedLibrary from '@/views/Focused/FocusedLibrary.vue';
import FocusedConnectors from '@/views/Focused/FocusedConnectors.vue';
import FocusedScheduled from '@/views/Focused/FocusedScheduled.vue';
import FocusedMemory from '@/views/Focused/FocusedMemory.vue';
import FocusedSettings from '@/views/Focused/FocusedSettings.vue';
import FocusedMarket from '@/views/Focused/FocusedMarket.vue';
import { screenTitle } from '@/views/Focused/focusedModel.js';
import { waitUntil } from '@/views/Focused/focusedTime.js';
import { focusedLocation, routeFor } from '@/views/Focused/focusedRoutes.js';
import OneRail from './OneRail.vue';
import OneCapsule from './OneCapsule.vue';
import { RAIL_PAGE, railItems as buildRailItems } from './oneModel.js';
import { setMainChatToolSelectorShown } from '@/services/chatChannelConfig.js';

const { isElectron } = useElectron();

const props = defineProps({
  screenName: { type: String, required: true },
});
defineEmits(['screen-change']);

const store = useStore();
const router = useRouter();
const route = useRoute();
const isMobile = inject('isMobile', ref(false));

// Every screen rendered inside this frame can ask which shell it is in.
// BaseScreen drops its side panels on Chat, Chat shows One's home, and
// MessageItem folds tool steps. There is no other frame.
provide('uiPresentation', 'one');

// ── The Chats drawer ───────────────────────────────────────────────────────
const DRAWER_KEY = 'agnt:one-drawer-open';
function readDrawerPref() {
  try {
    return localStorage.getItem(DRAWER_KEY) === 'true';
  } catch {
    return false;
  }
}
const drawerOpen = ref(isMobile.value ? false : readDrawerPref());
function setDrawer(open) {
  drawerOpen.value = open;
  if (isMobile.value) return; // a drawer on a phone is not a preference
  try {
    localStorage.setItem(DRAWER_KEY, String(open));
  } catch {
    /* storage disabled: the drawer still works for this session */
  }
}
watch(isMobile, (mobile) => {
  drawerOpen.value = mobile ? false : readDrawerPref();
});
function closeDrawerOnPhone() {
  if (isMobile.value) drawerOpen.value = false;
}

// ── Where we are: read from the route, never kept here ─────────────────────
const location = computed(() => focusedLocation(props.screenName, route.query));
const page = computed(() => location.value?.page || null);
const borrowed = computed(() => !page.value && props.screenName !== 'ChatScreen');
const borrowedTitle = computed(() => screenTitle(props.screenName));
// Empty while the chat is still at its home (nobody has spoken yet): the same
// rule Chat.vue uses to show the home, so a blank but titled chat ("Main
// chat") never gets a title over its welcome.
const chatTitle = computed(() => {
  if (page.value || props.screenName !== 'ChatScreen') return '';
  if (isUnstartedConversation(store.state.chat?.messages)) return '';
  return String(store.state.chat?.savedOutputTitle || '').trim();
});
const onBlankChat = () => !store.state.chat?.savedOutputId && !(store.state.chat?.messages || []).some((m) => m?.role === 'user');

// The Chats drawer belongs to the chat: on a desktop it shows there only, and
// the other pages get their full width (2026-10-21). drawerOpen is the
// remembered choice, so coming back to the chat brings it back as it was. On a
// phone the drawer is the navigation, an overlay that closes on every move.
const onChatPage = computed(() => !page.value && props.screenName === 'ChatScreen');
const drawerShown = computed(() => drawerOpen.value && (isMobile.value || onChatPage.value));

const railItems = computed(() =>
  buildRailItems({
    activePage: page.value,
    drawerOpen: drawerShown.value,
    onBlankChat: props.screenName === 'ChatScreen' && onBlankChat(),
  }),
);

// ── Going places: every move is a route push (Back works, links work) ─────
function pushScreen(screen, opts = {}) {
  const target = screenRoute(screen, opts);
  if (!target) return;
  closeDrawerOnPhone();
  router.push({ path: target.path, query: target.query }).catch(() => {});
}
function go(loc) {
  const [screen, opts] = routeFor(loc);
  pushScreen(screen, opts);
}
function openPage(id) {
  if (id === 'market') { pushScreen('MarketplaceScreen'); return; }
  if (id === 'library') go({ page: 'library', tab: 'agents' });
  else if (id === 'files') go({ page: 'library', tab: 'files', dir: '' });
  else if (['connectors', 'scheduled', 'memory', 'settings'].includes(id)) go({ page: id });
}
function selectRail(id) {
  if (id === 'chats') {
    // From another page, Chats goes back to your chat with its list open.
    if (!isMobile.value && !onChatPage.value) {
      setDrawer(true);
      backToChat();
      return;
    }
    setDrawer(!drawerShown.value);
    return;
  }
  if (RAIL_PAGE[id]) openPage(RAIL_PAGE[id]);
}
// The model is chosen in Settings, never through the chat (a key must not
// enter a transcript).
function openModels() {
  go({ page: 'settings' });
}
function backToChat() {
  // Plain /chat: the conversation Chat is holding stays open (no reload).
  closeDrawerOnPhone();
  router.push('/chat').catch(() => {});
}
async function openConversation(outputId) {
  closeDrawerOnPhone();
  await router.push({ path: '/chat', query: { 'content-id': outputId } }).catch(() => {});
}
async function newChat() {
  closeDrawerOnPhone();
  // The current chat autosaves and stays one click away in Chats.
  await router.push('/chat').catch(() => {});
  await nextTick();
  window.dispatchEvent(new CustomEvent('trigger-new-chat'));
}

// ── The Main chat: the one conversation texts to Annie land in ─────────────
const mainChat = useMainChat();
async function openMain() {
  closeDrawerOnPhone();
  await mainChat.openMainChat();
}
async function clearMain() {
  const cleared = await mainChat.clearMainChat(() =>
    confirm({
      title: 'Clear main chat?',
      message: 'This empties the Main chat. Chats it started stay in Chats, still linked to it.',
      confirmText: 'Clear',
      danger: true,
    }),
  );
  if (cleared) toast('Main chat cleared');
}

/**
 * Ask in a NEW conversation, with the request typed in. Nothing is sent until
 * Enter. A chat already blank and unsaved is reused rather than replaced.
 *
 * The seed waits for that new conversation to BE the active one: the
 * composer's draft is keyed by conversation and reloaded on every switch, so
 * a seed written before the switch lands was filed under the outgoing chat.
 */
const ASK_SWITCH_TIMEOUT_MS = 8000;
async function ask(text) {
  if (onBlankChat()) {
    closeDrawerOnPhone();
    await router.push('/chat').catch(() => {});
  } else {
    const leaving = store.state.chat?.activeConversationId;
    await newChat();
    await waitUntil(() => store.state.chat?.activeConversationId !== leaving, ASK_SWITCH_TIMEOUT_MS, 50);
  }
  await nextTick();
  window.dispatchEvent(new CustomEvent('agnt:ask-annie', { detail: { text, send: false } }));
}

// ── Dialogs, through the app's own modal ───────────────────────────────────
const modalRef = ref(null);
function confirm({ title, message, confirmText = 'OK', danger = false }) {
  return modalRef.value?.showModal({
    title,
    message,
    confirmText,
    cancelText: 'Cancel',
    showCancel: true,
    confirmClass: danger ? 'btn-danger' : 'btn-primary',
  });
}
async function prompt({ title, message, placeholder = '', secret = false, confirmText = 'Save' }) {
  const value = await modalRef.value?.showModal({
    title,
    message,
    isPrompt: true,
    inputType: secret ? 'password' : 'text',
    placeholder,
    defaultValue: '',
    confirmText,
    cancelText: 'Cancel',
    confirmClass: 'btn-primary',
    showCancel: true,
  });
  return typeof value === 'string' ? value : null;
}
const toastText = ref('');
let toastTimer = null;
function toast(text) {
  toastText.value = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastText.value = ''), 2600);
}

// One service for every page: where to go and how to ask. Pages never import
// the router or Terminal; they only say what they want. (The name predates
// One; the pages it serves are shared.) `studio` opens a screen's full
// editor: the same route with ?studio=1, rendered in full with a way back.
provide('focusedNav', {
  openScreen: pushScreen,
  go,
  ask,
  chat: backToChat,
  studio: (screen, opts = {}) => pushScreen(screen, { ...opts, studio: true }),
  confirm,
  prompt,
  toast,
});

// Ctrl/⌘+K opens the Jump palette: every screen stays one search away,
// which is what makes a frame this small safe.
function onKeydown(e) {
  const mod = e.ctrlKey || e.metaKey;
  if (!mod || e.altKey || e.shiftKey) return;
  if (e.key.toLowerCase() === 'k') {
    e.preventDefault();
    store.dispatch('shell/toggleJump');
  }
}
// This frame hides the chat's tool selector (focused.css), so a selection
// saved in Studio must not bind the chat here (chatChannelConfig.js).
setMainChatToolSelectorShown(false);
onMounted(() => window.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
  clearTimeout(toastTimer);
  setMainChatToolSelectorShown(true);
});

defineExpose({ openPage, newChat, ask, go });
</script>

<!-- Order matters: one.css draws over focused.css's minimal-frame rules. -->
<style src="../Focused/focused.css"></style>
<style src="./one.css"></style>
