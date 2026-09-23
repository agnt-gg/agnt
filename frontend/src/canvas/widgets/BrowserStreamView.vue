<template>
  <!--
    The everywhere path: a browser the BACKEND owns, streamed here as frames.
    Used by a plain browser tab, a paired phone, and the desktop app pointed at
    a remote backend — three topologies that have no <webview> to embed, or one
    that is on the wrong machine to be driven.
  -->
  <div class="stream-view">
    <BrowserToolbar
      :url="currentUrl"
      :can-go-back="canGoBack"
      :can-go-forward="canGoForward"
      :busy="navigating"
      @back="goBack"
      @forward="goForward"
      @reload="reload"
      @navigate="navigate"
    />

    <p v-if="hasFrame" class="stream-freshness" role="status">{{ frameDescription }}</p>
    <div class="stream-page">
      <canvas
      ref="canvasRef"
      class="stream-canvas"
      tabindex="0"
      @mousedown="onMouse"
      @mouseup="onMouse"
      @mousemove="onMouseMove"
      @wheel.prevent="onWheel"
      @keydown.prevent="onKey"
      @keyup.prevent="onKey"
    ></canvas>

      <div v-if="!hasFrame || error" class="stream-status">
        <i :class="waiting ? 'fas fa-circle-notch fa-spin' : 'fas fa-globe'"></i>
        <p role="status">{{ statusText }}</p>
        <button v-if="error" type="button" @click="retryView">Retry live view</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { API_CONFIG } from '@/tt.config.js';
import { getRealtimeSocket } from '@/composables/useRealtimeSync.js';
import { viewportToPage } from './streamGeometry.js';
import BrowserToolbar from './BrowserToolbar.vue';

const props = defineProps({
  workspaceId: { type: String, default: '' },
  /**
   * May a missing browser be OPENED to satisfy this viewer?
   *
   * True for the canvas widget: it is placed BECAUSE a browser step is
   * starting, so opening one is the whole job. False for the inline chat
   * card, which appears alongside a step that already opened its own — a
   * card that launched would open a browser merely by being rendered,
   * including when the user scrolls back through an old conversation.
   */
  launch: { type: Boolean, default: true },
});

const emit = defineEmits(['page', 'history']);

const canvasRef = ref(null);
const hasFrame = ref(false);
const waiting = ref(true);
const error = ref('');
const currentUrl = ref('about:blank');
const canGoBack = ref(false);
const canGoForward = ref(false);
const navigating = ref(false);

let instanceId = null;
let socket = null;
let retryTimer = null;
let socketTimer = null;
let painting = false;
let pendingFrame = null;
let decodeTimer = null;
let decodeSerial = 0;
let seenLiveFrame = false;
let viewportSize = null;
let observationOnly = false;
let viewerId = null;
let streamId = null;
const frameDescription = ref('');
let disposed = false;
let authenticated = false;
let authenticatedUserId = null;
let generation = 0;
let subscribing = false;
let frameTimer = null;
let authTimer = null;
let registrationTimer = null;
let renewalTimer = null;
let renewalDeadline = null;
let channelDeadline = null;
const phase = ref('Connecting to the live-view channel…');

/**
 * How often to re-ask for a surface while none exists.
 *
 * There is usually nothing to watch when this mounts: the widget opens the
 * instant the tool is CALLED (TOOL_WIDGET_MAP), and the backend has not yet
 * launched a browser. So "no surface" is the normal starting state, not an
 * error, and the view waits for one rather than telling the user off.
 */
const RETRY_MS = 1500;

const statusText = computed(() => {
  if (error.value) return error.value;
  return phase.value;
});

