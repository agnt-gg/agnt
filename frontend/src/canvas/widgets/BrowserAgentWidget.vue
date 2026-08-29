<template>
  <div class="browser-widget">
    <!--
      Deliberately ONLY the browser. No task box, no provider picker, no
      toolbar. This widget is a surface, not an app: it is driven from the
      workspace chat exactly like Workflow Forge is, so every control it could
      grow would be a second place to steer from and a second place for the
      provider choice to disagree with the conversation's.
    -->
    <webview
      ref="viewRef"
      class="browser-webview"
      src="about:blank"
      partition="persist:agnt-browser"
    ></webview>

    <div v-if="unavailable" class="browser-unavailable">
      <i class="fas fa-plug"></i>
      <p>{{ unavailable }}</p>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { API_CONFIG } from '@/tt.config.js';
import { useSurfaceContribution } from '@/canvas/surfaceFederation.js';
import { createBridgeSession } from './browserBridgeSession.js';

const props = defineProps({
  widgetInstanceId: { type: String, default: '' },
  // Stable owner identity. A browser id is globally unique in practice, but
  // workspaceId is what binds a chat turn to the right family of surfaces.
  workspaceId: { type: String, default: '' },
});

const viewRef = ref(null);
const pageUrl = ref('about:blank');
const pageTitle = ref('');
const unavailable = ref('');
let session = null;
let heartbeat = null;

// The heartbeat re-asserts BOTH halves of this surface's existence: the bridge
// itself and the backend's knowledge of it.
//
// The registry is in memory, so a backend restart forgets every open browser
// and only this widget still knows the surface is there. And the bridge is tied
// to the guest webContents, which is destroyed and rebuilt on a renderer crash
// or a re-parent — leaving the widget on screen with no bridge behind it. Both
// are repaired by simply saying it again, on a timer. See browserBridgeSession.
const HEARTBEAT_MS = 20000;

/**
 * Tell the conversation what this window is showing, so the chat can answer
 * "what's on this page?" without spending a tool call to find out. Inert
 * outside the canvas, which is why it can be called unconditionally.
 */
useSurfaceContribution(() => ({
  browserState: { url: pageUrl.value, title: pageTitle.value },
}));

const view = () => viewRef.value;
const authHeaders = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${localStorage.getItem('token')}`,
});

/**
 * Announce this surface to the backend, and refresh it as the page moves. The
 * Browser Agent action looks the endpoint up rather than being handed it — a
 * ws:// URL has no business travelling through a conversation.
 */
async function announce(cdpUrl) {
  if (!cdpUrl || !props.widgetInstanceId) return;
  try {
    await fetch(`${API_CONFIG.BASE_URL}/browser-agent/surface`, {
      method: 'POST',
      credentials: 'include',
      headers: authHeaders(),
      body: JSON.stringify({
        instanceId: props.widgetInstanceId,
        workspaceId: props.workspaceId,
        cdpUrl,
        url: pageUrl.value,
        title: pageTitle.value,
      }),
    });
  } catch { /* the agent falls back to its own browser; nothing to recover here */ }
}

function syncPage() {
  try {
    pageUrl.value = view()?.getURL() || 'about:blank';
    pageTitle.value = view()?.getTitle() || '';
  } catch { /* the guest is gone */ }
  // Re-assert rather than announce: a navigation is also the moment a crashed
  // guest comes back with a new webContents id and no bridge behind it.
  session?.refresh();
}

onMounted(async () => {
  await nextTick();
  const el = view();
  if (!el) return;

  const api = window.electron?.browserBridge;
  if (!api) {
    // This widget renders a real Chromium view through Electron. In a plain
    // browser tab there is nothing to embed, and saying so beats a blank pane.
    unavailable.value = 'The Browser widget needs the AGNT desktop app.';
    return;
  }

  session = createBridgeSession({
    bridgeApi: api,
    getWebContentsId: () => view()?.getWebContentsId() ?? null,
    announce,
    onStatus: (message) => { unavailable.value = message; },
  });

  // NOT `{ once: true }`. dom-ready fires again every time the guest is rebuilt
  // — a crash, a reap, a re-parent — and each rebuild is a new webContents with
  // no bridge. Opening only on the first one is what left the widget on screen
  // with a dead endpoint and no way back.
  el.addEventListener('dom-ready', () => session?.refresh());
  el.addEventListener('did-navigate', syncPage);
  el.addEventListener('did-navigate-in-page', syncPage);
  el.addEventListener('page-title-updated', syncPage);
  // Belt and braces: react to the guest dying instead of waiting for the next
  // navigation or the next heartbeat tick.
  el.addEventListener('destroyed', () => session?.refresh());
  el.addEventListener('crashed', () => session?.refresh());
  el.addEventListener('render-process-gone', () => session?.refresh());

  heartbeat = setInterval(() => session?.refresh(), HEARTBEAT_MS);
});

onBeforeUnmount(() => {
  clearInterval(heartbeat);
  // Withdraw the surface first: a registry entry pointing at a bridge that is
  // about to close would send the next chat turn to a dead socket. This is a
  // best-effort courtesy, not the guarantee — a reload or a crash never runs
  // it, which is why the backend proves liveness before using an entry.
  if (props.widgetInstanceId) {
    fetch(`${API_CONFIG.BASE_URL}/browser-agent/surface/${props.widgetInstanceId}`, {
      method: 'DELETE',
      credentials: 'include',
      headers: authHeaders(),
    }).catch(() => {});
  }
  session?.stop();
  session = null;
});
</script>

<style scoped>
.browser-widget {
  position: relative;
  width: 100%;
  height: 100%;
  background: #fff;
  overflow: hidden;
}

.browser-webview {
  width: 100%;
  height: 100%;
  border: none;
  display: inline-flex;
}

.browser-unavailable {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: var(--color-bg, #0b0b14);
  color: var(--color-text-muted, #9a9ab5);
  font-size: 13px;
  text-align: center;
  padding: 20px;
}
</style>
