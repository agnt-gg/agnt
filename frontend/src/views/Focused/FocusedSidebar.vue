<template>
  <aside class="focused-sidebar" :class="{ open }" aria-label="Focused navigation">
    <div class="focused-side-head">
      <img class="focused-logo" src="/images/agnt-logo-mark.svg" alt="AGNT" />
      <span class="focused-wordmark">agnt</span>
      <span class="focused-flex"></span>
      <button type="button" class="focused-icon-btn" aria-label="Search chats" v-tooltip="'Search chats'" @click="toggleSearch">
        <i class="fas fa-search" aria-hidden="true"></i>
      </button>
      <button type="button" class="focused-icon-btn" data-testid="focused-new-chat" aria-label="New chat" v-tooltip="'New chat'" @click="$emit('new-chat')">
        <i class="fas fa-edit" aria-hidden="true"></i>
      </button>
      <button type="button" class="focused-icon-btn" aria-label="Close sidebar" v-tooltip="'Close sidebar'" @click="$emit('close')">
        <i class="fas fa-angle-double-left" aria-hidden="true"></i>
      </button>
    </div>

    <nav class="focused-nav">
      <!-- The Main chat: pinned first. Texts to Annie land here; New chat never does. -->
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

      <button
        v-for="item in pageItems"
        :key="item.id"
        type="button"
        class="focused-nav-row"
        :class="{ active: activePage === item.id || (item.id === 'market' && route.path === '/marketplace') }"
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
          :class="{ active: onChat && c.id === activeConversationId, unread: c.unread, working: c.working }"
          :aria-busy="c.working ? 'true' : undefined"
          v-tooltip="c.title"
          aria-haspopup="menu"
          @click="$emit('open-conversation', c.id)"
          @contextmenu.prevent="openChatMenu(c, $event)"
        >
          <span class="focused-recent-title">
            <span v-if="c.working" class="focused-working-dot" aria-hidden="true"></span>
            <i v-if="c.sub" class="fas fa-level-up-alt fa-rotate-90 focused-sub-mark" aria-label="Task from the Main chat"></i>{{ c.title }}
          </span>
          <!-- Same wording as Studio's list (ConversationMetaLine). -->
          <span v-if="c.working" class="focused-recent-status">{{ c.speaker || 'Working' }} speaking</span>
        </button>
      </li>
      <li v-if="!recents.length" class="focused-recents-empty">{{ query ? 'No chats match.' : 'Your chats show up here.' }}</li>
    </ul>

    <!-- Right-click on a chat: the same actions as Studio's chat list, run by
         the same code (services/conversationActions.js). -->
    <div
      v-if="chatMenu"
      class="focused-menu focused-context-menu"
      role="menu"
      :aria-label="`Actions for ${chatMenu.title}`"
      :style="{ left: chatMenu.x + 'px', top: chatMenu.y + 'px' }"
      @keydown.esc="closeChatMenu"
    >
      <button type="button" role="menuitem" class="focused-menu-item" @click="renameChat"><i class="fas fa-pen" aria-hidden="true"></i>Rename</button>
      <button type="button" role="menuitem" class="focused-menu-item" @click="toggleChatRead">
        <i :class="chatMenu.unread ? 'fas fa-envelope-open' : 'fas fa-envelope'" aria-hidden="true"></i>{{ chatMenu.unread ? 'Mark as read' : 'Mark as unread' }}
      </button>
      <button type="button" role="menuitem" class="focused-menu-item" @click="archiveChat"><i class="fas fa-archive" aria-hidden="true"></i>Archive</button>
      <div class="focused-menu-sep"></div>
      <button type="button" role="menuitem" class="focused-menu-item danger" @click="deleteChat"><i class="fas fa-trash" aria-hidden="true"></i>Delete</button>
    </div>

    <UpgradePrompt compact title="Get more from AGNT" description="Scheduled goals and paid services. Put your agents to work for you." />
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
        <div class="focused-menu-sep"></div>
        <button type="button" role="menuitem" class="focused-menu-item" data-testid="focused-logout" @click="logOut">
          <i class="fas fa-sign-out-alt" aria-hidden="true"></i>Log out
        </button>
      </div>
    </div>
  </aside>
</template>

<script setup>
import UpgradePrompt from '@/components/UpgradePrompt.vue';
import { ref, computed, nextTick, inject, onMounted, onBeforeUnmount } from 'vue';
import { useStore } from 'vuex';
import { useRoute, useRouter } from 'vue-router';
import { FOCUSED_PAGES, recentConversations, initialOf } from './focusedModel.js';
import { useMainChat, MAIN_CHAT_LABEL } from '@/composables/useMainChat.js';
import { renameConversation, setConversationRead, setConversationArchived, deleteConversation } from '@/services/conversationActions.js';

