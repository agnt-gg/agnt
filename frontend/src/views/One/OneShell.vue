<template>
  <div
    class="ui-one ui-focused"
    :class="{ 'is-compact': isMobile, 'is-borrowed': borrowed, 'has-window-bar': isElectron, 'is-drawer-open': drawerShown, 'is-chat-page': !isMobile && onChatPage }"
  >
    <!-- AGNT One: the app's only frame. A rail, one top bar, and the chat.
         `.ui-focused` on the root is deliberate: focused.css holds the measured
         rules that fit the shared Chat screen and the pages into a minimal
         frame (one column, centred home, folded steps). one.css draws One over
         them. Comments stay INSIDE the root: one before it makes a fragment. -->
    <!-- The approved mockup's frame (projects/agnt-team-os-tasks): its rail
         and its drawer, on every desktop page. Styled by mk/mk.css. -->
    <MkRail
      v-if="!isMobile"
      :active="mkActive"
      :active-more="mkActiveMore"
      :badge="needsYou"
      :user-name="userName"
      :collapsed="sidebarBelongs && !sidebarExpanded"
      :offer="offerState.shown ? offerState.offer.railLabel : ''"
      @select="mkSelect"
      @expand="setSidebarExpanded(true)"
      @offer="offerState.toggle"
    />
    <!-- The sidebar where it belongs (chat and team pages): the drawer, with the chats as its last
         section. The chats are Studio's own list (OutputList), the same component,
         so groups, unread, archive and every row action work as in Studio; a row
         opens its chat by routing to /chat?content-id=… from any page. -->
    <MkDrawer
      v-if="!isMobile && sidebarExpanded && sidebarBelongs"
      :team="teamState.team"
      :teams="teamState.teams"
      :spaces="teamState.spaces"
      :active="mkDrawerActive"
      :counts="mkCounts"
      :marks="spaceMarks"
      :main-chat="mainChatRow"
      @go="(loc) => go({ page: 'team', ...loc })"
      @pick="mkPick"
      @find="(text) => store.dispatch('shell/openJump', text)"
      @ask="ask"
      @new-chat="newChat"
      @open-main="openMain"
      @clear-main="clearMain"
      @new-space="newTeamspace"
      @collapse="setSidebarExpanded(false)"
      @error="toast"
    >
      <template #chats="{ query }"><OutputList variant="drawer" :query="query" /></template>
    </MkDrawer>

    <!-- Chats: your chats only (Main chat, search, recents, right-click
         actions, account), as a drawer behind the rail's Chats icon. The rail
         is the one navigation; page links appear in the drawer only on a
         phone, where there is no rail. -->
    <FocusedSidebar
      v-if="drawerShown && isMobile"
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
        <div v-if="!isMobile" class="mk mk-topbar">
          <!-- A trail only when there is somewhere to step back to; every page names itself. -->
          <div v-if="crumbs.length > 1" class="crumbs" data-testid="mk-crumbs">
            <template v-for="(c, i) in crumbs" :key="i">
              <template v-if="i < crumbs.length - 1"><button type="button" @click="c.go()">{{ c.label }}</button><MkIcon name="chev" size="xs" /></template>
              <b v-else>{{ c.label }}</b>
            </template>
          </div>
        </div>
        <span v-else class="one-topbar-fill"></span>
        <!-- The mockup's teamspace top bar: who works here, beside the setup pill. -->
        <div v-if="!isMobile && onTeamspace && teamState.members.length" class="mk"><span v-tooltip="`${teamState.members.length} ${teamState.members.length === 1 ? 'member' : 'members'}`" class="stack"><TeamAvatar v-for="p in teamState.members.slice(0, 5)" :key="p.id" :who="{ kind: 'person', id: p.id }" :label="p.name" size="sm" /></span></div>
        <OneWrapped ref="wrappedRef" />
        <!-- Setup progress, until it is done. Search lives in the sidebar (and Ctrl K). -->
        <OneCapsule @ask="ask" @open-models="openModels" @open-setup="openSetup" />
        <FocusedWindowControls />
      </header>

      <!-- A screen with no One page (a forge's full editor, a goal, a settings
           section…): shown in full, with one way back to where it was opened from. -->
      <div v-if="borrowed" class="focused-borrowed-bar" role="navigation" aria-label="Full screen">
        <button type="button" class="focused-back" data-testid="borrowed-back" @click="leaveBorrowed">
          <i class="fas fa-arrow-left" aria-hidden="true"></i> {{ borrowedBackTo.label }}
        </button>
        <span class="focused-borrowed-title">{{ borrowedTitle }}</span>
      </div>

      <OneTeamPage v-if="page === 'team'" :location="location" />
      <FocusedLibrary v-else-if="page === 'library'" :location="location" />
      <FocusedConnectors v-else-if="page === 'connectors'" :item="location.item" :tab="location.tab" />
      <FocusedGoals v-else-if="page === 'goals'" />
      <FocusedScheduled v-else-if="page === 'scheduled'" :item="location.item" :is-new="location.isNew" />
      <FocusedMemory v-else-if="page === 'memory'" :item="location.item" :is-new="location.isNew" />
      <FocusedSettings v-else-if="page === 'settings'" :section="location.section" />
      <FocusedMarket v-else-if="page === 'market'" :item="location.item" :tab="location.tab" />
      <FocusedActivityDetail v-else-if="page === 'activity' && location.item" :key="location.item" :run-id="location.item" />
      <FocusedActivity v-else-if="page === 'activity'" />

      <!-- The screen Terminal mounted. On a page that is Chat, kept alive
           underneath (v-show) so a reply keeps streaming.
           data-fullscreen-host: the one box a screen's "fullscreen" may fill. -->
      <MkTaskStrip v-if="!isMobile && onChatPage" :conversation-id="activeConversationId" @open-task="(t) => go({ page: 'team', view: 'space', space: t.workspaceId, tab: 'board', task: t.id })" />
      <div v-show="!page" class="focused-screen" data-fullscreen-host>
        <slot />
      </div>
    </main>

    <div v-if="toastText" class="focused-toast" role="status" aria-live="polite">{{ toastText }}</div>
    <OneOffer v-if="offerState.open" :offer="offerState.offer" :now="offerState.now" :compact="isMobile" @dismiss="offerState.dismiss" />
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
import FocusedSidebar from '@/views/Focused/FocusedSidebar.vue';
import FocusedWindowControls from '@/views/Focused/FocusedWindowControls.vue';
import FocusedLibrary from '@/views/Focused/FocusedLibrary.vue';
import FocusedConnectors from '@/views/Focused/FocusedConnectors.vue';
import FocusedScheduled from '@/views/Focused/FocusedScheduled.vue';
import FocusedGoals from '@/views/Focused/FocusedGoals.vue';
import FocusedMemory from '@/views/Focused/FocusedMemory.vue';
import FocusedSettings from '@/views/Focused/FocusedSettings.vue';
import FocusedMarket from '@/views/Focused/FocusedMarket.vue';
import FocusedActivity from '@/views/Focused/FocusedActivity.vue';
import FocusedActivityDetail from '@/views/Focused/FocusedActivityDetail.vue';
import { screenTitle } from '@/views/Focused/focusedModel.js';
import { settingsDirectory } from '@/mobile/sectionDirectories.js';
import { waitUntil } from '@/views/Focused/focusedTime.js';
import { focusedLocation, routeFor, borrowedBack, canonicalLocation } from '@/views/Focused/focusedRoutes.js';
import OneCapsule from './OneCapsule.vue';
import OneOffer from './OneOffer.vue';
import { useOffer } from './useOffer.js';
import OneWrapped from './wrapped/OneWrapped.vue';
import TeamAvatar from './team/TeamAvatar.vue';
import { requestSetup } from './oneSetupRequest.js';
import OneTeamPage from './team/OneTeamPage.vue';
import MkRail from './mk/MkRail.vue';
import MkDrawer from './mk/MkDrawer.vue';
import OutputList from '@/views/Terminal/LeftPanel/types/ChatPanel/components/OutputList.vue';
import MkTaskStrip from './mk/MkTaskStrip.vue';
import MkIcon from './mk/MkIcon.vue';
import { useMkFrame } from './mk/useMkFrame.js';
import './mk/mk.css';
import './mk/mk-frame.css';
import './mk/mk-v2.css';
import { useTeam, teamApi } from './team/useTeam.js';
import { spaceFlow, spaceMark } from './team/teamModel.js';
import { useCheckpoints } from '@/composables/useCheckpoints.js';
import { usePersonalNeeds } from './team/usePersonalNeeds.js';

