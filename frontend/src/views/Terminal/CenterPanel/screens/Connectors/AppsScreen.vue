<template>
  <!-- The Plugins page (/plugins). In Studio: AGNT One's Apps page (FocusedConnectors),
       the same component One draws, in Studio's center panel. Inside One's frame (its
       "full editor" visits) and for ?studio=1: the full Connectors screen, as before. -->
  <Connectors v-if="fullScreen" />
  <BaseScreen v-else screenId="ConnectorsScreen" :activeLeftPanel="false" :activeRightPanel="false">
    <template #default>
      <!-- .ui-focused is the scope focused.css styles One's pages under. -->
      <div class="ui-focused studio-apps-page" data-testid="studio-apps">
        <FocusedConnectors :item="location.item || null" :tab="location.tab || ''" />
      </div>
      <SimpleModal ref="modalRef" />
      <div v-if="toastText" class="studio-apps-toast" role="status">{{ toastText }}</div>
    </template>
  </BaseScreen>
</template>

<script setup>
import { computed, inject, provide, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import BaseScreen from '@/views/Terminal/CenterPanel/BaseScreen.vue';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import FocusedConnectors from '@/views/Focused/FocusedConnectors.vue';
import { focusedLocation, routeFor } from '@/views/Focused/focusedRoutes.js';
import { screenRoute } from '@/views/Terminal/screenRoute.js';
import { useStudioPageNav } from '../useStudioPageNav.js';
import Connectors from './Connectors.vue';

const SCREEN = 'ConnectorsScreen';
const route = useRoute();
const router = useRouter();
const inOne = !!inject('focusedNav', null);

// Terminal keeps this screen alive while others show: follow the route only while it is this screen's.
const isHere = () => route.meta?.terminalScreen === SCREEN;
const readLocation = () => focusedLocation(SCREEN, route.query);
const routeLocation = ref(isHere() ? readLocation() : null);
watch(() => route.fullPath, () => { if (isHere()) routeLocation.value = readLocation(); });

const fullScreen = computed(() => inOne || (isHere() && !routeLocation.value));
const location = computed(() => (routeLocation.value?.page === 'connectors' ? routeLocation.value : { page: 'connectors', item: null, tab: '' }));

// An old link this page does not answer (?section=providers is the AI models, in Settings) goes where One sends it.
watch(routeLocation, (loc) => {
  if (inOne || !loc || loc.page === 'connectors') return;
  const [screen, opts] = routeFor(loc);
  const target = screenRoute(screen, opts);
  if (target) router.replace({ path: target.path, query: target.query }).catch(() => {});
}, { immediate: true });

const { pushScreen, chat, ask, openConversation, modalRef, confirm, prompt, toastText, toast } = useStudioPageNav();
const go = (loc) => pushScreen(...routeFor(loc));

if (!inOne) {
  // What One's pages ask their frame for (OneShell provides the same). `studio` opens a
  // screen's full editor: the same route with ?studio=1, which shows Connectors here.
  provide('focusedNav', {
    openScreen: pushScreen,
    go,
    ask,
    chat,
    openConversation,
    studio: (screen, opts = {}) => pushScreen(screen, { ...opts, studio: true }),
    confirm,
    prompt,
    toast,
  });
}
</script>

<!-- One's Apps page drawn in Studio's language (headings, buttons, badges, cards). -->
<style src="@/views/One/apps/appsStudio.css"></style>
<style scoped>
/* A flex child of the center panel: min-width: 0 keeps the page's tables from widening it past the window. */
.studio-apps-page { flex: 1 1 0; min-width: 0; width: 100%; height: 100%; min-height: 0; overflow: auto; display: flex; flex-direction: column; }
.studio-apps-toast {
  position: absolute; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 50;
  padding: 8px 14px; border-radius: 10px; border: 1px solid var(--terminal-border-color);
  background: var(--color-popup, var(--color-background)); color: var(--text-primary); font-size: 13px;
}
</style>
