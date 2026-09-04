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

      <div v-if="!hasFrame" class="stream-status">
        <i :class="waiting ? 'fas fa-circle-notch fa-spin' : 'fas fa-globe'"></i>
        <p>{{ statusText }}</p>
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
  return waiting.value ? 'Waiting for the browser to open…' : 'No browser is open yet.';
});

const authHeaders = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${localStorage.getItem('token')}`,
});

/**
 * Paint one frame.
 *
 * The ack goes out AFTER the image has decoded and drawn, never on arrival.
 * That is the flow control: Chromium will not send frame N+1 until N is acked,
 * so acking on render makes a slow client throttle itself instead of queueing
 * frames it cannot keep up with. See BrowserScreencastService.
 */
function paint(payload) {
  const canvas = canvasRef.value;
  if (!canvas) return;

  // Frames arrive faster than a slow machine can decode. Dropping one while
  // another is in flight is correct — the next frame is a better picture than
  // the one being skipped, and the ack still fires so the stream never stalls.
  if (painting) {
    socket?.emit('browser:ack', { instanceId, frameId: payload.frameId });
    return;
  }
  painting = true;

  const image = new Image();
  image.onload = () => {
    // Sized from the FRAME, not from the element: the canvas backing store must
    // match the source or every input coordinate is scaled by a factor nobody
    // computed. CSS stretches it to fit the widget.
    if (canvas.width !== image.width || canvas.height !== image.height) {
      canvas.width = image.width;
      canvas.height = image.height;
    }
    canvas.getContext('2d')?.drawImage(image, 0, 0);
    hasFrame.value = true;
    waiting.value = false;
    painting = false;
    socket?.emit('browser:ack', { instanceId, frameId: payload.frameId });
  };
  image.onerror = () => {
    painting = false;
    // Still ack: a frame we could not decode must not stop the stream forever.
    socket?.emit('browser:ack', { instanceId, frameId: payload.frameId });
  };
  image.src = `data:image/jpeg;base64,${payload.data}`;
}

/** Ask the backend to stream whichever surface belongs to this workspace. */
async function startWatching() {
  try {
    const response = await fetch(`${API_CONFIG.BASE_URL}/browser-agent/view`, {
      method: 'POST',
      credentials: 'include',
      headers: authHeaders(),
      body: JSON.stringify({ workspaceId: props.workspaceId, launch: props.launch }),
    });
    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      // 404 means "not yet", which is the normal cold-start case and not worth
      // showing as a failure — keep polling quietly.
      if (response.status === 404) {
        error.value = '';
        return false;
      }

      // 503 means no browser can be opened on that machine at all (none
      // installed, or it will not start). Polling cannot fix that, and a widget
      // that retries forever never tells the user what is wrong.
      error.value = body.error || 'Could not watch that browser.';
      if (response.status === 503) {
        waiting.value = false;
        return 'stop';
      }
      return false;
    }

    instanceId = body.instanceId;
    error.value = '';
    socket?.emit('browser:watching', { instanceId });
    if (body.url) {
      currentUrl.value = body.url;
      emit('page', { url: body.url, title: '' });
    }
    await refreshHistory();
    return true;
  } catch (err) {
    error.value = `Could not reach the server: ${err.message}`;
    return false;
  }
}

async function pollForSurface() {
  if (instanceId) return;
  const started = await startWatching();
  if (started === true || started === 'stop') return;
  retryTimer = setTimeout(pollForSurface, RETRY_MS);
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
  return viewportToPage({
    clientX: event.clientX,
    clientY: event.clientY,
    rect: canvas.getBoundingClientRect(),
    frameWidth: canvas.width,
    frameHeight: canvas.height,
  });
}

const MOUSE_TYPES = { mousedown: 'mousePressed', mouseup: 'mouseReleased', mousemove: 'mouseMoved' };

function sendInput(method, params) {
  if (!instanceId) return;
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
  if (!instanceId || payload.instanceId !== instanceId) return;
  paint(payload);
}

function onNavigated(payload) {
  if (!instanceId || payload.instanceId !== instanceId) return;
  currentUrl.value = payload.url || '';
  emit('page', { url: currentUrl.value, title: '' });
  refreshHistory();
}

async function command(action, url = undefined) {
  if (!instanceId || navigating.value) return false;
  navigating.value = true;
  try {
    const response = await fetch(`${API_CONFIG.BASE_URL}/browser-agent/control`, {
      method: 'POST',
      credentials: 'include',
      headers: authHeaders(),
      body: JSON.stringify({ instanceId, action, ...(url ? { url } : {}) }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      error.value = body.error || 'The browser command failed.';
      return false;
    }
    applyBrowserState(body);
    return true;
  } catch (err) {
    error.value = `Could not control the browser: ${err.message}`;
    return false;
  } finally {
    navigating.value = false;
  }
}

async function refreshHistory() {
  if (!instanceId) return;
  try {
    const response = await fetch(`${API_CONFIG.BASE_URL}/browser-agent/control/${encodeURIComponent(instanceId)}`, {
      credentials: 'include',
      headers: authHeaders(),
    });
    if (!response.ok) return;
    applyBrowserState(await response.json());
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
  if (!instanceId || payload.instanceId !== instanceId) return;
  instanceId = null;
  hasFrame.value = false;
  waiting.value = true;
  canGoBack.value = false;
  canGoForward.value = false;
  emit('history', { canGoBack: false, canGoForward: false });
  pollForSurface();
}

onMounted(attachWhenReady);

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
function attachWhenReady() {
  socket = getRealtimeSocket();
  if (!socket) {
    socketTimer = setTimeout(attachWhenReady, 500);
    return;
  }
  socket.on('browser:frame', onFrame);
  socket.on('browser:navigated', onNavigated);
  socket.on('browser:stopped', onStopped);
  pollForSurface();
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
  clearTimeout(retryTimer);
  clearTimeout(socketTimer);
  socket?.off('browser:frame', onFrame);
  socket?.off('browser:navigated', onNavigated);
  socket?.off('browser:stopped', onStopped);
  if (instanceId) {
    socket?.emit('browser:unwatching', { instanceId });
    // Drop this viewer's ref-count. The browser itself keeps running — the
    // agent may still be mid-task, and closing a window because somebody looked
    // away would be its own bug.
    fetch(`${API_CONFIG.BASE_URL}/browser-agent/view/${encodeURIComponent(instanceId)}`, {
      method: 'DELETE',
      credentials: 'include',
      headers: authHeaders(),
    }).catch(() => {});
  }
  instanceId = null;
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
