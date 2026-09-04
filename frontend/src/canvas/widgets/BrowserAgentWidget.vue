<template>
  <div class="browser-widget">
    <!--
      Deliberately ONLY the browser. It has ordinary browser chrome — history,
      reload and address entry — but no task box or provider picker. Agent work
      is still driven from workspace chat exactly like Workflow Forge is, so
      there is one place for provider and model resolution.

      ONE WIDGET, TWO VIEWS. Which one renders is decided below, and the backend
      never learns the difference — it only ever asks "is there a surface, and
      does it answer?".
    -->
    <BrowserNativeView
      v-if="mode === 'native'"
      :widget-instance-id="widgetInstanceId"
      :workspace-id="workspaceId"
      @page="onPage"
      @vue:mounted="watchNativeStatus"
      ref="nativeRef"
    />
    <BrowserStreamView
      v-else
      :workspace-id="workspaceId"
      @page="onPage"
    />
  </div>
</template>

<script setup>
import { ref, watch } from 'vue';
import { API_CONFIG } from '@/tt.config.js';
import { useSurfaceContribution } from '@/canvas/surfaceFederation.js';
import { lazyComponent } from '@/utils/chunkRecovery.js';

// Async so a browser tab never downloads the Electron view's code, and an
// Electron window never downloads the streaming client's.
//
// lazyComponent, NOT a bare defineAsyncComponent: a bare one renders an empty
// div when its chunk 404s after a deploy, which for THIS widget would look
// exactly like the blank-browser bug this whole change exists to fix.
const BrowserNativeView = lazyComponent(() => import('./BrowserNativeView.vue'));
const BrowserStreamView = lazyComponent(() => import('./BrowserStreamView.vue'));

const props = defineProps({
  widgetInstanceId: { type: String, default: '' },
  // Stable owner identity. A browser id is globally unique in practice, but
  // workspaceId is what binds a chat turn to the right family of surfaces.
  workspaceId: { type: String, default: '' },
});

const pageUrl = ref('about:blank');
const pageTitle = ref('');
const nativeRef = ref(null);

/**
 * Is the backend on the machine this client is running on?
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS HALF THE DECISION
 * ---------------------------------------------------------------------------
 * The native view mints a CDP bridge on `127.0.0.1`. That is only useful to a
 * backend which is ALSO on 127.0.0.1 — and AGNT ships a documented topology
 * where it is not (Settings -> Connection, `AGNT_REMOTE_URL`): the desktop app
 * here, the backend on a server.
 *
 * In that setup `window.electron` exists, so a check for Electron alone chooses
 * the native view, the bridge is announced to a backend that cannot reach it,
 * and the agent silently drives a browser on the server while the user watches
 * an empty widget. Streaming is the CORRECT view there, and this is the test
 * that finds it.
 *
 * The address is the one this client actually uses to reach the backend, so it
 * needs no configuration and cannot disagree with reality.
 */
function backendIsLocal() {
  try {
    const { hostname } = new URL(API_CONFIG.BASE_URL, window.location.origin);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
  } catch {
    // An unparseable base URL is a relative one, which means same-origin — and
    // for a served frontend, same origin IS the backend.
    return true;
  }
}

/**
 * Native when we can paint a real Chromium view AND the backend can drive it.
 * Streamed in every other case, which is four of AGNT's five topologies.
 */
function chooseMode() {
  const canEmbed = Boolean(window.electron?.browserBridge);
  return canEmbed && backendIsLocal() ? 'native' : 'stream';
}

const mode = ref(chooseMode());

/**
 * Fall back to streaming if the native view proves it cannot be reached.
 *
 * Belt and braces over `backendIsLocal()`: a tunnel, a proxy or a hosts-file
 * entry can make a remote backend LOOK local. The backend refuses the
 * announcement in that case and says why, and re-deciding on that evidence
 * beats trusting a heuristic that has already been contradicted.
 */
function watchNativeStatus() {
  watch(
    () => nativeRef.value?.status,
    (status) => {
      if (status === 'unreachable-bridge') {
        console.log('[Browser widget] this backend cannot reach a local bridge; switching to a streamed browser.');
        mode.value = 'stream';
      }
    },
  );
}

function onPage({ url, title }) {
  pageUrl.value = url || 'about:blank';
  pageTitle.value = title || '';
}

/**
 * Tell the conversation what this window is showing, so the chat can answer
 * "what's on this page?" without spending a tool call to find out. Inert
 * outside the canvas, which is why it can be called unconditionally — and it
 * is identical for both views, because what is on the page does not depend on
 * how the pixels got here.
 */
useSurfaceContribution(() => ({
  browserState: { url: pageUrl.value, title: pageTitle.value },
}));
</script>

<style scoped>
.browser-widget {
  position: relative;
  width: 100%;
  height: 100%;
  background: #fff;
  overflow: hidden;
}
</style>
