<template>
  <div class="ml-screen">
    <header class="ml-header">
      <div class="ml-brand">
        <span class="ml-mark">A</span>
        <div>
          <h1>AGNT Chat</h1>
          <p class="ml-sub">Lite · Annie on your phone</p>
        </div>
      </div>
    </header>

    <main class="ml-main">
      <template v-if="checking">
        <p class="ml-muted"><i class="fas fa-spinner fa-spin"></i> Checking session…</p>
      </template>

      <template v-else-if="authed">
        <!-- setup=1: chat, switch among saved servers, or add another -->
        <p class="ml-lead">Signed in{{ userLabel }}.</p>
        <p v-if="currentOrigin" class="ml-meta">This server: <code>{{ currentOrigin }}</code></p>
        <button class="ml-btn ml-btn-primary" type="button" @click="goChat">Open Annie chat</button>

        <template v-if="servers.length">
          <p class="ml-label">Saved servers</p>
          <ul class="ml-server-list">
            <li v-for="s in servers" :key="s.origin">
              <button type="button" class="ml-server-item" @click="openServer(s.origin)">
                <span class="ml-server-host">{{ s.label || s.origin }}</span>
                <span v-if="s.origin === currentOrigin" class="ml-server-badge">current</span>
              </button>
              <button
                type="button"
                class="ml-server-remove"
                :aria-label="'Remove ' + (s.label || s.origin)"
                @click="removeServer(s.origin)"
              >
                ×
              </button>
            </li>
          </ul>
        </template>

        <button
          v-if="!showAddServer"
          type="button"
          class="ml-btn ml-btn-ghost"
          @click="startAddServer"
        >
          Add new server
        </button>

        <template v-if="showAddServer">
          <p class="ml-label">Add new server</p>
          <p class="ml-field-note">
            Paste a Phone Access pair link, or scan the QR on the desktop.
          </p>
          <textarea
            id="ml-paste-auth"
            v-model="pasteInput"
            class="ml-input ml-textarea"
            rows="3"
            autocomplete="off"
            spellcheck="false"
            placeholder="http://192.168.x.x:3333/m/pair?c=…"
            @keydown.meta.enter.prevent="continueFromPaste"
            @keydown.ctrl.enter.prevent="continueFromPaste"
          />
          <button
            type="button"
            class="ml-btn ml-btn-ghost"
            :disabled="busy"
            @click="openScanner"
          >
            Scan QR code
          </button>
          <p v-if="cameraHint" class="ml-field-note">{{ cameraHint }}</p>
          <p v-if="parsedHint" class="ml-hint">{{ parsedHint }}</p>
          <button
            class="ml-btn ml-btn-primary"
            type="button"
            :disabled="busy || !canSubmit"
            @click="continueFromPaste"
          >
            {{ busy ? 'Working…' : 'Add & pair' }}
          </button>
          <button
            type="button"
            class="ml-btn ml-btn-ghost"
            :disabled="busy"
            @click="cancelAddServer"
          >
            Cancel
          </button>
          <p v-if="error" class="ml-error">{{ error }}</p>
        </template>

        <button class="ml-btn ml-btn-ghost" type="button" @click="signOut">Sign out</button>
        <p v-if="serverError" class="ml-error">{{ serverError }}</p>
      </template>

      <template v-else>
        <p class="ml-lead">
          Scan the desktop QR, or paste the <strong>pair link</strong> (one URL with host + code), or
          choose a saved server below.
        </p>

        <template v-if="servers.length">
          <p class="ml-label">Saved servers</p>
          <ul class="ml-server-list">
            <li v-for="s in servers" :key="s.origin">
              <button type="button" class="ml-server-item" @click="openServer(s.origin)">
                <span class="ml-server-host">{{ s.label || s.origin }}</span>
              </button>
              <button
                type="button"
                class="ml-server-remove"
                :aria-label="'Remove ' + (s.label || s.origin)"
                @click="removeServer(s.origin)"
              >
                ×
              </button>
            </li>
          </ul>
        </template>

        <label class="ml-label" for="ml-paste">Pair link (URL)</label>
        <textarea
          id="ml-paste"
          v-model="pasteInput"
          class="ml-input ml-textarea"
          rows="3"
          autocomplete="off"
          spellcheck="false"
          placeholder="http://192.168.x.x:3333/m/pair?c=…"
          @keydown.meta.enter.prevent="continueFromPaste"
          @keydown.ctrl.enter.prevent="continueFromPaste"
        />
        <p class="ml-field-note">
          Same link as desktop Phone Access (or scan QR). Saved servers appear after you pair.
        </p>
        <button
          type="button"
          class="ml-btn ml-btn-ghost"
          :disabled="busy"
          @click="openScanner"
        >
          Scan QR code
        </button>
        <p v-if="cameraHint" class="ml-field-note">{{ cameraHint }}</p>
        <label class="ml-check">
          <input v-model="autoOpen" type="checkbox" @change="onAutoOpenChange" />
          Open last server automatically next launch
        </label>
        <p v-if="parsedHint" class="ml-hint">{{ parsedHint }}</p>
        <button
          class="ml-btn ml-btn-primary"
          type="button"
          :disabled="busy || !canSubmit"
          @click="continueFromPaste"
        >
          {{ busy ? 'Working…' : 'Continue' }}
        </button>

        <p v-if="error" class="ml-error">{{ error }}</p>
        <p v-if="serverError" class="ml-error">{{ serverError }}</p>
      </template>
    </main>

    <QrScanner
      v-if="showScanner"
      :prefer-photo="!webCameraOk"
      @result="onScanResult"
      @close="showScanner = false"
    />
    <!-- Sync file pick stays in the Scan tap gesture (required on iOS). -->
    <input
      ref="photoInputEl"
      class="ml-photo-input"
      type="file"
      accept="image/*"
      capture="environment"
      @change="onPhotoPicked"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useStore } from 'vuex';
