<template>
  <div class="ui-focused" :class="{ 'is-sidebar-closed': !sidebarOpen, 'is-compact': isMobile, 'is-borrowed': borrowed }">
    <FocusedSidebar
      :open="sidebarOpen"
      :active-page="page"
      :on-chat="!page && screenName === 'ChatScreen'"
      @close="setSidebar(false)"
      @new-chat="newChat"
      @open-page="openPage"
      @open-conversation="openConversation"
    />
    <button v-if="isMobile && sidebarOpen" type="button" class="focused-scrim" aria-label="Close sidebar" @click="setSidebar(false)"></button>

    <main class="focused-main">
      <!-- One slim bar: sidebar controls when it is closed, and the open
           conversation's title, as in the AGNT One demo. -->
      <header v-if="!sidebarOpen || isMobile || chatTitle" class="focused-topbar" :class="{ 'has-title': !!chatTitle }">
        <template v-if="!sidebarOpen || isMobile">
          <button type="button" class="focused-icon-btn" aria-label="Open sidebar" @click="setSidebar(true)">
            <i class="fas fa-bars" aria-hidden="true"></i>
          </button>
          <button type="button" class="focused-icon-btn" aria-label="New chat" @click="newChat">
            <i class="fas fa-edit" aria-hidden="true"></i>
          </button>
        </template>
        <h1 v-if="chatTitle" class="focused-chat-title">{{ chatTitle }}</h1>
      </header>

      <!-- A Studio-only screen (a forge's blank canvas, run traces…): shown in
           full, untouched, with one way back. Everything else is a Focused page. -->
      <div v-if="borrowed" class="focused-borrowed-bar" role="navigation" aria-label="Studio screen">
        <button type="button" class="focused-back" @click="backToChat">
          <i class="fas fa-arrow-left" aria-hidden="true"></i> Back to Focused
        </button>
        <span class="focused-borrowed-title">{{ borrowedTitle }}</span>
        <button type="button" class="focused-link" v-tooltip="'Switch to Studio (Ctrl+Shift+S)'" @click="switchToStudio">
          Open in Studio
        </button>
      </div>

      <FocusedLibrary v-if="page === 'library'" :location="location" />
      <FocusedPlugins v-else-if="page === 'plugins'" :item="location.item" />
      <FocusedScheduled v-else-if="page === 'scheduled'" :item="location.item" :is-new="location.isNew" />
      <FocusedMemory v-else-if="page === 'memory'" :item="location.item" :is-new="location.isNew" />
      <FocusedSettings v-else-if="page === 'settings'" />

      <!-- The screen Terminal mounted. On a Focused page that is Chat, kept
           alive underneath (v-show) so a reply keeps streaming. -->
      <div v-show="!page" class="focused-screen">
        <slot />
      </div>
    </main>

    <!-- Graduation: offered once, the first time something is built here. -->
    <aside v-if="graduation" class="focused-graduation" role="status">
      <div>
        <strong>{{ graduationCopy }}</strong>
        <span>Studio shows everything you’ve built, with full editing.</span>
      </div>
      <div class="focused-graduation-actions">
        <button type="button" class="focused-primary" @click="acceptGraduation">Switch to Studio</button>
        <button type="button" class="focused-link" @click="closeGraduation">Not now</button>
      </div>
    </aside>

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
import FocusedSidebar from './FocusedSidebar.vue';
import FocusedLibrary from './FocusedLibrary.vue';
import FocusedPlugins from './FocusedPlugins.vue';
import FocusedScheduled from './FocusedScheduled.vue';
import FocusedMemory from './FocusedMemory.vue';
import FocusedSettings from './FocusedSettings.vue';
import { screenTitle } from './focusedModel.js';
import { focusedLocation, routeFor } from './focusedRoutes.js';
import { useNavigationOnion } from '@/composables/useNavigationOnion.js';
import { graduationUnlock, GRADUATION_COPY, GRADUATION_ASKED_KEY, readFlag, writeFlag } from '@/services/uiModeDefault.js';

const props = defineProps({
  screenName: { type: String, required: true },
});
defineEmits(['screen-change']);

const store = useStore();
const router = useRouter();
const route = useRoute();
const isMobile = inject('isMobile', ref(false));

// Every screen rendered inside this frame can ask which shell it is in.
// BaseScreen uses it to drop its side panels on Chat; Chat uses it for the
// home state. Studio provides nothing, so the default ('studio') is Studio.
provide('uiPresentation', 'focused');

const SIDEBAR_KEY = 'agnt:focused-sidebar-open';
function readSidebarPref() {
  try {
    return localStorage.getItem(SIDEBAR_KEY) !== 'false';
  } catch {
    return true;
  }
}
const sidebarOpen = ref(isMobile.value ? false : readSidebarPref());
function setSidebar(open) {
  sidebarOpen.value = open;
  if (isMobile.value) return; // a drawer on a phone is not a preference
  try {
    localStorage.setItem(SIDEBAR_KEY, String(open));
  } catch {
    /* storage disabled */
  }
}
watch(isMobile, (mobile) => {
  sidebarOpen.value = mobile ? false : readSidebarPref();
});
function closeDrawer() {
  if (isMobile.value) sidebarOpen.value = false;
}

// ── Where we are: read from the route, never kept here ─────────────────────
const location = computed(() => focusedLocation(props.screenName, route.query));
const page = computed(() => location.value?.page || null);
const borrowed = computed(() => !page.value && props.screenName !== 'ChatScreen');
const borrowedTitle = computed(() => screenTitle(props.screenName));
// The open conversation's title. Empty on a new chat, so the home has no bar.
const chatTitle = computed(() =>
  !page.value && props.screenName === 'ChatScreen' ? String(store.state.chat?.savedOutputTitle || '').trim() : '',
);

// ── Going places: every move is a route push (Back works, links work) ─────
function pushScreen(screen, opts = {}) {
  const target = screenRoute(screen, opts);
  if (!target) return;
  closeDrawer();
  router.push({ path: target.path, query: target.query }).catch(() => {});
}
function go(loc) {
  const [screen, opts] = routeFor(loc);
  pushScreen(screen, opts);
}
function openPage(id) {
  if (id === 'library') go({ page: 'library', tab: 'agents' });
  else if (id === 'files') go({ page: 'library', tab: 'files', dir: '' });
  else if (['plugins', 'scheduled', 'memory', 'settings'].includes(id)) go({ page: id });
}
function backToChat() {
  // Plain /chat: the conversation Chat is holding stays open (no reload).
  closeDrawer();
  router.push('/chat').catch(() => {});
}
async function openConversation(outputId) {
  closeDrawer();
  await router.push({ path: '/chat', query: { 'content-id': outputId } }).catch(() => {});
}
async function newChat() {
  closeDrawer();
  // Same two steps as Studio's sidebar (OutputList.handleNewChat), minus the
  // confirm: the current chat autosaves and stays one click away in Recents.
  await router.push('/chat').catch(() => {});
  await nextTick();
  window.dispatchEvent(new CustomEvent('trigger-new-chat'));
}
/** A new chat with the request typed in. Nothing is sent until Enter. */
async function ask(text) {
  await newChat();
  await nextTick();
  window.dispatchEvent(new CustomEvent('agnt:ask-annie', { detail: { text, send: false } }));
}
function switchToStudio() {
  store.dispatch('theme/setUiMode', 'studio');
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
// the router or Terminal; they only say what they want.
provide('focusedNav', {
  go,
  ask,
  chat: backToChat,
  studio: (screen, opts = {}) => pushScreen(screen, { ...opts, studio: true }),
  confirm,
  prompt,
  toast,
});

// ── Graduation ─────────────────────────────────────────────────────────────
// The onion keeps recording what this account has built while it is in
// Focused, so Studio's rail is right the day they switch. It announces nothing
// here (canAnnounce: false) — its popups point at rail rows Focused does not
// have. Focused reads its `fresh` unlocks for the one offer below instead.
const onion = useNavigationOnion(store, { teams: ref([]), teamsKnown: ref(false), canAnnounce: ref(false) });
const graduationAsked = ref(readFlag(GRADUATION_ASKED_KEY));
// Only an unlock that happens WHILE in Focused counts. `fresh` persists across
// sessions and modes: an existing account with 196 workflows had 'workflows'
// left in it from Studio and was told "Your first workflow is saved".
const freshAtEntry = new Set(onion.state.value.fresh || []);
const unlockedHere = computed(() => (onion.state.value.fresh || []).filter((id) => !freshAtEntry.has(id)));
const graduation = computed(() => graduationUnlock(unlockedHere.value, graduationAsked.value));
const graduationCopy = computed(() => GRADUATION_COPY[graduation.value] || '');
function closeGraduation() {
  graduationAsked.value = true;
  writeFlag(GRADUATION_ASKED_KEY);
}
function acceptGraduation() {
  closeGraduation();
  switchToStudio();
}

// Ctrl/⌘+K opens the same Jump palette Studio has: every screen stays one
// search away, which is what makes a smaller frame safe.
function onKeydown(e) {
  const mod = e.ctrlKey || e.metaKey;
  if (!mod || e.altKey || e.shiftKey) return;
  if (e.key.toLowerCase() === 'k') {
    e.preventDefault();
    store.dispatch('shell/toggleJump');
  }
}
onMounted(() => window.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
  clearTimeout(toastTimer);
});

defineExpose({ openPage, newChat, ask, go });
</script>

<style src="./focused.css"></style>
