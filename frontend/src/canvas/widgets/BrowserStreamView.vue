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
      @keydown.prevent.stop="onKey"
      @keyup.prevent.stop="onKey"
    ></canvas>

      <div v-if="!hasFrame || error" class="stream-status">
        <i :class="waiting ? 'fas fa-circle-notch fa-spin' : 'fas fa-globe'"></i>
        <p role="status">{{ statusText }}</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { API_CONFIG } from '@/tt.config.js';
import { getRealtimeSocket, ensureRealtimeConnected } from '@/composables/useRealtimeSync.js';
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
  /**
   * Ask for full-resolution frames. The default stream is sized for a card;
   * a host showing it full-window sets this so it is not a 1280px image
   * stretched across the screen. The backend holds it per viewer and drops
   * it when this viewer leaves.
   */
  highQuality: { type: Boolean, default: false },
});

const emit = defineEmits(['page', 'history', 'showing']);

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
/** The backend has accepted this viewer, so it may ask for a quality tier. */
let registered = false;

/** The largest frame either tier can send; mirrors FRAME_FORMAT_HIGH. */
const MAX_FRAME_WIDTH = 2560;
const MAX_FRAME_HEIGHT = 1600;
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
let recoverTimer = null;
let recoverDelay = 0;
const OPENING = 'Opening the browser…';
const phase = ref(OPENING);

/**
 * How often to re-ask for a surface while none exists.
 *
 * There is usually nothing to watch when this mounts: the widget opens the
 * instant the tool is CALLED (TOOL_WIDGET_MAP), and the backend has not yet
 * launched a browser. So "no surface" is the normal starting state, not an
 * error, and the view waits for one rather than telling the user off.
 */
const RETRY_MS = 1500;

/**
 * Every transient failure lands here, and nothing is shown for it.
 *
 * The view used to stop on each failure with a message and a "Retry live
 * view" button. Every one of those failures (lost socket, lapsed lease, a
 * frame that never arrived, a browser that changed underneath us) heals by
 * doing exactly what the button did, so the button was only ever a way of
 * making the user do the component's job. Now it does it itself, with a
 * capped backoff so a persistent fault costs one attempt every few seconds.
 */
function recover(reason) {
  if (disposed) return;
  console.warn('[BrowserStreamView] recovering:', reason);
  clearSubscription();
  error.value = ''; phase.value = OPENING; waiting.value = true;
  clearTimeout(recoverTimer);
  recoverDelay = Math.min(recoverDelay ? recoverDelay * 2 : 1000, 5000);
  recoverTimer = setTimeout(restart, recoverDelay);
}

function restart() {
  if (disposed) return;
  ensureRealtimeConnected();
  if (authenticated && socket?.connected) pollForSurface();
  else requestAuthentication();
}

