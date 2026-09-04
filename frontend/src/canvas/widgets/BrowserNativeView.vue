<template>
  <!--
    The Electron path, unchanged. A real Chromium view painted natively by the
    compositor: real scrolling, real input, real GPU. Nothing a screencast does
    can match it, which is why this is kept rather than replaced when the
    streamed view arrived.
  -->
  <div class="native-view">
    <BrowserToolbar
      :url="pageUrl"
      :can-go-back="canGoBack"
      :can-go-forward="canGoForward"
      :busy="loading"
      @back="goBack"
      @forward="goForward"
      @reload="reload"
      @navigate="navigate"
    />

    <div class="native-page">
      <webview
        ref="viewRef"
        class="browser-webview"
        src="about:blank"
        partition="persist:agnt-browser"
      ></webview>

      <div v-if="status" class="view-status">
      <i class="fas fa-plug"></i>
        <p>{{ status }}</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { API_CONFIG } from '@/tt.config.js';
import { createBridgeSession } from './browserBridgeSession.js';
import BrowserToolbar from './BrowserToolbar.vue';

const props = defineProps({
  widgetInstanceId: { type: String, default: '' },
  workspaceId: { type: String, default: '' },
});

const emit = defineEmits(['page']);

const viewRef = ref(null);
const status = ref('');
const pageUrl = ref('about:blank');
const pageTitle = ref('');
const canGoBack = ref(false);
const canGoForward = ref(false);
const loading = ref(false);
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
    const response = await fetch(`${API_CONFIG.BASE_URL}/browser-agent/surface`, {
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

    // A REFUSAL THAT MEANS "YOU ARE ON THE WRONG MACHINE".
    //
    // The backend can only drive a loopback bridge that is on ITS machine. When
    // the desktop app is pointed at a remote backend, this bridge is real and
    // correct and simply unreachable from there. Retrying forever would be the
    // old silent failure with extra steps, so the parent is told to stream.
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      if (body?.reason === 'unreachable') status.value = 'unreachable-bridge';
    }
  } catch { /* the agent falls back to its own browser; nothing to recover here */ }
}

function syncPage() {
  try {
    pageUrl.value = view()?.getURL() || 'about:blank';
    pageTitle.value = view()?.getTitle() || '';
    canGoBack.value = Boolean(view()?.canGoBack());
    canGoForward.value = Boolean(view()?.canGoForward());
  } catch { /* the guest is gone */ }
  emit('page', { url: pageUrl.value, title: pageTitle.value });
  // Re-assert rather than announce: a navigation is also the moment a crashed
  // guest comes back with a new webContents id and no bridge behind it.
  session?.refresh();
}

function goBack() {
  if (view()?.canGoBack()) view().goBack();
}

function goForward() {
  if (view()?.canGoForward()) view().goForward();
}

function reload() {
  view()?.reload();
}

function navigate(url) {
  if (!/^https?:\/\//i.test(url)) return;
  view()?.loadURL(url);
}

onMounted(async () => {
  await nextTick();
  const el = view();
  if (!el) return;

  const api = window.electron?.browserBridge;
  if (!api) {
    status.value = 'The Browser widget needs the AGNT desktop app.';
    return;
  }

  session = createBridgeSession({
    bridgeApi: api,
    getWebContentsId: () => view()?.getWebContentsId() ?? null,
    announce,
    onStatus: (message) => { status.value = message; },
  });

  // NOT `{ once: true }`. dom-ready fires again every time the guest is rebuilt
  // — a crash, a reap, a re-parent — and each rebuild is a new webContents with
  // no bridge. Opening only on the first one is what left the widget on screen
  // with a dead endpoint and no way back.
  el.addEventListener('dom-ready', () => session?.refresh());
  el.addEventListener('did-navigate', syncPage);
  el.addEventListener('did-navigate-in-page', syncPage);
  el.addEventListener('page-title-updated', syncPage);
  el.addEventListener('did-start-loading', () => { loading.value = true; });
  el.addEventListener('did-stop-loading', () => {
    loading.value = false;
    syncPage();
  });
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

defineExpose({ status });
</script>

<style scoped>
.native-view {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.native-page {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
}

.browser-webview {
  width: 100%;
  height: 100%;
  border: none;
  display: inline-flex;
}

.view-status {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: var(--color-bg, #0b0b14);
  color: var(--color-text-muted, #556);
  font-size: 13px;
  text-align: center;
  padding: 20px;
}
</style>
