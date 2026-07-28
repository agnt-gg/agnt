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
        <p class="ml-lead">You're signed in{{ userLabel }}.</p>
        <p v-if="currentOrigin" class="ml-meta">This page: <code>{{ currentOrigin }}</code></p>

        <label class="ml-label" for="ml-server-auth">Server URL</label>
        <input
          id="ml-server-auth"
          v-model="serverInput"
          class="ml-input"
          type="url"
          inputmode="url"
          autocomplete="url"
          placeholder="http://host:3333"
        />
        <p class="ml-field-note">Saved on this device. Change host (LAN / Tailscale) without rebuilding.</p>
        <button class="ml-btn ml-btn-ghost" type="button" @click="saveServerOnly">Save server URL</button>
        <button
          class="ml-btn ml-btn-ghost"
          type="button"
          :disabled="!canSwitchServer"
          @click="switchToSavedServer"
        >
          Open saved server
        </button>
        <p v-if="serverMsg" class="ml-hint">{{ serverMsg }}</p>
        <p v-if="serverError" class="ml-error">{{ serverError }}</p>

        <button class="ml-btn ml-btn-primary" @click="goChat">Open Annie chat</button>
        <button class="ml-btn ml-btn-ghost" @click="signOut">Sign out</button>
      </template>

      <template v-else>
        <p class="ml-lead">
          Set the AGNT <strong>server URL</strong> (saved on this device), then pair with a code from
          desktop <strong>Settings → Phone Access</strong>.
        </p>

        <label class="ml-label" for="ml-server">Server URL</label>
        <input
          id="ml-server"
          v-model="serverInput"
          class="ml-input"
          type="url"
          inputmode="url"
          autocomplete="url"
          placeholder="http://192.168.1.20:3333 or 100.x.x.x:3333"
          @keydown.enter.prevent="saveAndOpenServer"
        />
        <p class="ml-field-note">Persists across launches. No Makefile / rebuild when it changes.</p>
        <label class="ml-check">
          <input v-model="autoOpen" type="checkbox" @change="onAutoOpenChange" />
          Open this server automatically next launch
        </label>
        <button class="ml-btn ml-btn-primary" type="button" :disabled="busy" @click="saveAndOpenServer">
          Save &amp; open /m
        </button>
        <button class="ml-btn ml-btn-ghost" type="button" :disabled="busy" @click="saveServerOnly">
          Save server URL
        </button>
        <p v-if="serverMsg" class="ml-hint" role="status">{{ serverMsg }}</p>
        <p v-if="serverError" class="ml-error" role="alert">{{ serverError }}</p>
        <p class="ml-field-note">
          With the Simulator pin you are often already on this server — the button saves the URL and
          either opens chat (if signed in) or focuses pairing below.
        </p>

        <hr class="ml-hr" />

        <label class="ml-label" for="ml-paste">Pair link or code</label>
        <textarea
          id="ml-paste"
          v-model="pasteInput"
          class="ml-input ml-textarea"
          rows="3"
          autocomplete="off"
          spellcheck="false"
          placeholder="Full pair link, or 32-char code (uses Server URL above)"
          @keydown.meta.enter.prevent="submitPair"
          @keydown.ctrl.enter.prevent="submitPair"
        />
        <p v-if="parsedHint" class="ml-hint">{{ parsedHint }}</p>
        <button class="ml-btn ml-btn-primary" :disabled="busy || !canSubmit" @click="submitPair">
          {{ busy ? 'Pairing…' : 'Pair & continue' }}
        </button>

        <p v-if="error" class="ml-error">{{ error }}</p>
        <p class="ml-fine">
          Full AGNT web uses <code>/pair</code>. Lite uses <code>/m/pair</code> and
          <code>/api/pairing/claim</code>. Server URL is independent of optional
          <code>AGNT_SERVER_URL</code> make pin.
        </p>
      </template>
    </main>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useStore } from 'vuex';
import { clearMediaCookie } from '@/services/mediaAuth.js';
import {
  parsePairingInput,
  claimPairingCodeAt,
  rememberServerOrigin,
  getRememberedServerOrigin,
  clearRememberedServerOrigin,
  normalizeServerOrigin,
  setAutoOpenServer,
  getAutoOpenServer,
  applyPairingSession,
} from '@/services/mobileLitePairing.js';

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
const serverMsg = ref('');
const serverError = ref('');

const currentOrigin = computed(() =>
  typeof window !== 'undefined' ? window.location.origin : ''
);

