<template>
  <div class="browser-agent-widget">
    <!-- URL bar: this is a real browser, so it gets real browser controls. -->
    <div class="bw-toolbar">
      <button class="bw-icon" title="Back" :disabled="!ready" @click="goBack">
        <i class="fas fa-arrow-left"></i>
      </button>
      <button class="bw-icon" title="Forward" :disabled="!ready" @click="goForward">
        <i class="fas fa-arrow-right"></i>
      </button>
      <button class="bw-icon" title="Reload" :disabled="!ready" @click="reload">
        <i class="fas fa-redo"></i>
      </button>
      <input
        v-model="urlInput"
        class="bw-url"
        spellcheck="false"
        placeholder="Enter a URL"
        @keyup.enter="navigate"
      />
      <span class="bw-status" :class="statusClass">{{ statusLabel }}</span>
    </div>

    <!-- The browser itself. Really rendering, really inside AGNT. -->
    <div class="bw-viewport">
      <webview
        ref="viewRef"
        class="bw-webview"
        :src="initialUrl"
        partition="persist:agnt-browser"
      ></webview>
      <div v-if="running" class="bw-driving">
        <i class="fas fa-robot"></i> {{ providerLabel }} is driving
      </div>
    </div>

    <!-- Task bar -->
    <div class="bw-taskbar">
      <select v-model="provider" class="bw-provider" :disabled="running">
        <option v-for="p in providers" :key="p" :value="p">{{ p }}</option>
      </select>
      <input
        v-model="task"
        class="bw-task"
        placeholder="Tell the agent what to do on this page…"
        :disabled="running"
        @keyup.enter="run"
      />
      <button class="bw-run" :disabled="running || !task.trim() || !ready" @click="run">
        <i :class="running ? 'fas fa-spinner fa-spin' : 'fas fa-play'"></i>
        {{ running ? 'Running' : 'Run' }}
      </button>
    </div>

    <!-- Result -->
    <div v-if="result || error" class="bw-result" :class="{ 'is-error': error }">
      <div class="bw-result-head">
        <span>
          <i :class="error ? 'fas fa-triangle-exclamation' : 'fas fa-check'"></i>
          {{ error ? 'Failed' : `Done — ${result?.steps ?? 0} steps` }}
        </span>
        <button class="bw-icon" title="Dismiss" @click="clearResult"><i class="fas fa-times"></i></button>
      </div>
      <pre class="bw-result-body">{{ error || resultText }}</pre>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { API_CONFIG } from '@/tt.config.js';

const HOME = 'https://www.google.com';

const viewRef = ref(null);
const initialUrl = ref(HOME);
const urlInput = ref(HOME);
const task = ref('');
const provider = ref('Gemini');
const providers = ref(['Gemini']);
const running = ref(false);
const result = ref(null);
const error = ref(null);
const cdpUrl = ref(null);
const webContentsId = ref(null);
const bridgeError = ref(null);

const ready = computed(() => Boolean(cdpUrl.value));
const providerLabel = computed(() => provider.value);
const statusLabel = computed(() => {
  if (bridgeError.value) return 'no bridge';
  if (!ready.value) return 'connecting…';
  return running.value ? 'agent driving' : 'ready';
});
const statusClass = computed(() => ({
  'is-bad': Boolean(bridgeError.value),
  'is-live': running.value,
}));
const resultText = computed(() => {
  if (!result.value) return '';
  if (result.value.structuredOutput) return JSON.stringify(result.value.structuredOutput, null, 2);
  return result.value.result || '(no result)';
});

const authHeaders = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${localStorage.getItem('token')}`,
});

function clearResult() {
  result.value = null;
  error.value = null;
}

// ── browser controls ─────────────────────────────────────────────────────
const view = () => viewRef.value;
const goBack = () => { try { view()?.goBack(); } catch { /* nothing to go back to */ } };
const goForward = () => { try { view()?.goForward(); } catch { /* nothing forward */ } };
const reload = () => { try { view()?.reload(); } catch { /* not loaded yet */ } };

function navigate() {
  let url = urlInput.value.trim();
  if (!url) return;
  // A bare domain or a search phrase should both do the obvious thing.
  if (!/^[a-z]+:\/\//i.test(url)) {
    url = /^[\w-]+(\.[\w-]+)+([/?#].*)?$/.test(url)
      ? `https://${url}`
      : `https://www.google.com/search?q=${encodeURIComponent(url)}`;
  }
  try { view()?.loadURL(url); } catch { /* webview not ready */ }
}

// ── the agent ────────────────────────────────────────────────────────────
async function run() {
  if (!task.value.trim() || !cdpUrl.value) return;
  running.value = true;
  clearResult();

  try {
    const response = await fetch(`${API_CONFIG.BASE_URL}/browser-agent/run`, {
      method: 'POST',
      credentials: 'include',
      headers: authHeaders(),
      body: JSON.stringify({
        task: task.value,
        cdpUrl: cdpUrl.value,
        provider: provider.value,
      }),
    });
    const body = await response.json();

    if (!response.ok || !body.success) {
      error.value = body.error || body.result?.error || `Request failed (${response.status})`;
    } else {
      result.value = body.result;
      if (body.result?.error) error.value = body.result.error;
    }
  } catch (err) {
    error.value = err.message;
  } finally {
    running.value = false;
    syncUrl();
  }
}