import { clearMediaCookie } from '@/services/mediaAuth.js';
import QrScanner from '@/components/MobileLite/QrScanner.vue';
import {
  parsePairingInput,
  claimPairingCodeAt,
  rememberServerOrigin,
  getRememberedServerOrigin,
  normalizeServerOrigin,
  setAutoOpenServer,
  getAutoOpenServer,
  applyPairingSession,
  listPairedServers,
  removePairedServer,
} from '@/services/mobileLitePairing.js';
import { canUseWebCamera } from '@/services/mobileLiteNative.js';
import { decodeQrFromImageFile } from '@/utils/qrDecodeFromImage.js';

const store = useStore();
const router = useRouter();
const route = useRoute();

const checking = ref(true);
const authed = ref(false);
const busy = ref(false);
const error = ref('');
const pasteInput = ref('');
const serverInput = ref(getRememberedServerOrigin() || '');
const autoOpen = ref(getAutoOpenServer());
const serverError = ref('');
const servers = ref(listPairedServers());
const showScanner = ref(false);
const showAddServer = ref(false);
const photoInputEl = ref(null);
const webCameraOk = ref(canUseWebCamera());
const cameraHint = computed(() => {
  if (webCameraOk.value) return '';
  // Live getUserMedia is blocked on http://LAN; photo capture still works in-app.
  return 'Opens the camera to photograph the desktop QR (live preview needs https).';
});

function cancelAddServer() {
  showAddServer.value = false;
  showScanner.value = false;
  pasteInput.value = '';
  error.value = '';
}

function startAddServer() {
  showAddServer.value = true;
}

function openScanner() {
  // Do NOT bounce to agntchat:// — custom-scheme navigation from a remote
  // http:// WebView is unreliable (same bug that broke Switch server).
  error.value = '';
  if (webCameraOk.value) {
    showScanner.value = true;
    return;
  }
  // Must stay synchronous with the tap so iOS allows the camera/photos sheet.
  photoInputEl.value?.click();
}

async function onPhotoPicked(ev) {
  const file = ev.target?.files?.[0];
  if (ev.target) ev.target.value = '';
  if (!file) return;
  busy.value = true;
  error.value = '';
  try {
    const text = await decodeQrFromImageFile(file);
    if (!text) {
      error.value = 'No QR code found in that photo. Try again, or paste the pair link.';
      return;
    }
    onScanResult(text);
  } catch (e) {
    error.value = e?.message || 'Could not read that photo.';
  } finally {
    busy.value = false;
  }
}

function onScanResult(text) {
  showScanner.value = false;
  pasteInput.value = String(text || '').trim();
  // Full QR is a pair link — continue immediately.
  continueFromPaste();
}

function refreshServerList() {
  servers.value = listPairedServers();
}

function openServer(origin) {
  const o = normalizeServerOrigin(origin) || origin;
  if (!o) return;
  rememberServerOrigin(o);
  refreshServerList();
  // Prefer chat; /m redirects to chat when a session exists on that host.
  window.location.assign(`${o}/m/chat`);
}