const parsed = computed(() => {
  const raw = pasteInput.value;
  // Bare code: resolve against saved/typed server URL, not only current page origin.
  const codeOnly = /^[a-f0-9]{32}$/i.test(String(raw || '').trim());
  if (codeOnly) {
    const origin = normalizeServerOrigin(serverInput.value) || currentOrigin.value;
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
  if (p.kind === 'code') return `Will claim on ${p.origin}`;
  if (p.kind === 'url' && p.navigateAway) {
    return `Will open ${p.origin} and claim there`;
  }
  if (p.kind === 'url') return `Will claim on ${p.origin}`;
  if (p.kind === 'origin') return `Will open lite home at ${p.origin}`;
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

function saveServerOnly() {
  serverError.value = '';
  serverMsg.value = '';
  const origin = normalizeServerOrigin(serverInput.value);
  if (!origin) {
    serverError.value = 'Enter a valid URL (e.g. http://192.168.1.20:3333).';
    return;
  }
  rememberServerOrigin(origin);
  setAutoOpenServer(autoOpen.value);
  serverInput.value = origin;
  serverMsg.value = `Saved ${origin}`;
}

/**
 * Always continue toward Annie chat after save.
 * Use full page navigation (not only router.push) so Capacitor/WKWebView and
 * same-route cases still move; auth guard will bounce to /m?returnTo= if needed.
 */
async function saveAndOpenServer() {
  saveServerOnly();
  const origin = normalizeServerOrigin(serverInput.value);
  if (!origin) return;

  serverError.value = '';
  serverMsg.value = 'Opening chat…';

  // Re-probe session — authed may be stale after pairing in another tab/webview.
  if (localStorage.getItem('token')) {
    try {
      await store.dispatch('userAuth/fetchUserData', { forceRefresh: true });
      authed.value = Boolean(store.state.userAuth?.user);
    } catch {
      /* guard will re-try on /m/chat */
    }
  }

  const chatUrl = `${origin}/m/chat`;

  if (origin !== currentOrigin.value) {
    window.location.assign(chatUrl);
    return;
  }

  // Same origin: hard navigate so we never "succeed" with a no-op push.
  // Cache-bust path so WKWebView reloads even if already on /m/chat.
  if (authed.value || localStorage.getItem('token')) {
    window.location.assign(`${chatUrl}${chatUrl.includes('?') ? '&' : '?'}_ts=${Date.now()}`);
    return;
  }

  // No token yet — still try /m/chat so returnTo is set after auth bounce, and
  // show pairing UI clearly.
  serverMsg.value = 'Not signed in yet — pair below, then chat opens.';
  try {
    await router.push({ name: 'MobileChat' });
  } catch {
    /* ignore */
  }
  // If guard bounced us back, focus pair field.
  requestAnimationFrame(() => {
    const el = document.getElementById('ml-paste');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.focus();
    }
  });
}

function switchToSavedServer() {
  saveAndOpenServer();
}

async function refreshSession() {
  checking.value = true;
  try {
    // Prefill server from storage or current host
    if (!serverInput.value) {
      serverInput.value = getRememberedServerOrigin() || currentOrigin.value || '';
    }

    // Auto-open another saved host (browser /m or after leaving fixed pin)
    if (
      !route.query.nop &&
      getAutoOpenServer() &&
      getRememberedServerOrigin() &&
      getRememberedServerOrigin() !== currentOrigin.value &&
      !localStorage.getItem('token')
    ) {
      window.location.replace(`${getRememberedServerOrigin()}/m`);
      return;
    }

    if (localStorage.getItem('token')) {
      await store.dispatch('userAuth/fetchUserData', { forceRefresh: true });
    }
    authed.value = Boolean(store.state.userAuth?.user);
    if (authed.value) {
      rememberServerOrigin(currentOrigin.value);
      serverInput.value = currentOrigin.value;
    }
    if (authed.value && route.query.returnTo) {
      router.replace(String(route.query.returnTo));
      return;
    }
    if (authed.value && route.query.auto === '1') {
      router.replace({ name: 'MobileChat' });
    }
  } finally {
    checking.value = false;
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

async function submitPair() {
  error.value = '';
  const p = parsed.value;
  if (!p) {
    error.value =
      'Paste a full pair link, or set Server URL and paste a 32-character code.';
    return;
  }

  busy.value = true;
  try {
    if (p.kind === 'origin') {
      rememberServerOrigin(p.origin);
      serverInput.value = p.origin;
      if (p.navigateAway) {
        window.location.assign(p.liteHomeUrl);
        return;
      }
      return;
    }

    if (p.navigateAway) {
      rememberServerOrigin(p.origin);
      serverInput.value = p.origin;
      window.location.assign(p.litePairUrl);
      return;
    }

    await claimOnOrigin(p.code, p.origin);
  } catch (e) {
    const status = e?.response?.status;
    error.value =
      status === 404
        ? 'Code used or expired. Generate a new one on desktop.'
        : status === 429
          ? 'Too many attempts. Wait a minute.'
          : e?.response?.data?.error || e?.message || 'Pairing failed.';
  } finally {
    busy.value = false;
  }
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
</style>
