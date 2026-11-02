<template>
  <!-- Teamspaces in Studio: the teamspace list on the left, the page on the right. Both are the same
       components AGNT One uses (views/One/mk/MkDrawer, views/One/team/OneTeamPage), so the two layouts
       can never show different team data. Only the frame around them is Studio's. -->
  <BaseScreen screenId="TeamScreen" @screen-change="(s) => emit('screen-change', s)">
    <template #default>
      <div class="studio-team" data-testid="studio-team">
        <MkDrawer
          class="studio-team-nav"
          :team="teamState.team"
          :teams="teamState.teams"
          :spaces="teamState.spaces"
          :active="mkDrawerActive"
          :counts="mkCounts"
          @go="(loc) => go({ page: 'team', ...loc })"
          @pick="mkPick"
          @find="store.dispatch('shell/openJump')"
          @new-space="newTeamspace"
          @error="toast"
        />
        <section class="studio-team-page">
          <OneTeamPage :location="location" />
        </section>
      </div>
      <SimpleModal ref="modalRef" />
      <div v-if="toastText" class="studio-team-toast" role="status">{{ toastText }}</div>
    </template>
  </BaseScreen>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, provide, ref } from 'vue';
import { useStore } from 'vuex';
import { useRoute, useRouter } from 'vue-router';
import BaseScreen from '@/views/Terminal/CenterPanel/BaseScreen.vue';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import MkDrawer from '@/views/One/mk/MkDrawer.vue';
import OneTeamPage from '@/views/One/team/OneTeamPage.vue';
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
const page = computed(() => 'team');
const team = useTeam(store);
const teamState = team.state;

// ── Going places: route pushes; in Studio every screen opens in full ─────────
function pushScreen(screen, opts = {}) {
  const target = screenRoute(screen, opts);
  if (target) router.push({ path: target.path, query: target.query }).catch(() => {});
}
function go(loc) {
  const [screen, opts] = routeFor(loc);
  pushScreen(screen, opts);
}
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

// The teamspace list's state and its New… flows: the same wiring One's frame uses.
const { mkDrawerActive, mkCounts, mkPick, create } = useMkFrame({
  store, page, location, screenName: computed(() => 'TeamScreen'), teamState, nav: { go, chat, ask, prompt, toast },
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
.studio-team { display: flex; height: 100%; min-height: 0; overflow: hidden; }
.studio-team-nav { flex: none; height: 100%; }
/* In Studio the list is a sub-nav of the Team row, drawn like Studio's own rail (CanvasScreen
   .cv-sb-*): Studio's top bar already has the space switcher and Ctrl+K search, so the list drops
   its own; captions, the active row and borders use Studio's look, not One's. */
.studio-team-nav :deep(.drawer-head),
.studio-team-nav :deep(.find-btn) { display: none; }
.studio-team-nav :deep(.drawer) { width: 196px; border-left: 0; border-right: 1px solid var(--terminal-border-color); background: transparent; padding-top: 8px; }
.studio-team-nav :deep(.d-head) { font-size: 9px; font-weight: 600; letter-spacing: 0.13em; text-transform: uppercase; color: var(--color-text-muted); opacity: 0.8; }
.studio-team-nav :deep(.d-head svg) { display: none; }
/* A child of the Team row: smaller than the rail, and selected with a quiet fill (the rail's bordered
   pill marks Team itself). */
.studio-team-nav :deep(.d-item) { min-height: 28px; padding-top: 4px; padding-bottom: 4px; border-radius: 7px; font-size: 12px; }
.studio-team-nav :deep(.d-item svg) { width: 14px; height: 14px; }
.studio-team-nav :deep(.d-item.is-active) { color: var(--text-primary); background: var(--surface-active); }
.studio-team-nav :deep(.mk-new-anchor > .d-item) { color: var(--text-secondary) !important; font-weight: 400 !important; }
.studio-team-nav :deep(.d-item > span:first-child) { filter: grayscale(1); opacity: 0.75; }
.studio-team-page :deep(.mk) { background: transparent; }
.studio-team-page { flex: 1; min-width: 0; height: 100%; overflow: auto; }
.studio-team-toast {
  position: absolute; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 50;
  padding: 8px 14px; border-radius: 10px; border: 1px solid var(--terminal-border-color);
  background: var(--color-popup, var(--color-background)); color: var(--text-primary); font-size: 13px;
}
</style>