import { setMainChatToolSelectorShown } from '@/services/chatChannelConfig.js';
import { PLAIN_WORDS_KEY } from '@/composables/plainWords.js';

const { isElectron } = useElectron();

const props = defineProps({
  screenName: { type: String, required: true },
});
defineEmits(['screen-change']);

const store = useStore();
const router = useRouter();
const route = useRoute();
const isMobile = inject('isMobile', ref(false));
// The running offer, if this account can use it: a corner card and a rail button.
const offerState = useOffer();

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

// ── The sidebar (desktop): expanded unless collapsed to the rail, as in ─────
// Studio, and remembered the same way (CanvasScreen's agnt:canvasSidebar:expanded).
// The shared pieces One draws explain themselves in words (labelled buttons, what a limit means).
provide(PLAIN_WORDS_KEY, true);

const SIDEBAR_KEY = 'agnt:oneSidebar:expanded';
function readSidebarPref() {
  try {
    return localStorage.getItem(SIDEBAR_KEY) !== 'false';
  } catch {
    return true;
  }
}
const sidebarExpanded = ref(readSidebarPref());
function setSidebarExpanded(expanded) {
  sidebarExpanded.value = expanded;
  try {
    localStorage.setItem(SIDEBAR_KEY, String(expanded));
  } catch {
    /* storage disabled: the choice still holds for this session */
  }
}