// Whether real pixels are on screen, for hosts that hide an empty view.
watch(hasFrame, (showing) => emit('showing', showing));

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
    // Drop this frame; the next one replaces it. One bad JPEG is not an outage.
    decodeSerial += 1;
    console.warn('[BrowserStreamView] frame decode timed out; dropped');
    complete();
  }, 5000);
  image.onload = () => {
    if (disposed || epoch !== generation || serial !== decodeSerial) return;
    painting = false;
    try {
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas rendering is unavailable.');
      if (payload.source === 'snapshot' && seenLiveFrame) { complete(); return; }
      if (!Number.isFinite(image.width) || !Number.isFinite(image.height) || image.width <= 0 || image.height <= 0 || image.width > MAX_FRAME_WIDTH || image.height > MAX_FRAME_HEIGHT) throw new Error('Browser frame exceeds the size limit.');
      viewportSize = payload.metadata;
      canvas.width = image.width; canvas.height = image.height;
      context.drawImage(image, 0, 0);
      // Receipt/decoding alone is not success: only painted live pixels can
      // supersede a fallback snapshot for this subscription generation.
      if (payload.source !== 'snapshot') seenLiveFrame = true;
      socket?.emit('browser:painted', {instanceId, viewerId, streamId, ...(payload.bootstrapId ? {bootstrapId:payload.bootstrapId} : {})});
      hasFrame.value = true; waiting.value = false; error.value = ''; recoverDelay = 0;
      frameDescription.value = payload.source === 'snapshot'
        ? 'Snapshot received — continuous live updates not yet confirmed.'
        : 'Last received browser frame — unchanged pixels alone do not prove stream health.';
      clearTimeout(frameTimer);
    } catch (err) { console.warn('[BrowserStreamView] frame dropped:', err.message); }
    complete();
  };
  image.onerror = () => {
    if (disposed || epoch !== generation || serial !== decodeSerial) return;
    painting = false;
    console.warn('[BrowserStreamView] frame could not be decoded; dropped');
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
  registered = false;
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
      recover('lease renewal failed');
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

/**
 * A watchdog, not a deadline: while the channel is down it keeps pulling the
 * socket back up and re-authenticating, for as long as the view is mounted.
 */
function armChannelDeadline() {
  clearTimeout(channelDeadline);
  channelDeadline = setTimeout(() => {
    if (disposed) return;
    if (!socket?.connected || !authenticated) {
      ensureRealtimeConnected();
      if (socket?.connected && !authenticated) requestAuthentication();
      armChannelDeadline();
    }
  }, 5000);
}

function armFrameDeadline() {
  clearTimeout(frameTimer);
  frameTimer = setTimeout(() => {
    if (!hasFrame.value && instanceId && !disposed) recover('no frame arrived');
  }, 8000);
}

async function startWatching() {
  const epoch = generation;
  subscribing = true;
  phase.value = OPENING;
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
      // 426 is a client/backend version mismatch: only a reload fixes that.
      if (response.status === 426) { error.value = body.error || 'Live-view protocol changed. Refresh the app.'; waiting.value = false; return 'stop'; }
      // Anything else (no browser yet, a browser that is still starting or
      // failed to start, a stale session) is retried quietly.
      error.value = ''; phase.value = OPENING;
      if (response.status !== 404) console.warn('[BrowserStreamView] /view', response.status, body.error || '');
      return response.status === 404 ? false : 'backoff';
    }
    if (!body.instanceId || !body.viewerId || !body.streamId) {
      error.value = 'Live-view protocol mismatch. Update the backend and client together.';
      waiting.value = false; return 'stop';
    }
    observationOnly = true;
    instanceId = body.instanceId; viewerId = body.viewerId; streamId = body.streamId;
    error.value = ''; phase.value = OPENING;
    armFrameDeadline();
    const registrationFailed = () => {
      if (disposed || epoch !== generation) return;
      recover('viewer registration failed');
    };
    registrationTimer = setTimeout(registrationFailed, 5000);
    socket.emit('browser:watching', { instanceId, viewerId }, (result) => {
      if (disposed || epoch !== generation) return;
      clearTimeout(registrationTimer);
      if (!result?.ok) { registrationFailed(); return; }
      registered = true;
      scheduleRenewal();
      // A view that was already fullscreen when it (re)subscribed.
      if (props.highQuality) sendQuality();
    });
    if (body.url) { currentUrl.value = body.url; emit('page', { url: body.url, title: '' }); }
    refreshHistory();
    return true;
  } catch (err) {
    if (epoch !== generation || disposed) return 'stop';
    console.warn('[BrowserStreamView] could not reach the live-view server:', err.message);
    error.value = ''; phase.value = OPENING;
    return 'backoff';
  } finally {
    clearTimeout(requestTimer);
    if (epoch === generation) subscribing = false;
  }
}

/**
 * Tell the backend which frame tier this viewer wants. Best effort: a viewer
 * that is not registered yet sends it on registration instead, and a refusal
 * only means the frames stay card-sized.
 */
function sendQuality() {
  if (!registered || !socket?.connected || !authenticated || !instanceId || !viewerId) return;
  socket.emit('browser:quality', { instanceId, viewerId, high: props.highQuality }, (result) => {
    if (result && !result.ok) console.warn('[BrowserStreamView] quality change refused:', result.error);
  });
}
watch(() => props.highQuality, sendQuality);

async function pollForSurface() {
  if (disposed || document.visibilityState === 'hidden' || !authenticated || !socket?.connected || instanceId || subscribing) return;
  const epoch = generation;
  const started = await startWatching();
  if (disposed || epoch !== generation || started === true || started === 'stop') return;
  // A real failure (browser failed to launch, server unreachable) backs off so
  // a persistent fault is one attempt every 5s, not a launch storm.
  retryTimer = setTimeout(pollForSurface, started === 'backoff' ? 5000 : RETRY_MS);
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
      // Logged, not overlaid: the page is still live and a failed back/reload
      // must not blank it out.
      console.warn('[BrowserStreamView] browser command failed:', body.error || response.status);
      return false;
    }
    applyBrowserState(body);
    return true;
  } catch (err) {
    if (disposed || epoch !== generation) return false;
    console.warn('[BrowserStreamView] could not control the browser:', err.message);
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
    // Usually a token that is mid-refresh. Try again shortly with the new one.
    authenticated = false; authenticatedUserId = null;
    recover(`authentication refused: ${data?.error || 'no user'}`);
    return;
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
  if (!instanceId) { error.value = ''; phase.value = OPENING; waiting.value = true; }
  pollForSurface();
}
function onDisconnect() {
  authenticated = false; clearTimeout(authTimer); clearSubscription();
  error.value = ''; phase.value = OPENING;
  armChannelDeadline();
}
function requestAuthentication() {
  if (disposed || !socket?.connected) return;
  clearTimeout(authTimer);
  authTimer = setTimeout(() => {
    if (!authenticated && !disposed) requestAuthentication();
  }, 8000);
  // Authentication is idempotent. An explicit token round trip also handles
  // mounting after the shared socket already emitted its authenticated event.
  socket.emit('authenticate', { token: localStorage.getItem('token') });
}
function onFrameUnavailable(payload) {
  if (payload.instanceId === instanceId && payload.viewerId === viewerId && !hasFrame.value) {
    recover('the browser is not delivering frames');
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
  clearTimeout(channelDeadline); clearTimeout(recoverTimer);
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
