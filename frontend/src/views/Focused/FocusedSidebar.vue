<template>
  <aside class="focused-sidebar" :class="{ open }" aria-label="Focused navigation">
    <div class="focused-side-head">
      <img class="focused-logo" src="/images/agnt-logo-mark.svg" alt="AGNT" />
      <span class="focused-wordmark">agnt</span>
      <span class="focused-flex"></span>
      <button type="button" class="focused-icon-btn" aria-label="Search chats" v-tooltip="'Search chats'" @click="toggleSearch">
        <i class="fas fa-search" aria-hidden="true"></i>
      </button>
      <button type="button" class="focused-icon-btn" aria-label="Close sidebar" v-tooltip="'Close sidebar'" @click="$emit('close')">
        <i class="fas fa-angle-double-left" aria-hidden="true"></i>
      </button>
    </div>

    <nav class="focused-nav">
      <!-- The Main chat: pinned first, the one place to stay in. -->
      <div class="focused-main-chat" :class="{ active: onChat && isMainOpen }">
        <button
          type="button"
          class="focused-nav-row"
          :class="{ active: onChat && isMainOpen, unread: isMainUnread }"
          data-testid="focused-main-chat"
          @click="$emit('open-main')"
        >
          <i class="fas fa-thumbtack" aria-hidden="true"></i><span>{{ MAIN_CHAT_LABEL }}</span>
        </button>
        <button
          type="button"
          class="focused-icon-btn focused-main-clear"
          :disabled="isMainStreaming"
          aria-label="Clear main chat"
          v-tooltip="isMainStreaming ? 'Wait for the reply to finish' : 'Clear main chat'"
          @click="$emit('clear-main')"
        >
          <i class="fas fa-eraser" aria-hidden="true"></i>
        </button>
      </div>
      <button type="button" class="focused-nav-row" :class="{ active: onChat && !activeConversationId }" @click="$emit('new-chat')">
        <i class="fas fa-edit" aria-hidden="true"></i><span>New chat</span>
      </button>
      <button
        v-for="item in pageItems"
        :key="item.id"
        type="button"
        class="focused-nav-row"
        :class="{ active: activePage === item.id }"
        @click="$emit('open-page', item.id)"
      >
        <i :class="item.icon" aria-hidden="true"></i><span>{{ item.label }}</span>
      </button>
      <div class="focused-menu-anchor">
        <button
        type="button"
        class="focused-nav-row"
        :class="{ active: moreItems.some((m) => m.page === activePage) }"
        :aria-expanded="moreOpen ? 'true' : 'false'"
        @click="moreOpen = !moreOpen"
      >
          <i class="fas fa-ellipsis-h" aria-hidden="true"></i><span>More</span>
        </button>
        <div v-if="moreOpen" class="focused-menu" role="menu" @click="moreOpen = false">
          <button
            v-for="m in moreItems"
            :key="m.page"
            type="button"
            role="menuitem"
            class="focused-menu-item"
            :class="{ active: activePage === m.page }"
            @click="$emit('open-page', m.page)"
          >
            <i :class="m.icon" aria-hidden="true"></i>{{ m.label }}
          </button>
          <div class="focused-menu-sep"></div>
          <button type="button" role="menuitem" class="focused-menu-item" @click="openJump">
            <i class="fas fa-search" aria-hidden="true"></i>Find anything<kbd>Ctrl K</kbd>
          </button>
        </div>
      </div>
    </nav>

    <div v-if="searchOpen" class="focused-search">
      <i class="fas fa-search" aria-hidden="true"></i>
      <input ref="searchEl" v-model="query" type="search" placeholder="Search chats" aria-label="Search chats" @keydown.esc="closeSearch" />
    </div>

    <div class="focused-recents-label">Recents</div>
    <ul class="focused-recents" aria-label="Recent chats">
      <li v-for="c in recents" :key="c.id">
        <button
          type="button"
          class="focused-recent"
          :class="{ active: onChat && c.id === activeConversationId, unread: c.unread }"
          v-tooltip="c.title"
          @click="$emit('open-conversation', c.id)"
        >
          <i v-if="c.sub" class="fas fa-level-up-alt fa-rotate-90 focused-sub-mark" aria-label="Task from the Main chat"></i>{{ c.title }}
        </button>
      </li>
      <li v-if="!recents.length" class="focused-recents-empty">{{ query ? 'No chats match.' : 'Your chats show up here.' }}</li>
    </ul>

    <div class="focused-menu-anchor focused-account-anchor">
      <button type="button" class="focused-account" :aria-expanded="accountOpen ? 'true' : 'false'" @click="accountOpen = !accountOpen">
        <span class="focused-avatar" aria-hidden="true">{{ initial }}</span>
        <span class="focused-account-text">
          <strong>{{ userName || 'You' }}</strong>
          <small>{{ planLabel }}</small>
        </span>
      </button>
      <div v-if="accountOpen" class="focused-menu focused-menu-up" role="menu" @click="accountOpen = false">
        <div v-if="userEmail" class="focused-menu-note">{{ userEmail }}</div>
        <button type="button" role="menuitem" class="focused-menu-item" @click="$emit('open-page', 'settings')">
          <i class="fas fa-cog" aria-hidden="true"></i>Settings
        </button>
        <div class="focused-menu-sep"></div>
        <button type="button" role="menuitem" class="focused-menu-item" data-testid="switch-to-studio" @click="switchToStudio">
          <i class="fas fa-th-large" aria-hidden="true"></i>Switch to Studio<kbd>Ctrl Shift S</kbd>
        </button>
      </div>
    </div>
  </aside>