function removeServer(origin) {
  removePairedServer(origin);
  refreshServerList();
  if (serverInput.value === origin) {
    serverInput.value = getRememberedServerOrigin() || '';
  }
}

const currentOrigin = computed(() =>
  typeof window !== 'undefined' ? window.location.origin : ''
);

const parsed = computed(() => {
  const raw = pasteInput.value;
  const codeOnly = /^[a-f0-9]{32}$/i.test(String(raw || '').trim());
  if (codeOnly) {
    const origin =
      normalizeServerOrigin(serverInput.value) ||
      getRememberedServerOrigin() ||
      currentOrigin.value;
    if (!origin) return null;
    return parsePairingInput(raw, origin);
  }
  return parsePairingInput(raw, currentOrigin.value);
});

const canSubmit = computed(() => Boolean(parsed.value));

const canSwitchServer = computed(() => {
  const o = normalizeServerOrigin(serverInput.value);
  return Boolean(o && o !== currentOrigin.value);
});

const parsedHint = computed(() => {
  const p = parsed.value;
  if (!p) return '';
  if (p.kind === 'code') return `Will pair on ${p.origin}`;
  if (p.kind === 'url') return `Will pair and open Annie on ${p.origin}`;
  if (p.kind === 'origin') return `Will open AGNT Chat on ${p.origin}`;
  return '';
});

const userLabel = computed(() => {
  const u = store.state.userAuth?.user;
  if (!u) return '';
  return u.email ? ` as ${u.email}` : '';
});

function onAutoOpenChange() {
  setAutoOpenServer(autoOpen.value);
}

/**
 * Single primary action for unauthenticated home:
 * - full pair link (?c=…) → pair on that host
 * - bare code → pair on remembered/current host
 * - server URL only → open /m (or /m/chat if already signed in)
 */
async function continueFromPaste() {
  error.value = '';
  serverError.value = '';
  const p = parsed.value;
  if (!p) {
    error.value =
      'Paste a full pair link from Phone Access (includes host + code), a 32-char code, or a server URL.';
    return;
  }

  busy.value = true;
  try {
    setAutoOpenServer(autoOpen.value);

    if (p.kind === 'url' || p.kind === 'code') {
      rememberServerOrigin(p.origin);
      serverInput.value = p.origin;
      if (p.navigateAway) {
        // Other host: load /m/pair there so claim is same-origin.
        window.location.assign(p.litePairUrl);
        return;
      }
      await claimOnOrigin(p.code, p.origin);
      return;
    }

    // kind === 'origin' — server URL only
    rememberServerOrigin(p.origin);
    serverInput.value = p.origin;
    if (localStorage.getItem('token')) {
      window.location.assign(`${p.origin}/m/chat?_ts=${Date.now()}`);
    } else {
      window.location.assign(p.liteHomeUrl || `${p.origin}/m`);
    }
  } catch (e) {
    const status = e?.response?.status;
    error.value =
      status === 404
        ? 'Code used or expired. Generate a new one on desktop.'
        : status === 429
          ? 'Too many attempts. Wait a minute.'
          : e?.message || e?.response?.data?.error || 'Could not continue.';
  } finally {
    busy.value = false;
  }
}

async function refreshSession() {
  checking.value = true;
  let redirecting = false;
  try {
    refreshServerList();
    if (!serverInput.value) {
      serverInput.value = getRememberedServerOrigin() || currentOrigin.value || '';
    }

    // setup=1 → always show chooser (multi-server / re-pair)
    const forceSetup = route.query.setup === '1' || route.query.nop === '1';

    if (localStorage.getItem('token')) {
      await store.dispatch('userAuth/fetchUserData', { forceRefresh: true });
    }
    authed.value = Boolean(store.state.userAuth?.user);
    if (authed.value) {
      rememberServerOrigin(currentOrigin.value);
      setAutoOpenServer(true);
      refreshServerList();
      serverInput.value = currentOrigin.value;
      if (route.query.returnTo) {
        router.replace(String(route.query.returnTo));
        return;
      }
      if (!forceSetup) {
        // Keep the "Checking session…" state — do not flash the setup UI.
        redirecting = true;
        window.location.replace(`${currentOrigin.value}/m/chat`);
        return;
      }
    }
  } finally {
    if (!redirecting) checking.value = false;
  }
}

function goChat() {
  // Hard nav — matches saveAndOpenServer; more reliable in Capacitor WebView.
  const origin = currentOrigin.value || window.location.origin;
  window.location.assign(`${origin}/m/chat?_ts=${Date.now()}`);
}