defineProps({
  open: { type: Boolean, default: true },
  activePage: { type: String, default: null },
  onChat: { type: Boolean, default: false },
});
const emit = defineEmits(['close', 'new-chat', 'open-page', 'open-conversation', 'open-main', 'clear-main']);

const store = useStore();
const nav = inject('focusedNav', null);
const route = useRoute();
const router = useRouter();

const pageItems = [
  { id: 'scheduled', label: FOCUSED_PAGES.scheduled.title, icon: FOCUSED_PAGES.scheduled.icon },
  { id: 'library', label: FOCUSED_PAGES.library.title, icon: FOCUSED_PAGES.library.icon },
  { id: 'connectors', label: FOCUSED_PAGES.connectors.title, icon: FOCUSED_PAGES.connectors.icon },
  { id: 'market', label: 'Market', icon: 'fas fa-store' },
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
  recentConversations(store.getters['contentOutputs/visibleOutputs'], query.value, 60, store.getters['contentOutputs/subChatIdSet'], {
    workingIds: store.getters['chat/streamingOutputIds'],
    speakingById: store.getters['chat/speakingByOutputId'],
  }),
);
// Same precedence as Studio's list (OutputList.activeOutputId).
const activeConversationId = computed(() => route.query['content-id'] || store.state.chat?.savedOutputId || null);

// The username chosen at onboarding (the pseudonym), not the full account name.
const userName = computed(() => store.getters['userAuth/userPseudonym']);
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
// The same sign-out Studio's Settings uses (LoginSection.logout).
async function logOut() {
  await store.dispatch('userAuth/logout');
  // Terminal tears down the entire shell as soon as the session is invalid.
  await router.replace({ path: '/settings', query: { section: 'login' } });
}

// ── Right-click on a chat ──────────────────────────────────────────────────────
const chatMenu = ref(null);
const MENU_W = 200;
const MENU_H = 180;
const outputOf = (id) => (store.getters['contentOutputs/outputs'] || []).find((o) => o.id === id) || null;

function openChatMenu(chat, event) {
  // Kept inside the window, wherever the click was.
  const x = Math.max(8, Math.min(event.clientX, window.innerWidth - MENU_W - 8));
  const y = Math.max(8, Math.min(event.clientY, window.innerHeight - MENU_H - 8));
  chatMenu.value = { id: chat.id, title: chat.title, unread: chat.unread, x, y };
  nextTick(() => document.querySelector('.focused-context-menu .focused-menu-item')?.focus());
}
function closeChatMenu() {
  chatMenu.value = null;
}
const failed = (what) => (error) => {
  console.error(`[Focused] ${what} failed:`, error);
  nav?.toast?.(`Couldn't ${what} that chat.`);
};

async function renameChat() {
  const target = chatMenu.value;
  closeChatMenu();
  const output = outputOf(target?.id);
  if (!output || !nav?.prompt) return;
  const title = await nav.prompt({ title: 'Rename chat', message: target.title, placeholder: 'Chat title', confirmText: 'Rename' });
  if (title === null) return;
  renameConversation(store, output, title).catch(failed('rename'));
}
function toggleChatRead() {
  const target = chatMenu.value;
  closeChatMenu();
  setConversationRead(store, target?.id, target?.unread).catch(failed(target?.unread ? 'mark read' : 'mark unread'));
}
function archiveChat() {
  const target = chatMenu.value;
  closeChatMenu();
  if (!target) return;
  // Archived chats leave Recents; open a new chat if this one was showing.
  if (target.id === activeConversationId.value) emit('new-chat');
  setConversationArchived(store, target.id, true).catch(failed('archive'));
}
async function deleteChat() {
  const target = chatMenu.value;
  closeChatMenu();
  const output = outputOf(target?.id);
  if (!output) return;
  const ok = await nav?.confirm?.({ title: 'Delete chat', message: `Delete “${target.title}”? This can't be undone.`, confirmText: 'Delete', danger: true });
  if (!ok) return;
  if (target.id === activeConversationId.value) emit('new-chat');
  deleteConversation(store, output).catch(failed('delete'));
}

// Menus close on any click outside them.
function onDocClick(e) {
  if (!e.target.closest?.('.focused-menu-anchor')) {
    moreOpen.value = false;
    accountOpen.value = false;
  }
  if (chatMenu.value && !e.target.closest?.('.focused-context-menu')) closeChatMenu();
}
function onKey(e) {
  if (e.key === 'Escape' && chatMenu.value) closeChatMenu();
}
onMounted(() => {
  document.addEventListener('click', onDocClick, true);
  document.addEventListener('keydown', onKey);
  // The list is normally loaded at boot (initializeStore); this only covers a
  // cold mount that beat it.
  if (!store.getters['contentOutputs/outputs']?.length) store.dispatch('contentOutputs/fetchOutputs').catch(() => {});
  if (!mainChatId.value) store.dispatch('contentOutputs/fetchMainChat');
});
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick, true);
  document.removeEventListener('keydown', onKey);
});
</script>