</template>

<script setup>
import { ref, computed, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { useStore } from 'vuex';
import { useRoute } from 'vue-router';
import { FOCUSED_PAGES, recentConversations, initialOf } from './focusedModel.js';
import { useMainChat, MAIN_CHAT_LABEL } from '@/composables/useMainChat.js';

defineProps({
  open: { type: Boolean, default: true },
  activePage: { type: String, default: null },
  onChat: { type: Boolean, default: false },
});
defineEmits(['close', 'new-chat', 'open-page', 'open-conversation', 'open-main', 'clear-main']);

const store = useStore();
const route = useRoute();

const pageItems = [
  { id: 'scheduled', label: FOCUSED_PAGES.scheduled.title, icon: FOCUSED_PAGES.scheduled.icon },
  { id: 'library', label: FOCUSED_PAGES.library.title, icon: FOCUSED_PAGES.library.icon },
  { id: 'plugins', label: FOCUSED_PAGES.plugins.title, icon: FOCUSED_PAGES.plugins.icon },
];

// Focused pages one click away (the demo's More). Studio-only screens are a
// Ctrl+K search away, so nothing here leaves Focused.
const moreItems = [
  { page: 'memory', label: 'Memory', icon: FOCUSED_PAGES.memory.icon },
  { page: 'files', label: 'Files', icon: 'fas fa-folder' },
  { page: 'settings', label: 'Settings', icon: FOCUSED_PAGES.settings.icon },
];

const moreOpen = ref(false);
const accountOpen = ref(false);
const searchOpen = ref(false);
const query = ref('');
const searchEl = ref(null);

async function toggleSearch() {
  searchOpen.value = !searchOpen.value;
  if (!searchOpen.value) {
    query.value = '';
    return;
  }
  await nextTick();
  searchEl.value?.focus();
}
function closeSearch() {
  query.value = '';
  searchOpen.value = false;
}

const { mainChatId, isMainOpen, isMainUnread, isMainStreaming } = useMainChat();
const recents = computed(() =>
  recentConversations(store.getters['contentOutputs/visibleOutputs'], query.value, 60, store.getters['contentOutputs/subChatIdSet']),
);
// Same precedence as Studio's list (OutputList.activeOutputId).
const activeConversationId = computed(() => route.query['content-id'] || store.state.chat?.savedOutputId || null);

const userName = computed(() => store.getters['userAuth/userName']);
const userEmail = computed(() => store.getters['userAuth/userEmail']);
const initial = computed(() => initialOf(userName.value || userEmail.value));
const planLabel = computed(() => {
  const plan = String(store.getters['userAuth/planType'] || '').trim();
  return plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : 'Free';
});

function openJump() {
  store.dispatch('shell/openJump');
}
function switchToStudio() {
  store.dispatch('theme/setUiMode', 'studio');
}

// Menus close on any click outside them.
function onDocClick(e) {
  if (!e.target.closest?.('.focused-menu-anchor')) {
    moreOpen.value = false;
    accountOpen.value = false;
  }
}
onMounted(() => {
  document.addEventListener('click', onDocClick, true);
  // The list is normally loaded at boot (initializeStore); this only covers a
  // cold mount that beat it.
  if (!store.getters['contentOutputs/outputs']?.length) store.dispatch('contentOutputs/fetchOutputs').catch(() => {});
  if (!mainChatId.value) store.dispatch('contentOutputs/fetchMainChat');
});
onBeforeUnmount(() => document.removeEventListener('click', onDocClick, true));
</script>
