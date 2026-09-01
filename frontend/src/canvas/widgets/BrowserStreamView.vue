<template>
  <!--
    The everywhere path: a browser the BACKEND owns, streamed here as frames.
    Used by a plain browser tab, a paired phone, and the desktop app pointed at
    a remote backend — three topologies that have no <webview> to embed, or one
    that is on the wrong machine to be driven.
  -->
  <div class="stream-view">
    <canvas
      ref="canvasRef"
      class="stream-canvas"
      :class="{ interactive: canInteract }"
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

    <!--
      Interaction is OFF by default and named as a mode. The agent is usually
      mid-task, and a stray click from someone watching would fight it for the
      page — a race with no winner and no error message.
    -->
    <button
      v-if="hasFrame"
      class="interact-toggle"
      :class="{ on: canInteract }"
      type="button"
      @click="canInteract = !canInteract"
    >
      <i :class="canInteract ? 'fas fa-hand-pointer' : 'fas fa-eye'"></i>
      {{ canInteract ? 'Interactive' : 'Watching' }}
    </button>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { API_CONFIG } from '@/tt.config.js';
import { getRealtimeSocket } from '@/composables/useRealtimeSync.js';

const props = defineProps({
  workspaceId: { type: String, default: '' },
});

const emit = defineEmits(['page']);

const canvasRef = ref(null);
const hasFrame = ref(false);
const waiting = ref(true);
const error = ref('');
const canInteract = ref(false);

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
      body: JSON.stringify({ workspaceId: props.workspaceId }),
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
    if (body.url) emit('page', { url: body.url, title: '' });
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
 * Canvas coordinates -> page coordinates.
 *
 * The canvas is stretched by CSS to fill the widget, so a click at the element's
 * centre is NOT at the frame's centre unless the aspect ratios happen to match.
 * Scaling by the ratio of backing store to rendered size is what makes a click
 * land where the user aimed.
 */
function pagePoint(event) {
  const canvas = canvasRef.value;
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / (rect.width || 1);
  const scaleY = canvas.height / (rect.height || 1);
  return {
    x: Math.round((event.clientX - rect.left) * scaleX),
    y: Math.round((event.clientY - rect.top) * scaleY),
  };
}

const MOUSE_TYPES = { mousedown: 'mousePressed', mouseup: 'mouseReleased', mousemove: 'mouseMoved' };

function sendInput(method, params) {
  if (!instanceId || !canInteract.value) return;
  socket?.emit('browser:input', { instanceId, method, params });
}

function onMouse(event) {
  if (!canInteract.value) return;
  canvasRef.value?.focus();
  const { x, y } = pagePoint(event);
  sendInput('Input.dispatchMouseEvent', {
    type: MOUSE_TYPES[event.type],
    x,
    y,
    button: ['left', 'middle', 'right'][event.button] || 'left',
    clickCount: 1,
    modifiers: modifierBits(event),
  });
}

let lastMoveAt = 0;
function onMouseMove(event) {
  if (!canInteract.value) return;
  // A mousemove per pixel would be hundreds of socket messages a second for a
  // signal the page samples far more coarsely than that.
  const now = Date.now();
  if (now - lastMoveAt < 40) return;
  lastMoveAt = now;
  const { x, y } = pagePoint(event);
  sendInput('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, modifiers: modifierBits(event) });
}

function onWheel(event) {
  if (!canInteract.value) return;
  const { x, y } = pagePoint(event);
  sendInput('Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x,
    y,
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
  if (!canInteract.value) return;
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
  emit('page', { url: payload.url || '', title: '' });
}

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
  canInteract.value = false;
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
  background: #fff;
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

.stream-canvas.interactive {
  cursor: crosshair;
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

.interact-toggle {
  position: absolute;
  right: 8px;
  bottom: 8px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 6px;
  background: var(--color-popup);
  color: var(--color-text-muted, #556);
  font-size: 11px;
  cursor: pointer;
  opacity: 0.75;
}

.interact-toggle:hover { opacity: 1; }

.interact-toggle.on {
  color: var(--color-green);
  border-color: rgba(var(--green-rgb), 0.4);
  opacity: 1;
}
</style>
