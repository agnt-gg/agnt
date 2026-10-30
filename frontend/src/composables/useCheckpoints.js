import { reactive, computed, readonly } from 'vue';
import { API_CONFIG } from '@/tt.config.js';
import { getRealtimeSocket } from '@/composables/useRealtimeSync.js';

/**
 * Tasks in chat, client side: one cache for every checkpoint card, Home's
 * "Needs you" and the rail badge, so a decision anywhere shows everywhere.
 * The server (/api/checkpoints) is the authority; `checkpoint:changed` from
 * the person's other windows refreshes what changed.
 */
const state = reactive({ byId: {}, pending: [], loadedPending: false });
let socketBound = null;

async function request(path, options = {}) {
  const response = await fetch(API_CONFIG.BASE_URL + '/checkpoints' + path, {
    ...options,
    headers: { Authorization: 'Bearer ' + (localStorage.getItem('token') || ''), 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body.error || 'Checkpoint request failed'), { status: response.status, code: body.code });
  return body;
}

function remember(checkpoint) {
  if (checkpoint?.id) state.byId[checkpoint.id] = checkpoint;
  return checkpoint;
}

async function loadPending() {
  try {
    state.pending = await request('');
    state.pending.forEach(remember);
  } catch (error) {
    console.warn('[checkpoints] could not load what is waiting:', error.message);
  } finally {
    state.loadedPending = true;
  }
}

async function load(id) {
  try { return remember(await request('/' + encodeURIComponent(id))); } catch (error) { console.warn('[checkpoints] load', id, error.message); return null; }
}

function bind() {
  const socket = getRealtimeSocket();
  if (!socket || socketBound === socket) return;
  socketBound = socket;
  socket.on('checkpoint:changed', (signal) => {
    if (signal?.id) load(signal.id);
    loadPending();
  });
}

export function useCheckpoints() {
  bind();
  return {
    state: readonly(state),
    pendingCount: computed(() => state.pending.length),
    loadPending,
    load,
    get: (id) => state.byId[id] || null,
    async decide(id, decision, note) {
      const { checkpoint } = await request('/' + encodeURIComponent(id) + '/decide', { method: 'POST', body: JSON.stringify({ decision, note }) });
      remember(checkpoint);
      state.pending = state.pending.filter((c) => c.id !== id);
      return checkpoint;
    },
    async locate(id, outputId) {
      try { return remember(await request('/' + encodeURIComponent(id) + '/locate', { method: 'POST', body: JSON.stringify({ outputId }) })); } catch (error) { console.warn('[checkpoints] locate', error.message); return null; }
    },
  };
}

/** For tests. */
export function _resetCheckpoints() {
  state.byId = {};
  state.pending = [];
  state.loadedPending = false;
  socketBound = null;
}
