<template>
  <!-- Teamspaces in Studio: Studio's own layout. Left panel: TeamPanel (My Space, teamspaces).
       Center: the team page, the same component AGNT One draws (views/One/team/OneTeamPage). -->
  <BaseScreen
    screenId="TeamScreen"
    :leftPanelProps="{ active: activeRow }"
    @panel-action="onPanelAction"
    @screen-change="(s) => emit('screen-change', s)"
  >
    <template #default>
      <div class="studio-team-page" data-testid="studio-team">
        <!-- My routines / My files (and New routine, New agent) open here, in the center panel, with
             One's own page components. .ui-focused is the scope focused.css styles them under. -->
        <div v-if="inline" class="ui-focused studio-team-inline" :data-inline="inline.page">
          <FocusedScheduled v-if="inline.page === 'scheduled'" :key="'s:' + (inline.item || '') + (inline.isNew ? ':new' : '')" :item="inline.item || null" :is-new="!!inline.isNew" />
          <FocusedLibrary v-else :location="inline" />
        </div>
        <OneTeamPage v-else :location="location" />
      </div>
      <SimpleModal ref="modalRef" />
      <div v-if="toastText" class="studio-team-toast" role="status">{{ toastText }}</div>
    </template>
  </BaseScreen>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, provide, ref, watch } from 'vue';
import { useStore } from 'vuex';
import { useRoute, useRouter } from 'vue-router';
import BaseScreen from '@/views/Terminal/CenterPanel/BaseScreen.vue';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import OneTeamPage from '@/views/One/team/OneTeamPage.vue';
import FocusedScheduled from '@/views/Focused/FocusedScheduled.vue';
import FocusedLibrary from '@/views/Focused/FocusedLibrary.vue';
import { useMkFrame } from '@/views/One/mk/useMkFrame.js';
import { useTeam, teamApi } from '@/views/One/team/useTeam.js';
import { focusedLocation, routeFor } from '@/views/Focused/focusedRoutes.js';
import { screenRoute } from '@/views/Terminal/screenRoute.js';

const emit = defineEmits(['screen-change']);
const store = useStore();
const route = useRoute();
const router = useRouter();

// Where we are, read from the route (/team?view=…&space=…), exactly as One reads it.
const location = computed(() => focusedLocation('TeamScreen', route.query) || { page: 'team', view: 'home' });
const team = useTeam(store);

// ── Going places: route pushes; in Studio every screen opens in full ─────────
function pushScreen(screen, opts = {}) {
  const target = screenRoute(screen, opts);
  if (target) router.push({ path: target.path, query: target.query }).catch(() => {});
}
// Pages the Team screen shows in its own center panel instead of leaving for a full screen
// (in Studio, Routines would open Goals and My files the Files screen).
const INLINE_PAGES = new Set(['scheduled', 'library']);
const inline = ref(null);
function go(loc) {
  if (loc && INLINE_PAGES.has(loc.page)) { inline.value = { ...loc }; return; }
  if (loc?.page === 'team') inline.value = null;
  const [screen, opts] = routeFor(loc);
  pushScreen(screen, opts);
}
// Arriving at /team from anywhere else (the rail, a link) shows the team page again.
watch(() => route.fullPath, () => { inline.value = null; });
const chat = () => router.push('/chat').catch(() => {});
async function ask(text) {
  await router.push('/chat').catch(() => {});
  await nextTick();
  window.dispatchEvent(new CustomEvent('trigger-new-chat'));
  setTimeout(() => window.dispatchEvent(new CustomEvent('agnt:ask-annie', { detail: { text, send: false } })), 300);
}

// ── Dialogs, through the app's own modal ───────────────────────────────────
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
  toastTimer = setTimeout(() => (toastText.value = ''), 2600);
}
onBeforeUnmount(() => clearTimeout(toastTimer));

// My Space rows, New… and which row is lit: the same wiring One's frame uses.
const { mkDrawerActive, mkPick, create } = useMkFrame({
  store, page: computed(() => 'team'), location, screenName: computed(() => 'TeamScreen'), teamState: team.state, nav: { go, chat, ask, prompt, toast },
});
const activeRow = computed(() => {
  if (inline.value) return inline.value.page === 'scheduled' ? 'mine-routines' : inline.value.tab === 'files' ? 'mine-files' : null;
  return mkDrawerActive.value || (location.value.view === 'home' || location.value.view === 'inbox' ? 'home' : null);
});
async function newTeamspace() {
  const name = await prompt({ title: 'New teamspace', message: 'Everyone on the team works in it by their role.', placeholder: 'Product', confirmText: 'Create' });
  if (!name || !name.trim()) return;
  try {
    const created = await teamApi.createSpace(name.trim());
    await team.loadSpaces();
    go({ page: 'team', view: 'space', space: created.id });
  } catch (error) { toast(error.message); }
}

/** TeamPanel's rows. */
function onPanelAction(action, payload) {
  if (action === 'team-go') go({ page: 'team', ...payload });
  else if (action === 'team-pick') mkPick(payload);
  else if (action === 'team-new-space') newTeamspace();
}

// The service the team pages ask for where to go and how to ask (One's frame provides the same).
provide('focusedNav', {
  openScreen: pushScreen,
  go,
  ask,
  chat,
  openConversation: (outputId) => router.push({ path: '/chat', query: { 'content-id': outputId } }).catch(() => {}),
  studio: pushScreen,
  confirm,
  prompt,
  toast,
  create: (kind) => create(kind),
});
</script>

<style scoped>
/* A flex child of the center panel: without min-width: 0 it grew to its widest child (the Library's
   scrolling rail, 1,840px) and the page was laid out wider than the window and clipped. */
.studio-team-page { flex: 1 1 0; min-width: 0; width: 100%; height: 100%; min-height: 0; overflow: hidden; display: flex; flex-direction: column; }
/* The team page (.mk-page, flex: 1) fills the center panel exactly, so only its chat log scrolls and the
   composer stays on screen. As a block parent let it grow to its content: the whole page scrolled and
   the composer was cut off at the bottom. The inline Routines / Files pages scroll in their own box. */
.studio-team-page > :deep(.mk-page) { flex: 1 1 0; min-height: 0; }
.studio-team-page :deep(.mk) { background: transparent; }
.studio-team-inline { flex: 1 1 0; min-height: 0; overflow: auto; }
.studio-team-toast {
  position: absolute; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 50;
  padding: 8px 14px; border-radius: 10px; border: 1px solid var(--terminal-border-color);
  background: var(--color-popup, var(--color-background)); color: var(--text-primary); font-size: 13px;
}
</style>