function syncUrl() {
  try {
    const current = view()?.getURL();
    if (current) urlInput.value = current;
  } catch { /* webview gone */ }
}

// ── lifecycle ────────────────────────────────────────────────────────────
async function openBridge() {
  const api = window.electron?.browserBridge;
  if (!api) {
    // The widget renders a real browser via Electron. In a plain browser tab
    // there is nothing to attach to, and saying so beats an endless spinner.
    bridgeError.value = 'The Browser widget needs the AGNT desktop app.';
    return;
  }
  try {
    const id = view().getWebContentsId();
    webContentsId.value = id;
    const res = await api.start(id);
    if (res?.ok) cdpUrl.value = res.cdpUrl;
    else bridgeError.value = res?.error || 'Could not open a CDP bridge.';
  } catch (err) {
    bridgeError.value = err.message;
  }
}

async function loadProviders() {
  try {
    const res = await fetch(`${API_CONFIG.BASE_URL}/browser-agent/providers`, {
      credentials: 'include',
      headers: authHeaders(),
    });
    const body = await res.json();
    if (body?.providers?.length) providers.value = body.providers;
  } catch { /* keep the default single entry */ }
}

onMounted(async () => {
  await nextTick();
  const el = view();
  if (!el) return;

  // getWebContentsId() is only meaningful once the guest exists, so the bridge
  // has to wait for dom-ready rather than for the Vue mount.
  el.addEventListener('dom-ready', openBridge, { once: true });
  el.addEventListener('did-navigate', syncUrl);
  el.addEventListener('did-navigate-in-page', syncUrl);

  loadProviders();
});

onBeforeUnmount(() => {
  // Release the debugger with the widget. A bridge outliving its surface holds
  // a debugger on a dead webContents and still advertises a working endpoint.
  if (webContentsId.value && window.electron?.browserBridge) {
    window.electron.browserBridge.stop(webContentsId.value);
  }
});
</script>

<style scoped>
.browser-agent-widget {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-bg, #0b0b14);
  color: var(--color-text, #e6e6f0);
  font-size: 13px;
  overflow: hidden;
}

.bw-toolbar,
.bw-taskbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  flex: 0 0 auto;
  border-bottom: 1px solid var(--color-border, #23233a);
}
.bw-taskbar {
  border-bottom: none;
  border-top: 1px solid var(--color-border, #23233a);
}

.bw-icon {
  background: transparent;
  border: none;
  color: var(--color-text-muted, #9a9ab5);
  cursor: pointer;
  padding: 4px 7px;
  border-radius: 4px;
}
.bw-icon:hover:not(:disabled) { background: var(--color-bg-hover, #1b1b2b); color: var(--color-text, #e6e6f0); }
.bw-icon:disabled { opacity: 0.35; cursor: default; }

.bw-url,
.bw-task {
  flex: 1 1 auto;
  min-width: 0;
  background: var(--color-bg-input, #14141f);
  border: 1px solid var(--color-border, #23233a);
  border-radius: 5px;
  color: inherit;
  padding: 5px 9px;
  font-family: inherit;
  outline: none;
}
.bw-url:focus,
.bw-task:focus { border-color: var(--color-accent, #6c5ce7); }

.bw-status {
  flex: 0 0 auto;
  font-size: 11px;
  color: var(--color-text-muted, #9a9ab5);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding-left: 4px;
}
.bw-status.is-live { color: var(--color-accent, #6c5ce7); }
.bw-status.is-bad { color: var(--color-danger, #ff6b6b); }

.bw-viewport { position: relative; flex: 1 1 auto; min-height: 0; background: #fff; }
.bw-webview { width: 100%; height: 100%; border: none; display: inline-flex; }

.bw-driving {
  position: absolute;
  top: 10px;
  right: 12px;
  background: var(--color-accent, #6c5ce7);
  color: #fff;
  border-radius: 20px;
  padding: 4px 12px;
  font-size: 11px;
  box-shadow: 0 3px 12px rgba(0, 0, 0, 0.35);
  pointer-events: none;
}

.bw-provider {
  flex: 0 0 auto;
  background: var(--color-bg-input, #14141f);
  border: 1px solid var(--color-border, #23233a);
  border-radius: 5px;
  color: inherit;
  padding: 5px 6px;
  max-width: 130px;
}

.bw-run {
  flex: 0 0 auto;
  background: var(--color-accent, #6c5ce7);
  border: none;
  border-radius: 5px;
  color: #fff;
  cursor: pointer;
  padding: 6px 14px;
  font-weight: 600;
}
.bw-run:disabled { opacity: 0.4; cursor: default; }

.bw-result {
  flex: 0 0 auto;
  max-height: 34%;
  overflow: auto;
  border-top: 1px solid var(--color-border, #23233a);
  background: var(--color-bg-alt, #101019);
}
.bw-result.is-error { border-top-color: var(--color-danger, #ff6b6b); }
.bw-result-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 10px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-muted, #9a9ab5);
}
.bw-result.is-error .bw-result-head { color: var(--color-danger, #ff6b6b); }
.bw-result-body {
  margin: 0;
  padding: 0 10px 10px;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 12px;
}
</style>