function signOut() {
  store.commit('userAuth/CLEAR_TOKEN');
  store.commit('userAuth/SET_USER', null);
  clearMediaCookie();
  // Keep saved server URL; only clear session
  authed.value = false;
}

async function claimOnOrigin(code, origin) {
  const res = await claimPairingCodeAt(code, { origin });
  rememberServerOrigin(origin);
  serverInput.value = origin;
  await applyPairingSession(store, res);
  authed.value = true;
  // Hard nav into chat (router-only is flaky inside Capacitor).
  window.location.assign(`${origin}/m/chat?_ts=${Date.now()}`);
}

onMounted(() => {
  document.documentElement.classList.add('mobile-lite-shell');
  document.body.classList.add('mobile-lite-shell');
  refreshSession();
});

onBeforeUnmount(() => {
  document.documentElement.classList.remove('mobile-lite-shell');
  document.body.classList.remove('mobile-lite-shell');
});
</script>

<style>
html.mobile-lite-shell,
html.mobile-lite-shell body,
html.mobile-lite-shell #app {
  background: #12121c !important;
  margin: 0;
  min-height: 100%;
}
</style>

<style scoped>
.ml-screen {
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  background: #12121c;
  color: #e8e8f0;
  padding: max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right))
    max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
  box-sizing: border-box;
}
.ml-header {
  margin-bottom: 24px;
}
.ml-brand {
  display: flex;
  gap: 12px;
  align-items: center;
}
.ml-mark {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: #19ef83;
  color: #04120a;
  font-weight: 800;
  font-size: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.ml-brand h1 {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
}
.ml-sub {
  margin: 2px 0 0;
  font-size: 13px;
  color: #8b93a7;
}
.ml-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 420px;
  width: 100%;
  margin: 0 auto;
}
.ml-lead {
  margin: 0;
  font-size: 15px;
  line-height: 1.55;
  color: #c5cad8;
}
.ml-label {
  font-size: 12px;
  font-weight: 600;
  color: #8b93a7;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.ml-field-note {
  margin: -4px 0 0;
  font-size: 12px;
  color: #5c6478;
  line-height: 1.4;
}
.ml-check {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  color: #8b93a7;
}
.ml-check input {
  width: 18px;
  height: 18px;
  accent-color: #19ef83;
}
.ml-hr {
  border: none;
  border-top: 1px solid #2e3350;
  margin: 8px 0;
  width: 100%;
}
.ml-input {
  min-height: 48px;
  border-radius: 12px;
  border: 1px solid #2e3350;
  background: #1b1b2b;
  color: #e8e8f0;
  padding: 12px 14px;
  font-size: 16px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: 0.02em;
}
.ml-textarea {
  resize: vertical;
  min-height: 88px;
  line-height: 1.4;
}
.ml-hint {
  margin: -4px 0 0;
  font-size: 12px;
  color: #19ef83;
}
.ml-meta {
  margin: 0;
  font-size: 12px;
  color: #8b93a7;
}
.ml-meta code {
  color: #c5cad8;
  font-size: 11px;
}
.ml-btn {
  min-height: 48px;
  border-radius: 12px;
  border: none;
  font-size: 16px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
}
.ml-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.ml-btn-primary {
  background: #19ef83;
  color: #04120a;
}
.ml-btn-ghost {
  background: transparent;
  color: #8b93a7;
  border: 1px solid #2e3350;
  font-size: 14px;
}
.ml-error {
  margin: 0;
  color: #ff7b7b;
  font-size: 14px;
}
.ml-muted {
  color: #8b93a7;
}
.ml-fine {
  font-size: 12px;
  color: #5c6478;
  line-height: 1.5;
}
.ml-fine code {
  font-size: 11px;
  color: #8b93a7;
}
.ml-server-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ml-server-list li {
  display: flex;
  gap: 8px;
  align-items: stretch;
}
.ml-server-item {
  flex: 1;
  min-height: 48px;
  text-align: left;
  border-radius: 12px;
  border: 1px solid #2e3350;
  background: #1b1b2b;
  color: #e8e8f0;
  padding: 12px 14px;
  font-size: 14px;
  font-family: inherit;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.ml-server-host {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
}
.ml-server-badge {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  color: #19ef83;
}
.ml-server-remove {
  width: 44px;
  border-radius: 12px;
  border: 1px solid #2e3350;
  background: transparent;
  color: #8b93a7;
  font-size: 20px;
  cursor: pointer;
}
.ml-photo-input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}
</style>