// ── Where we are: read from the route, never kept here ─────────────────────
const location = computed(() => focusedLocation(props.screenName, route.query));
// A workflow opens on its canvas (focusedRoutes routeFor); an old link to it
// in the Library (?select=workflow:ID) goes there too.
watch(
  location,
  (loc) => {
    if (loc?.page !== 'library' || loc.tab !== 'workflows' || !(loc.item || loc.isNew)) return;
    const target = screenRoute('WorkflowForgeScreen', { workflowId: loc.item || null });
    if (target) router.replace({ path: target.path, query: target.query }).catch(() => {});
  },
  { immediate: true },
);
// The old Library and Routines lists each have one home now (Library, Goals): a
// link to either list lands there, so a page is never shown two ways.
watch(
  location,
  (loc) => {
    const home = canonicalLocation(loc);
    if (!home) return;
    const [screen, opts] = routeFor(home);
    const target = screenRoute(screen, opts);
    if (target) router.replace({ path: target.path, query: target.query }).catch(() => {});
  },
  { immediate: true },
);
const page = computed(() => location.value?.page || null);
const borrowed = computed(() => !page.value && props.screenName !== 'ChatScreen');
// A Settings section is named for itself (the same names as One's Settings list).
const SETTINGS_LABELS = new Map(settingsDirectory.flatMap((group) => group.items.map((item) => [item.id, item.label])));
const borrowedTitle = computed(() => (props.screenName === 'SettingsScreen' && SETTINGS_LABELS.get(String(route.query.section || ''))) || screenTitle(props.screenName));
const borrowedBackTo = computed(() => borrowedBack(props.screenName));
function leaveBorrowed() {
  const to = borrowedBackTo.value.loc;
  if (to) go(to);
  else backToChat();
}
// No conversation title in the top bar (removed 2026-10-21): the Chats
// drawer already names the open chat.
const onBlankChat = () => !store.state.chat?.savedOutputId && !(store.state.chat?.messages || []).some((m) => m?.role === 'user');

// The Chats drawer belongs to the chat: on a desktop it shows there only, and
// the other pages get their full width (2026-10-21). drawerOpen is the
// remembered choice, so coming back to the chat brings it back as it was. On a
// phone the drawer is the navigation, an overlay that closes on every move.
const onChatPage = computed(() => !page.value && props.screenName === 'ChatScreen');
const drawerShown = computed(() => drawerOpen.value && (isMobile.value || onChatPage.value));
// The desktop sidebar (chats, My tasks, team spaces) belongs to the chat, a team space and My tasks;
// every other page gets the full width, and the rail is how you move between them.
const sidebarBelongs = computed(() => onChatPage.value || (page.value === 'team' && ['space', 'doc', 'mine', 'inbox'].includes(String(route.query.view || ''))));