const authHeaders = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${localStorage.getItem('token')}`,
});

/**
 * Paint one frame.
 *
 * Shared capture advances on a render/drop ACK from any viewer. Locally keep
 * one decoder plus the newest pending frame; superseded frames are dropped.
 */
function ackFrame(payload) {
  if (socket?.connected && authenticated && payload.frameId != null) {
    socket.emit('browser:ack', { instanceId: payload.instanceId, viewerId, frameId: payload.frameId, streamId: payload.streamId });
  }
}

function paint(payload) {
  const canvas = canvasRef.value;
  if (!canvas || disposed) return;
  if (painting) {
    if (pendingFrame) ackFrame(pendingFrame);
    pendingFrame = payload;
    return;
  }
  const epoch = generation;
  painting = true;
  const serial = ++decodeSerial;
  const image = new Image();
  const complete = () => {
    clearTimeout(decodeTimer); painting = false; ackFrame(payload);
    const next = pendingFrame; pendingFrame = null;
    if (next) paint(next);
  };
  decodeTimer = setTimeout(() => {
    if (disposed || epoch !== generation || serial !== decodeSerial) return;
    decodeSerial += 1;
    error.value = 'Browser frame decoding timed out. Retry the live view.';
    waiting.value = false; complete();
  }, 5000);
  image.onload = () => {
    if (disposed || epoch !== generation || serial !== decodeSerial) return;
    painting = false;
    try {
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas rendering is unavailable.');
      if (payload.source === 'snapshot' && seenLiveFrame) { complete(); return; }
      if (!Number.isFinite(image.width) || !Number.isFinite(image.height) || image.width <= 0 || image.height <= 0 || image.width > 1280 || image.height > 800) throw new Error('Browser frame exceeds the size limit.');
      viewportSize = payload.metadata;
      canvas.width = image.width; canvas.height = image.height;
      context.drawImage(image, 0, 0);
      // Receipt/decoding alone is not success: only painted live pixels can
      // supersede a fallback snapshot for this subscription generation.
      if (payload.source !== 'snapshot') seenLiveFrame = true;
      socket?.emit('browser:painted', {instanceId, viewerId, streamId, ...(payload.bootstrapId ? {bootstrapId:payload.bootstrapId} : {})});
      hasFrame.value = true; waiting.value = false; error.value = '';
      frameDescription.value = payload.source === 'snapshot'
        ? 'Snapshot received — continuous live updates not yet confirmed.'
        : 'Last received browser frame — unchanged pixels alone do not prove stream health.';
      clearTimeout(frameTimer);
    } catch (err) { error.value = err.message; }
    complete();
  };
  image.onerror = () => {
    if (disposed || epoch !== generation || serial !== decodeSerial) return;
    painting = false;
    error.value = 'Connected, but the browser frame could not be decoded.';
    complete();
  };
  image.src = `data:image/jpeg;base64,${payload.data}`;
}

function releaseLease(id, lease) {
  if (!id || !lease) return;
  fetch(`${API_CONFIG.BASE_URL}/browser-agent/view/${encodeURIComponent(id)}?viewerId=${encodeURIComponent(lease)}`, {
    method: 'DELETE', credentials: 'include', headers: authHeaders(), keepalive: true,
  }).catch(() => {});
}

function clearSubscription() {
  generation += 1;
  // Erase the backing bitmap, not just its overlay. Identity changes must not
  // retain old-user pixels or navigation metadata while new work is pending.
  if (canvasRef.value) { canvasRef.value.width = 0; canvasRef.value.height = 0; }
  currentUrl.value = ''; canGoBack.value = false; canGoForward.value = false;
  emit('page', { url: '', title: '' });
  emit('history', { canGoBack: false, canGoForward: false });
  decodeSerial += 1; clearTimeout(decodeTimer); pendingFrame = null; seenLiveFrame = false; viewportSize = null;
  if (instanceId && viewerId && socket?.connected) socket.emit('browser:unwatching', {instanceId, viewerId});
  clearTimeout(renewalTimer); clearTimeout(renewalDeadline);
  clearTimeout(retryTimer); clearTimeout(frameTimer); clearTimeout(registrationTimer);
  releaseLease(instanceId, viewerId);
  instanceId = null; viewerId = null; streamId = null; frameDescription.value = ''; navigating.value = false; subscribing = false; painting = false;
  hasFrame.value = false; waiting.value = true;
}

function scheduleRenewal() {
  clearTimeout(renewalTimer);
  const epoch = generation;
  renewalTimer = setTimeout(() => {
    if (disposed || epoch !== generation || !instanceId) return;
    const failed = () => {
      if (disposed || epoch !== generation) return;
      clearSubscription(); error.value = 'Live-view lease renewal failed. Retry the live view.'; waiting.value = false;
    };
    renewalDeadline = setTimeout(failed, 5000);
    if (!socket?.connected || !authenticated) { failed(); return; }
    socket.emit('browser:renew', { instanceId, viewerId }, result => {
      if (disposed || epoch !== generation) return;
      clearTimeout(renewalDeadline);
      if (!result?.ok) failed(); else scheduleRenewal();
    });
  }, 15000);
}

function armChannelDeadline() {
  clearTimeout(channelDeadline);
  channelDeadline = setTimeout(() => {
    if (!disposed && (!socket?.connected || !authenticated)) {
      error.value = 'Live-view channel unavailable or connection timed out. Retry the live view.';
      waiting.value = false;
    }
  }, 8000);
}

function armFrameDeadline() {
  clearTimeout(frameTimer);
  frameTimer = setTimeout(() => {
    if (!hasFrame.value && instanceId && !disposed) {
      waiting.value = false;
      error.value = 'Browser connected, but no frame was received. Retry the live view.';
    }
  }, 8000);
}

async function startWatching() {
  const epoch = generation;
  subscribing = true;
  phase.value = 'Connecting to the browser stream…';
  // A lost HTTP response can leave a pending server lease. The server expires
  // it; this client bounds the request so its UI cannot spin forever.
  const controller = new AbortController();
  const requestTimer = setTimeout(() => controller.abort(), 12000);
  try {
    const capabilities = await fetch(`${API_CONFIG.BASE_URL}/browser-agent/view-capabilities`, { headers: authHeaders(), credentials: 'include', signal: controller.signal });
    const protocol = await capabilities.json().catch(() => ({}));
    if (disposed || epoch !== generation) return 'stop';
    if (!capabilities.ok || protocol.protocolVersion !== 2) {
      error.value = 'Live-view protocol mismatch. Update or refresh the backend and client.'; waiting.value = false; return 'stop';
    }
    const response = await fetch(`${API_CONFIG.BASE_URL}/browser-agent/view`, {
      method: 'POST', credentials: 'include', headers: authHeaders(), signal: controller.signal,
      body: JSON.stringify({ workspaceId: props.workspaceId, launch: props.launch && !observationOnly, protocolVersion: 2 }),
    });
    const body = await response.json().catch(() => ({}));
    if (disposed || epoch !== generation || !authenticated || !socket?.connected) {
      if (response.ok) releaseLease(body.instanceId, body.viewerId);
      return 'stop';
    }
    if (!response.ok) {
      if (response.status === 404) { error.value = ''; phase.value = 'No browser is open yet. Waiting for one…'; return false; }
      error.value = body.error || 'Could not watch that browser.';
      waiting.value = false;
      return [401,403,426,503].includes(response.status) ? 'stop' : false;
    }
    if (!body.instanceId || !body.viewerId || !body.streamId) {
      error.value = 'Live-view protocol mismatch. Update the backend and client together.';
      waiting.value = false; return 'stop';
    }
    observationOnly = true;
    instanceId = body.instanceId; viewerId = body.viewerId; streamId = body.streamId;
    error.value = ''; phase.value = 'Browser connected. Waiting for its first frame…';
    armFrameDeadline();
    const registrationFailed = () => {
      if (disposed || epoch !== generation) return;
      clearSubscription(); error.value = 'Live-view registration failed. Retry the live view.'; waiting.value = false;
    };
    registrationTimer = setTimeout(registrationFailed, 5000);
    socket.emit('browser:watching', { instanceId, viewerId }, (result) => {
      if (disposed || epoch !== generation) return;
      clearTimeout(registrationTimer);
      if (!result?.ok) registrationFailed(); else scheduleRenewal();
    });
    if (body.url) { currentUrl.value = body.url; emit('page', { url: body.url, title: '' }); }
    refreshHistory();
    return true;
  } catch (err) {
    if (epoch !== generation || disposed) return 'stop';
    error.value = `Could not reach the live-view server: ${err.message}`;
    waiting.value = false;
    return false;
  } finally {
    clearTimeout(requestTimer);
    if (epoch === generation) subscribing = false;
  }
}

async function pollForSurface() {
  if (disposed || document.visibilityState === 'hidden' || !authenticated || !socket?.connected || instanceId || subscribing) return;
  const epoch = generation;
  const started = await startWatching();
  if (disposed || epoch !== generation || started === true || started === 'stop') return;
  retryTimer = setTimeout(pollForSurface, RETRY_MS);
}

function retryView() {
  clearSubscription(); error.value = '';
  armChannelDeadline();
  if (authenticated && socket?.connected) pollForSurface();
  else requestAuthentication();
}

// ── input ──────────────────────────────────────────────────────────────────

/**
 * Where this event lands on the page, or null if it lands on nothing.
 *
 * The canvas keeps the frame aspect ratio (object-fit: contain), so it is
 * painted into a letterboxed sub-rectangle and a click on the bars is not a
 * click on the page at all. See streamGeometry.js for the arithmetic and
 * why scaling by the element size is wrong.
 */
function pagePoint(event) {
  const canvas = canvasRef.value;
  if (!canvas) return null;
  const point = viewportToPage({
    clientX: event.clientX,
    clientY: event.clientY,
    rect: canvas.getBoundingClientRect(),
    frameWidth: canvas.width,
    frameHeight: canvas.height,
  });
  if (!point) return null;
  return { x: point.x * (viewportSize?.deviceWidth || canvas.width) / canvas.width, y: point.y * (viewportSize?.deviceHeight || canvas.height) / canvas.height };
}

const MOUSE_TYPES = { mousedown: 'mousePressed', mouseup: 'mouseReleased', mousemove: 'mouseMoved' };

function sendInput(method, params) {
  if (!instanceId || !authenticated || !socket?.connected || !hasFrame.value) return;
  socket?.emit('browser:input', { instanceId, method, params });
}

function onMouse(event) {
  canvasRef.value?.focus();
  // null means the letterbox bar rather than the page.
  const point = pagePoint(event);
  if (!point) return;
  sendInput('Input.dispatchMouseEvent', {
    type: MOUSE_TYPES[event.type],
    x: point.x,
    y: point.y,
    button: ['left', 'middle', 'right'][event.button] || 'left',
    clickCount: 1,
    modifiers: modifierBits(event),
  });
}

let lastMoveAt = 0;
function onMouseMove(event) {
  // A mousemove per pixel would be hundreds of socket messages a second for a
  // signal the page samples far more coarsely than that.
  const now = Date.now();
  if (now - lastMoveAt < 40) return;
  lastMoveAt = now;
  const point = pagePoint(event);
  if (!point) return;
  sendInput('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: point.x, y: point.y, modifiers: modifierBits(event),
  });
}

function onWheel(event) {
  const point = pagePoint(event);
  if (!point) return;
  sendInput('Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x: point.x,
    y: point.y,
    deltaX: -event.deltaX,
    deltaY: -event.deltaY,
    modifiers: modifierBits(event),
  });
}

/** CDP packs modifiers as a bitfield: alt=1, ctrl=2, meta=4, shift=8. */
function modifierBits(event) {
  return (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.metaKey ? 4 : 0) | (event.shiftKey ? 8 : 0);
}

function onKey(event) {
  const isDown = event.type === 'keydown';

  // A printable character needs `text`, or the page receives the keystroke but
  // no character is typed — the single most common mistake in a CDP input
  // bridge, and it looks like a broken keyboard rather than a missing field.
  const printable = isDown && event.key.length === 1 && !event.ctrlKey && !event.metaKey;

  sendInput('Input.dispatchKeyEvent', {
    type: isDown ? (printable ? 'keyDown' : 'rawKeyDown') : 'keyUp',
    key: event.key,
    code: event.code,
    windowsVirtualKeyCode: event.keyCode,
    nativeVirtualKeyCode: event.keyCode,
    modifiers: modifierBits(event),
    ...(printable ? { text: event.key, unmodifiedText: event.key } : {}),
  });
}

// ── lifecycle ──────────────────────────────────────────────────────────────

function onFrame(payload) {
  if (!authenticated || !socket?.connected || !instanceId || payload.instanceId !== instanceId) return;
  if (payload.streamId !== streamId || (payload.viewerId && payload.viewerId !== viewerId)) return;
  if (typeof payload.data !== 'string' || payload.data.length > 2 * 1024 * 1024) { ackFrame(payload); return; }
  if (payload.source === 'snapshot') { if (seenLiveFrame) return; }
  paint(payload);
}

function onNavigated(payload) {
  if (!instanceId || payload.instanceId !== instanceId || payload.streamId !== streamId) return;
  currentUrl.value = payload.url || '';
  emit('page', { url: currentUrl.value, title: '' });
  refreshHistory();
}

async function command(action, url = undefined) {
  if (!instanceId || navigating.value || !authenticated || !socket?.connected) return false;
  const epoch = generation;
  navigating.value = true;
  try {
    const response = await fetch(`${API_CONFIG.BASE_URL}/browser-agent/control`, {
      method: 'POST',
      credentials: 'include',
      headers: authHeaders(),
      body: JSON.stringify({ instanceId, action, ...(url ? { url } : {}) }),
    });
    const body = await response.json().catch(() => ({}));
    if (disposed || epoch !== generation) return false;
    if (!response.ok) {
      error.value = body.error || 'The browser command failed.';
      return false;
    }
    applyBrowserState(body);
    return true;
  } catch (err) {
    if (disposed || epoch !== generation) return false;
    error.value = `Could not control the browser: ${err.message}`;
    return false;
  } finally {
    if (epoch === generation) navigating.value = false;
  }
}

async function refreshHistory() {
  if (!instanceId) return;
  const epoch = generation;
  try {
    const response = await fetch(`${API_CONFIG.BASE_URL}/browser-agent/control/${encodeURIComponent(instanceId)}`, {
      credentials: 'include',
      headers: authHeaders(),
    });
    if (!response.ok) return;
    const body = await response.json();
    if (!disposed && epoch === generation) applyBrowserState(body);
  } catch { /* page events still keep the URL current */ }
}

function applyBrowserState(body) {
  if (body.url) {
    currentUrl.value = body.url;
    emit('page', { url: body.url, title: body.title || '' });
  }
  canGoBack.value = Boolean(body.canGoBack);
  canGoForward.value = Boolean(body.canGoForward);
  emit('history', { canGoBack: canGoBack.value, canGoForward: canGoForward.value });
}

const goBack = () => command('back');
const goForward = () => command('forward');
const reload = () => command('reload');
const navigate = (url) => command('navigate', url);

/**
 * The browser we were watching went away.
 *
 * Without this the canvas keeps showing the last frame it received, which is
 * indistinguishable from a page that simply stopped changing — the most
 * confusing possible failure, because everything looks fine. Dropping back to
 * polling picks up whatever opens next, including the browser the agent is
 * about to launch for its next step.
 */
function onStopped(payload) {
  if (!instanceId || payload.instanceId !== instanceId || payload.streamId !== streamId) return;
  clearSubscription();
  error.value = '';
  canGoBack.value = false;
  canGoForward.value = false;
  emit('history', { canGoBack: false, canGoForward: false });
  pollForSurface();
}

function onVisibility() {
  observationOnly = true;
  clearSubscription(); error.value = '';
  if (document.visibilityState === 'hidden') {
    phase.value = 'Live view paused while this tab is hidden.'; waiting.value = false;
  } else { armChannelDeadline(); pollForSurface(); }
}
onMounted(() => { document.addEventListener('visibilitychange', onVisibility); armChannelDeadline(); attachWhenReady(); });

/**
 * Nothing starts until the socket exists, and then EVERYTHING starts.
 *
 * THE BUG THIS SHAPE FIXES. The socket is created a moment after app start, so
 * this widget routinely mounts before it exists. The first version handled
 * that by retrying only the HTTP subscribe — which succeeded — while the frame
 * listeners were attached on a path the retry never reached. Result: the
 * backend streamed frames into the user's room, the subscription held it open,
 * and the canvas painted nothing. The widget looked completely dead while
 * every backend measurement said the pipeline was healthy — the worst kind of
 * failure to diagnose, and it shipped.
 *
 * One entry point that either does ALL the setup or reschedules ALL of it
 * makes that split impossible by construction.
 */
function onAuthenticated(data) {
  if (disposed) return;
  clearTimeout(authTimer);
  if (!data?.success || typeof data.userId !== 'string' || !data.userId.trim()) {
    authenticated = false; authenticatedUserId = null; clearSubscription();
    error.value = 'Live-view authentication failed.'; waiting.value = false; return;
  }
  if (authenticatedUserId !== null && authenticatedUserId !== data.userId) {
    authenticated = false;
    observationOnly = true;
    clearSubscription();
    error.value = '';
  }
  authenticatedUserId = data.userId;
  authenticated = true;
  clearTimeout(channelDeadline);
  pollForSurface();
}
function onDisconnect() {
  authenticated = false; clearTimeout(authTimer); clearSubscription();
  error.value = ''; phase.value = 'Live view disconnected. Waiting to reconnect…';
  armChannelDeadline();
}
function requestAuthentication() {
  if (disposed || !socket?.connected) return;
  phase.value = 'Authenticating the live-view channel…';
  clearTimeout(authTimer);
  authTimer = setTimeout(() => {
    if (!authenticated && !disposed) { error.value = 'Live-view authentication timed out. Retry the live view.'; waiting.value = false; }
  }, 8000);
  // Authentication is idempotent. An explicit token round trip also handles
  // mounting after the shared socket already emitted its authenticated event.
  socket.emit('authenticate', { token: localStorage.getItem('token') });
}
function onFrameUnavailable(payload) {
  if (payload.instanceId === instanceId && payload.viewerId === viewerId && !hasFrame.value) {
    error.value = 'Browser connected, but it is not delivering frames. Retry the live view.';
    waiting.value = false;
  }
}
function attachWhenReady() {
  if (disposed) return;
  const next = getRealtimeSocket();
  if (next !== socket) {
    detachSocket(); onDisconnect(); socket = next;
    socket?.on('browser:frame', onFrame);
    socket?.on('browser:navigated', onNavigated);
    socket?.on('browser:stopped', onStopped);
    socket?.on('browser:frame-unavailable', onFrameUnavailable);
    socket?.on('authenticated', onAuthenticated);
    socket?.on('connect', requestAuthentication);
    socket?.on('disconnect', onDisconnect);
    requestAuthentication();
  }
  socketTimer = setTimeout(attachWhenReady, 500);
}
function detachSocket() {
  socket?.off('browser:frame', onFrame);
  socket?.off('browser:navigated', onNavigated);
  socket?.off('browser:stopped', onStopped);
  socket?.off('browser:frame-unavailable', onFrameUnavailable);
  socket?.off('authenticated', onAuthenticated);
  socket?.off('connect', requestAuthentication);
  socket?.off('disconnect', onDisconnect);
}

defineExpose({
  goBack,
  goForward,
  reload,
  navigate,
  canGoBack,
  canGoForward,
  navigating,
  currentUrl,
});

onBeforeUnmount(() => {
  disposed = true;
  document.removeEventListener('visibilitychange', onVisibility);
  clearSubscription(); clearTimeout(socketTimer); clearTimeout(authTimer);
  clearTimeout(channelDeadline);
  detachSocket(); socket = null;
});
</script>

<style scoped>
.stream-view {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #fff;
  overflow: hidden;
}

.stream-page {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}

.stream-canvas {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: contain;
  outline: none;
  cursor: default;
}

.stream-status {
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
