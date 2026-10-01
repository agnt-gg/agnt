<template>
  <div class="ui-focused" :class="{ 'is-sidebar-closed': !sidebarOpen, 'is-compact': isMobile, 'is-borrowed': borrowed && !page }">
    <FocusedSidebar
      :open="sidebarOpen"
      :active-page="page"
      :on-chat="!page && screenName === 'ChatScreen'"
      @close="setSidebar(false)"
      @new-chat="newChat"
      @open-page="openPage"
      @open-conversation="openConversation"
      @navigate="navigate"
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

      <!-- Borrowed Studio: the full screen, untouched, with one way back. -->
      <div v-if="borrowed && !page" class="focused-borrowed-bar" role="navigation" aria-label="Studio screen">
        <button type="button" class="focused-back" @click="backToFocused">
          <i class="fas fa-arrow-left" aria-hidden="true"></i> Back to Focused
        </button>
        <span class="focused-borrowed-title">{{ borrowedTitle }}</span>
        <button type="button" class="focused-link" v-tooltip="'Switch to Studio (Ctrl+Shift+S)'" @click="switchToStudio">
          Open in Studio
        </button>
      </div>

      <FocusedLibrary v-if="page === 'library'" :tab="libraryTabId" @update:tab="libraryTabId = $event" @run="run" @ask="ask" />
      <FocusedPlugins v-else-if="page === 'plugins'" @run="run" @ask="ask" />
      <FocusedScheduled v-else-if="page === 'scheduled'" @run="run" @ask="ask" />

      <!-- The screens themselves, exactly as Studio renders them. v-show, not
           v-if, so opening a page never tears down a streaming chat. -->
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

    <JumpPalette @navigate="navigate" />
  </div>
</template>

<script setup>
import { ref, computed, inject, provide, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { useStore } from 'vuex';
import { useRouter } from 'vue-router';
import JumpPalette from '@/canvas/JumpPalette.vue';
import { runJumpAction } from '@/canvas/jumpActions.js';
import FocusedSidebar from './FocusedSidebar.vue';
import FocusedLibrary from './FocusedLibrary.vue';
import FocusedPlugins from './FocusedPlugins.vue';
import FocusedScheduled from './FocusedScheduled.vue';
import { isBorrowedScreen, isFocusedPage, screenTitle } from './focusedModel.js';
import { useNavigationOnion } from '@/composables/useNavigationOnion.js';
import { graduationUnlock, GRADUATION_COPY, GRADUATION_ASKED_KEY, readFlag, writeFlag } from '@/services/uiModeDefault.js';

const props = defineProps({
  screenName: { type: String, required: true },
});
const emit = defineEmits(['screen-change']);

const store = useStore();
const router = useRouter();
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

const page = ref(null);
const libraryTabId = ref('agents');
const borrowed = computed(() => isBorrowedScreen(props.screenName));
// The open conversation's title. Empty on a new chat, so the home has no bar.
const chatTitle = computed(() =>
  !page.value && props.screenName === 'ChatScreen' ? String(store.state.chat?.savedOutputTitle || '').trim() : '',
);
const borrowedTitle = computed(() => screenTitle(props.screenName));

function closeDrawer() {
  if (isMobile.value) sidebarOpen.value = false;
}

function navigate(screen, opts = {}) {
  page.value = null;
  closeDrawer();
  emit('screen-change', screen, opts);
}

function openPage(id) {
  if (!isFocusedPage(id)) return;
  page.value = id;
  closeDrawer();
}

function run(action) {
  runJumpAction(action, {
    store,
    router,
    navigate,
    onError: (message) => console.warn('[Focused] could not open:', message),
  });
  // chat/output actions route without going through navigate()
  page.value = null;
  closeDrawer();
}

async function openConversation(outputId) {
  page.value = null;
  closeDrawer();
  await router.push({ path: '/chat', query: { 'content-id': outputId } });
}

async function newChat() {
  page.value = null;
  closeDrawer();
  // Same two steps as Studio's sidebar (OutputList.handleNewChat), minus the
  // confirm: the current chat autosaves and stays one click away in Recents.
  await router.push('/chat');
  await nextTick();
  window.dispatchEvent(new CustomEvent('trigger-new-chat'));
}

/** Seed the real chat input. Nothing is sent until the user presses Enter. */
async function ask(text) {
  page.value = null;
  closeDrawer();
  if (props.screenName !== 'ChatScreen') {
    emit('screen-change', 'ChatScreen', {});
    await nextTick();
  }
  await nextTick();
  window.dispatchEvent(new CustomEvent('agnt:ask-annie', { detail: { text, send: false } }));
}

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

function backToFocused() {
  navigate('ChatScreen');
}

function switchToStudio() {
  store.dispatch('theme/setUiMode', 'studio');
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
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));

defineExpose({ openPage, newChat, ask });
</script>

<style src="./focused.css"></style>