// ── Teamspaces: one shared team state for the rail badge, the drawer and the pages ──
const team = useTeam(store);
const teamState = team.state;
// The drawer's andon: each teamspace with stopped work, or at its work limit, from the shared boards.
const spaceMarks = computed(() => Object.fromEntries(teamState.spaces
  .map((s) => [s.id, spaceMark(spaceFlow(teamState.boards[s.id] || [], teamState.limits[s.id] || {}))])
  .filter(([, mark]) => mark)));
const onTeamspace = computed(() => page.value === 'team' && ['space', 'doc'].includes(String(route.query.view || '')));
const teamUnread = team.unread;
// Home is the inbox: its badge is everything waiting on you, team items, checkpoints, routines and goals alike.
const checkpointsWaiting = useCheckpoints();
checkpointsWaiting.loadPending();
const personalNeeds = usePersonalNeeds(store);
personalNeeds.load();
const needsYou = computed(() => teamUnread.value + checkpointsWaiting.pendingCount.value + personalNeeds.count.value);
// The same count for the chat's start screen, so it and the rail badge never disagree.
provide('oneNeedsYou', needsYou);
/** Owners and admins (the server enforces it): a new teamspace, registered with the cloud and opened. */
async function newTeamspace() {
  const name = await prompt({ title: 'New teamspace', message: 'Everyone on the team works in it by their role.', placeholder: 'Product', confirmText: 'Create' });
  if (!name || !name.trim()) return;
  try {
    const created = await teamApi.createSpace(name.trim());
    await team.loadSpaces();
    go({ page: 'team', view: 'space', space: created.id });
  } catch (error) {
    toast(error.message);
  }
}

// The year in review: its capsule in the top bar in season, and More's "Year in review".
const wrappedRef = ref(null);

// The approved mockup's frame: what is lit, the breadcrumbs, where each entry goes, New….
const { mkActive, mkActiveMore, mkDrawerActive, mkCounts, crumbs, mkSelect, mkPick, create, userName, activeConversationId } = useMkFrame({
  store,
  page,
  location,
  screenName: computed(() => props.screenName),
  teamState,
  nav: { go, openScreen: pushScreen, chat: () => backToChat(), ask: (text) => ask(text), prompt: (o) => prompt(o), toast: (t) => toast(t), wrapped: () => wrappedRef.value?.open() },
});

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
  if (id === 'library') go({ page: 'library', tab: 'agents' });
  else if (id === 'files') go({ page: 'library', tab: 'files', dir: '' });
  else if (['connectors', 'scheduled', 'market', 'memory', 'activity', 'settings'].includes(id)) go({ page: id });
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
// The sidebar's Main chat row: lit only while the chat page shows it.
const mainChatRow = computed(() => ({
  open: onChatPage.value && mainChat.isMainOpen.value,
  unread: mainChat.isMainUnread.value,
  streaming: mainChat.isMainStreaming.value,
}));
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
async function toBlankChat() {
  if (onBlankChat()) {
    closeDrawerOnPhone();
    await router.push('/chat').catch(() => {});
  } else {
    const leaving = store.state.chat?.activeConversationId;
    await newChat();
    await waitUntil(() => store.state.chat?.activeConversationId !== leaving, ASK_SWITCH_TIMEOUT_MS, 50);
  }
  await nextTick();
}
async function ask(text) {
  await toBlankChat();
  window.dispatchEvent(new CustomEvent('agnt:ask-annie', { detail: { text, send: false } }));
}
/** A capsule step: the first-run setup at that step, in a blank chat (OneWelcome shows it). */
async function openSetup(step) {
  requestSetup(step);
  await toBlankChat();
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
  openConversation,
  studio: (screen, opts = {}) => pushScreen(screen, { ...opts, studio: true }),
  confirm,
  prompt,
  toast,
  create: (kind) => create(kind),
  newTeamspace,
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
