<template>
  <div class="phone-access" :aria-busy="!ready">
    <div class="pa-header">
      <div>
        <h3 class="pa-title"><i class="fas fa-mobile-alt"></i> Phone Access</h3>
        <p class="pa-sub">Run this AGNT instance from your phone.</p>
      </div>
      <!-- Bound to the SAVED setting, not the live socket: after switching on,
           the socket has not moved until the backend restarts, and a toggle that
           springs back to off is indistinguishable from "it did not save".
           Absent entirely until measured: a switch rendered off is a claim, and
           an unread setting has not earned one. -->
      <label v-if="ready" class="pa-switch" :class="{ disabled: busy || envPinned }">
        <input type="checkbox" :checked="desiredLanEnabled" :disabled="busy || envPinned" @change="onToggle" />
        <span class="pa-slider"></span>
      </label>
      <span v-else class="pa-sk pa-sk-switch" aria-hidden="true"></span>
    </div>

    <p v-if="envPinned" class="pa-note pa-note-warn">
      <i class="fas fa-lock"></i>
      <span><code>BIND_HOST</code> is set in the environment and overrides this toggle.</span>
    </p>

    <p v-if="loopbackOnly" class="pa-note">
      <i class="fas fa-shield-alt"></i>
      <span>AGNT is bound to <code>127.0.0.1</code> — reachable only from this machine.</span>
    </p>

    <div v-if="ready && restartRequired" class="pa-restart">
      <div class="pa-restart-text">
        <i class="fas fa-sync-alt"></i>
        <span>
          <strong>Restart required.</strong>
          AGNT is still listening on <code>{{ bindHost || '127.0.0.1' }}</code> only, so
          your phone can't reach it yet.
        </span>
      </div>
      <button class="pa-btn pa-btn-primary" :disabled="busy" @click="onRestart">Restart now</button>
    </div>

    <!-- Pairing works on loopback for a simulator on this machine; LAN is still
         required for a real phone. -->
    <template v-if="ready && !restartRequired">
      <p v-if="localhostOnly" class="pa-note">
        <i class="fas fa-laptop"></i>
        <span>
          Localhost only — reachable from this computer, including a simulator running on it.
          Enable the toggle above (and restart) for a physical phone on Wi‑Fi.
        </span>
      </p>

      <div v-if="noAddressFound" class="pa-note pa-note-warn">
        <i class="fas fa-exclamation-triangle"></i>
        <span>No network address found. Connect to Wi-Fi or Ethernet (Simulator can still use 127.0.0.1).</span>
      </div>

      <div class="pa-body">
        <div class="pa-qr-col">
          <!-- Both targets share one code; this only chooses which path the QR
               and the copy link point at. -->
          <div class="pa-target" role="radiogroup" aria-label="Pair with">
            <button
              type="button"
              class="pa-target-btn"
              :class="{ active: pairTarget === 'lite' }"
              role="radio"
              :aria-checked="pairTarget === 'lite'"
              v-tooltip="'Phone-sized chat client (/m)'"
              @click="pairTarget = 'lite'"
            >
              Phone chat
            </button>
            <button
              type="button"
              class="pa-target-btn"
              :class="{ active: pairTarget === 'full' }"
              role="radio"
              :aria-checked="pairTarget === 'full'"
              v-tooltip="'The complete AGNT interface (/pair)'"
              @click="pairTarget = 'full'"
            >
              Full app
            </button>
          </div>

          <div v-if="qrSvg" class="pa-qr" v-html="qrSvg"></div>
          <div v-else class="pa-qr pa-qr-empty">
            <i class="fas fa-qrcode"></i>
            <span>Generate a code to pair</span>
          </div>

          <div v-if="code" class="pa-countdown" :class="{ expiring: secondsLeft <= 20 }">
            <template v-if="secondsLeft > 0">Expires in {{ secondsLeft }}s</template>
            <template v-else>Expired</template>
          </div>

          <!-- One copy target: the same network URL encoded in the QR (host + code). -->
          <div v-if="code && secondsLeft > 0 && copyLinkUrl" class="pa-copy-block">
            <div class="pa-urls-label">Can&rsquo;t scan? Copy link</div>
            <button
              type="button"
              class="pa-url"
              v-tooltip="'Copy pair link (URL with code)'"
              @click="copy(copyLinkUrl)"
            >
              <code class="pa-url-text">{{ copyLinkUrl }}</code>
              <span class="pa-url-badge">Link</span>
              <i class="fas" :class="copied === copyLinkUrl ? 'fa-check' : 'fa-copy'"></i>
            </button>
            <p v-if="code.warning || code.loopbackOnly" class="pa-fineprint">
              {{ code.warning || 'Localhost only until Phone Access is on the network.' }}
            </p>
          </div>

          <!-- Did anything actually reach this machine? Without this the user
               cannot tell "wrong network" from "server broken", and blames
               the half that is working. -->
          <div v-if="code" class="pa-witness" :class="phoneSeen ? 'ok' : waitedLong ? 'warn' : ''">
            <template v-if="phoneSeen">
              <i class="fas fa-check-circle"></i>
              <span>A device reached this computer &mdash; <code>{{ phoneSeen }}</code></span>
            </template>
            <template v-else-if="waitedLong">
              <i class="fas fa-exclamation-triangle"></i>
              <span>
                Nothing has reached this computer yet. Check your phone is on
                <strong>{{ networkName || "this Wi-Fi" }}</strong>, not mobile data, and not on a VPN.
              </span>
            </template>
            <template v-else>
              <i class="fas fa-sync-alt fa-spin"></i>
              <span>Waiting for your phone&hellip;</span>
            </template>
          </div>

          <button class="pa-btn" :disabled="busy" @click="onGenerate">
            {{ code ? 'New code' : 'Generate pairing code' }}
          </button>
        </div>

        <div class="pa-info-col">
          <!-- The hard prerequisite, stated first and loudest. Everything
               else in this panel is irrelevant if it is not satisfied, and
               burying it in a list of equal-weight "steps" is what let a
               phone-on-cellular look like a broken server. -->
          <!-- The prerequisite depends on WHICH address the QR encodes. A
               private LAN address genuinely requires the same Wi-Fi; a tailnet,
               public hostname or proxied URL does not, and repeating the Wi-Fi
               line there would send the user to debug a network that is fine. -->
          <div class="pa-req">
            <i class="fas" :class="selectedIsLan ? 'fa-wifi' : 'fa-globe'"></i>
            <div class="pa-req-body">
              <template v-if="selectedIsLan">
                <div class="pa-req-title">
                  <template v-if="networkName">
                    Your phone must be on Wi-Fi <strong>{{ networkName }}</strong>
                  </template>
                  <template v-else>Your phone must be on the same Wi-Fi as this computer</template>
                </div>
                <div class="pa-req-sub">Mobile data and VPNs will not reach this address.</div>
              </template>
              <template v-else>
                <div class="pa-req-title">
                  Your phone must be able to reach <strong>{{ selectedOrigin }}</strong>
                </div>
                <div class="pa-req-sub">
                  {{ selectedHint }}
                </div>
              </template>
            </div>
          </div>

          <div class="pa-step">
            <span class="pa-num">2</span>
            <span>Scan the QR, or <strong>copy the link</strong> if you can&rsquo;t scan.</span>
          </div>
          <div class="pa-step">
            <span class="pa-num">3</span>
            <span>Open the link on the phone (or paste it in AGNT Chat). Signs in automatically.</span>
          </div>

          <!-- More than one candidate means the server genuinely cannot tell
               which route the phone has (multi-homed box, split-horizon DNS,
               VPN alongside Wi-Fi). The user can. Let them choose, and put
               their choice in the QR. -->
          <div class="pa-urls">
            <div class="pa-urls-label">{{ origins.length > 1 ? 'Pair using' : 'Reachable at' }}</div>
            <div
              v-for="o in origins"
              :key="o.origin"
              class="pa-url"
              :class="{ active: o.origin === selectedOrigin, choosable: origins.length > 1 }"
              role="button"
              tabindex="0"
              v-tooltip="o.label || o.origin"
              @click="selectedOrigin = o.origin"
              @keydown.enter.prevent="selectedOrigin = o.origin"
              @keydown.space.prevent="selectedOrigin = o.origin"
            >
              <span class="pa-url-text">
                <code>{{ o.origin }}</code>
                <span v-if="o.label" class="pa-url-label">{{ o.label }}</span>
              </span>
              <button class="pa-copy" v-tooltip="'Copy ' + o.origin" @click.stop="copy(o.origin)">
                <i class="fas" :class="copied === o.origin ? 'fa-check' : 'fa-copy'"></i>
              </button>
            </div>
          </div>

          <p class="pa-fineprint">
            Codes are single-use and expire in two minutes. The QR is a full URL
            (<code>/m/pair?c=…</code>) so the phone learns the server address (LAN or
            Tailscale) from the link — never your sign-in token. Full AGNT web still
            accepts <code>/pair</code> with the same code.
          </p>
        </div>
      </div>
    </template>

    <!-- Occupies the settled layout rather than collapsing, so nothing below
         the panel jumps when the real answer lands. -->
    <div v-else-if="!ready && !error" class="pa-skeleton" aria-hidden="true">
      <div class="pa-sk pa-sk-note"></div>
      <div class="pa-body">
        <div class="pa-qr-col">
          <div class="pa-sk pa-sk-target"></div>
          <div class="pa-sk pa-sk-qr"></div>
          <div class="pa-sk pa-sk-btn"></div>
        </div>
        <div class="pa-info-col">
          <div class="pa-sk pa-sk-req"></div>
          <div class="pa-sk pa-sk-line"></div>
          <div class="pa-sk pa-sk-line"></div>
          <div class="pa-sk pa-sk-url"></div>
          <div class="pa-sk pa-sk-url"></div>
          <div class="pa-sk pa-sk-fine"></div>
        </div>
      </div>
    </div>

    <p v-if="error" class="pa-note pa-note-error"><i class="fas fa-exclamation-circle"></i><span>{{ error }}</span></p>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, computed, watch } from 'vue';
import { toSvg } from '@/utils/qrcode.js';
import pairingService from '@/services/pairingService.js';
import { useAsyncResource } from '@/composables/useAsyncResource.js';

// Everything this panel asserts about the network comes from ONE measured
// resource, which is null until the server has actually answered. Defaults
// like `ref(false)` are not "unknown", they are claims, and the template
// believed them: for one frame after every mount the panel announced
// "bound to 127.0.0.1", "localhost only" and an empty address list, then
// replaced all three. See composables/useAsyncResource.js.
//
// Two fields are deliberately not collapsed into one:
//   lanEnabled        - the socket we are ACTUALLY listening on (gates the QR)
//   desiredLanEnabled - the saved setting (drives the toggle)
// They differ exactly while a restart is pending, which is the state that
// previously reported itself as "all good" and produced an unreachable QR code.
const {
  data: status,
  error,
  ready,
  refresh: loadStatus,
  patch: patchStatus,
} = useAsyncResource(
  async () => {
    const s = await pairingService.getStatus();
    // Normalise at the boundary so nothing downstream handles two shapes.
    return {
      ...s,
      // Older backends do not send desiredLanEnabled; fall back so the toggle
      // reflects something sane rather than silently reading undefined.
      desiredLanEnabled: s.desiredLanEnabled ?? s.lanEnabled,
      envPinned: s.bindSource === 'env',
      origins: toOrigins(s),
    };
  },
  // Settings sections are a plain v-if chain, so this component is destroyed
  // on every tab change. Without the cache the skeleton is paid on every
  // single visit; with it, only the first.
  { cacheKey: 'pairing:status' },
);

const refresh = () => loadStatus({ onError: friendly });

const lanEnabled = computed(() => status.value?.lanEnabled === true);
const desiredLanEnabled = computed(() => status.value?.desiredLanEnabled === true);
const bindHost = computed(() => status.value?.bindHost || '');
const envPinned = computed(() => status.value?.envPinned === true);
const restartRequired = computed(() => status.value?.restartRequired === true);
// Named network + reachability witness: the two facts that turn "it doesn't
// work" into a specific, checkable statement.
const networkName = computed(() => status.value?.networkName || '');
const lastExternalRequest = computed(() => status.value?.lastExternalRequest || null);
// Candidate addresses another device could use, best first. The server derives
// these from the request that asked for them (see services/ReachableOrigin.js)
// rather than from its own network cards, which is only correct when the server
// IS this desktop.
const origins = computed(() => status.value?.origins || []);

// Every warning that asserts a NEGATIVE carries `ready` in its own condition,
// not merely in an ancestor's v-if. An outer gate can be refactored away by
// someone who does not know it was load-bearing; this cannot.
const loopbackOnly = computed(() => ready.value && !desiredLanEnabled.value && !envPinned.value);
const localhostOnly = computed(() => ready.value && !lanEnabled.value);
const noAddressFound = computed(() => ready.value && lanEnabled.value && !urls.value.length);

const selectedOrigin = ref('');
const code = ref(null);
const expiresAt = ref(0);
const now = ref(Date.now());
const busy = ref(false);
const copied = ref('');
const codeShownAt = ref(0);
let ticker = null;
let statusTicks = 0;

// Keep the user's pick across polls; only fall back when it disappears.
watch(
  origins,
  (list) => {
    if (!list.some((o) => o.origin === selectedOrigin.value)) {
      selectedOrigin.value = list[0]?.origin || '';
    }
  },
  { immediate: true },
);

const secondsLeft = computed(() => Math.max(0, Math.ceil((expiresAt.value - now.value) / 1000)));

// `urls` is kept as a flat list because the empty-state check reads it and the
// shape is part of this component's contract with older backends.
const urls = computed(() => origins.value.map((o) => o.origin));

/**
 * Normalise both shapes into one. A backend that predates candidate origins
 * sends only `urls: string[]`; treating that as an empty candidate list would
 * blank a panel that used to work.
 */
function toOrigins(payload) {
  if (Array.isArray(payload?.origins) && payload.origins.length) return payload.origins;
  return (payload?.urls || []).map((origin) => ({ origin, source: 'interface', label: '', external: true }));
}

const hostOf = (origin) => {
  try {
    return new URL(origin).hostname.replace(/^\[|\]$/g, '');
  } catch {
    return '';
  }
};

// Only a private IPv4 carries the "same Wi-Fi" requirement. A tailnet address,
// a public hostname or a proxied URL is reachable from anywhere with a route.
const selectedIsLan = computed(() => {
  const h = hostOf(selectedOrigin.value);
  return /^192\.168\./.test(h) || /^10\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h);
});

const selectedHint = computed(() => {
  const h = hostOf(selectedOrigin.value);
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h)) return 'Your phone needs to be on the same VPN or tailnet.';
  if (selectedOrigin.value.startsWith('https://')) return 'Reachable from anywhere this address resolves.';
  return 'Your phone needs a network route to this address.';
});

// The pairing code lives in the server's memory keyed only by itself, so it is
// claimable from any address that reaches the server. That is what makes
// offering a choice honest rather than decorative.
const activeUrl = computed(() => {
  if (!code.value) return '';
  const match = (code.value.origins || []).find((o) => o.origin === selectedOrigin.value);
  if (match?.url) return match.url;
  if (selectedOrigin.value) return `${selectedOrigin.value}/pair?c=${code.value.code}`;
  return code.value.url;
});

// Only count a hit that arrived AFTER this code was displayed. A stale hit
// from an earlier session would report success for a phone that never
// connected — a false green is worse than no signal at all.
const phoneSeen = computed(() => {
  const hit = lastExternalRequest.value;
  if (!hit || !codeShownAt.value || hit.at < codeShownAt.value) return null;
  return hit.ip;
});

// Long enough that a phone genuinely connecting is not nagged, short enough
// that someone staring at a dead QR is not left guessing.
const waitedLong = computed(() => codeShownAt.value > 0 && now.value - codeShownAt.value > 15000);

// Which client the QR opens.
//
// /pairing/code returns BOTH a full-app `url` and a lite `liteUrl` for every
// origin. The QR was switched to encode liteUrl only, which left no path to the
// full app anywhere in the UI -- the API still returned it, nothing rendered
// it, so an existing user scanning the same QR silently landed somewhere new.
// The code itself is client-agnostic; only the path differs.
const pairTarget = ref('lite'); // 'lite' | 'full'

const pairQrUrl = computed(() => {
  if (!code.value) return '';
  const lite = pairTarget.value === 'lite';
  const match = (code.value.origins || []).find((o) => o.origin === selectedOrigin.value);
  const fromOrigin = lite ? match?.liteUrl : match?.url;
  if (fromOrigin) return fromOrigin;
  // Older backend, or an origin the response did not enumerate: build it.
  if (selectedOrigin.value && code.value.code) {
    return `${selectedOrigin.value}${lite ? '/m/pair' : '/pair'}?c=${code.value.code}`;
  }
  return (lite ? code.value.liteUrl : code.value.url) || activeUrl.value || '';
});

// Single copy target: network pair URL (same payload as the QR). Prefer LAN
// liteUrl; only fall back to localhost when nothing else is available.
const copyLinkUrl = computed(() => {
  if (!code.value || secondsLeft.value <= 0) return '';
  if (pairQrUrl.value && !pairQrUrl.value.includes('127.0.0.1') && !pairQrUrl.value.includes('localhost')) {
    return pairQrUrl.value;
  }
  // When LAN URL is the only one (or is loopback), still expose one link.
  if (pairQrUrl.value) return pairQrUrl.value;
  const c = code.value.code;
  if (!c) return '';
  let port = '3333';
  try {
    if (typeof window !== 'undefined' && window.location?.port) {
      port = window.location.port;
    }
  } catch {
    /* keep default */
  }
  return `http://127.0.0.1:${port}/m/pair?c=${c}`;
});

const qrSvg = computed(() => {
  // QR encodes the same URL as the copy "Link" row.
  const url = copyLinkUrl.value;
  if (!code.value || secondsLeft.value <= 0 || !url) return '';
  try {
    return toSvg(url, { moduleSize: 5, quietZone: 3, dark: '#000000', light: '#ffffff' });
  } catch (e) {
    // Never render a corrupt code: an unscannable QR is worse than none.
    error.value = `Could not render QR: ${e.message}`;
    return '';
  }
});

function friendly(e) {
  if (e?.response?.status === 401) return 'Session expired — sign in again.';
  // 409: the server refused to mint a code because it is loopback-only, so the
  // QR would have encoded an address nothing is listening on.
  if (e?.response?.status === 409) {
    patchStatus({
      restartRequired: e.response.data?.restartRequired ?? true,
      bindHost: e.response.data?.bindHost || bindHost.value,
    });
    return e.response.data?.error || 'This server is not reachable from your network yet.';
  }
  return e?.response?.data?.error || e?.message || 'Something went wrong.';
}

async function onToggle(evt) {
  const next = evt.target.checked;
  busy.value = true;
  error.value = '';
  try {
    const r = await pairingService.setLanAccess(next);
    patchStatus({
      lanEnabled: r.lanEnabled,
      desiredLanEnabled: r.desiredLanEnabled ?? next,
      bindHost: r.bindHost || bindHost.value,
      envPinned: !!r.envPinned,
      restartRequired: !!r.restartRequired,
    });
    if (!r.restartRequired) await refresh();
  } catch (e) {
    error.value = friendly(e);
    evt.target.checked = desiredLanEnabled.value; // revert the visual state
  } finally {
    busy.value = false;
  }
}

async function onGenerate() {
  busy.value = true;
  error.value = '';
  try {
    const c = await pairingService.createCode();
    code.value = c;
    // Minting re-derives candidates from this very request, so it is the
    // freshest answer available — prefer it over the polled status.
    const minted = toOrigins(c);
    expiresAt.value = c.expiresAt;
    now.value = Date.now();
    // Anchor for the witness: only connections after this instant count.
    codeShownAt.value = Date.now();
    // Clearing the witness alongside the fresher candidate list, in one write:
    // a hit recorded before this code existed must not read as success.
    // selectedOrigin is reconciled by the watcher on `origins`.
    patchStatus({
      ...(minted.length ? { origins: minted } : {}),
      lastExternalRequest: null,
    });
  } catch (e) {
    error.value = friendly(e);
  } finally {
    busy.value = false;
  }
}

async function onRestart() {
  busy.value = true;
  error.value = '';
  try {
    await pairingService.restartBackend();
    patchStatus({ restartRequired: false });
    // The backend drains for ~2s then respawns; poll until status answers.
    // refresh() resolves to null rather than rejecting, so the retry has to
    // test the result — the previous .catch() could never fire and the panel
    // stayed stale forever if the first attempt landed too early.
    setTimeout(function poll(attempt = 0) {
      refresh().then((ok) => {
        if (!ok && attempt < 15) setTimeout(() => poll(attempt + 1), 2000);
      });
    }, 4000);
  } catch (e) {
    error.value = friendly(e);
  } finally {
    busy.value = false;
  }
}

async function copy(url) {
  try {
    await navigator.clipboard.writeText(url);
    copied.value = url;
    setTimeout(() => { if (copied.value === url) copied.value = ''; }, 1500);
  } catch {
    /* clipboard denied — the URL is visible on screen anyway */
  }
}

onMounted(() => {
  refresh();
  ticker = setInterval(() => {
    // Poll the witness while a code is live, so the panel reflects the phone
    // within a few seconds instead of only on a manual refresh.
    statusTicks++;
    if (code.value && statusTicks % 3 === 0) refresh();
    now.value = Date.now();
  }, 1000);
});
onBeforeUnmount(() => clearInterval(ticker));
</script>

<style scoped>
.phone-access {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.pa-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.pa-title {
  margin: 0 0 4px;
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text, #e0e0e0);
}
.pa-title i {
  color: var(--color-primary, #19ef83);
  margin-right: 8px;
}
.pa-sub {
  margin: 0;
  font-size: 13px;
  color: var(--color-light-med-navy, #8b93a7);
}

/* ── switch ── */
.pa-switch {
  position: relative;
  display: inline-block;
  width: 48px;
  height: 28px;
  flex: 0 0 auto;
}
.pa-switch.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.pa-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}
.pa-slider {
  position: absolute;
  inset: 0;
  cursor: pointer;
  background: var(--color-darker-1, #1b1b2b);
  border: 1px solid var(--color-dull-navy, #2e3350);
  border-radius: 999px;
  transition: background 0.2s ease, border-color 0.2s ease;
}
.pa-slider::before {
  content: '';
  position: absolute;
  height: 20px;
  width: 20px;
  left: 3px;
  top: 3px;
  border-radius: 50%;
  background: var(--color-light-med-navy, #8b93a7);
  transition: transform 0.2s ease, background 0.2s ease;
}
.pa-switch input:checked + .pa-slider {
  background: color-mix(in srgb, var(--color-primary, #19ef83) 25%, transparent);
  border-color: var(--color-primary, #19ef83);
}
.pa-switch input:checked + .pa-slider::before {
  transform: translateX(20px);
  background: var(--color-primary, #19ef83);
}

/* ── notes ── */
.pa-note {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 13px;
  background: var(--color-darker-1, #1b1b2b);
  border: 1px solid var(--color-dull-navy, #2e3350);
  color: var(--color-light-med-navy, #8b93a7);
}
.pa-note code {
  color: var(--color-text, #e0e0e0);
}
.pa-note-warn {
  border-color: color-mix(in srgb, #ffd700 40%, transparent);
  color: var(--color-yellow);
}
.pa-note-error {
  border-color: color-mix(in srgb, #e53d8f 50%, transparent);
  color: var(--color-red);
}

.pa-restart {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
  border-radius: 8px;
  background: var(--color-darker-1, #1b1b2b);
  border: 1px solid color-mix(in srgb, #ffd700 40%, transparent);
}
.pa-restart-text {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--color-yellow);
}

/* ── body ── */
.pa-body {
  display: flex;
  gap: 24px;
  flex-wrap: wrap;
}
.pa-qr-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
/* Which client the QR opens. Segmented, because the two are alternatives
   rather than independent options. */
.pa-target {
  display: flex;
  width: 208px;
  padding: 2px;
  gap: 2px;
  border-radius: 8px;
  background: var(--color-darker-1, #1b1b2b);
  border: 1px solid var(--color-dull-navy, #2e3350);
  box-sizing: border-box;
}
.pa-target-btn {
  flex: 1;
  padding: 6px 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-light-med-navy, #8b93a7);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.pa-target-btn:hover {
  color: var(--color-lightest-navy, #e0e0e0);
}
.pa-target-btn.active {
  background: var(--color-dull-navy, #2e3350);
  color: var(--color-lightest-navy, #e0e0e0);
}
.pa-qr {
  width: 208px;
  height: 208px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px;
  border-radius: 12px;
  background: #ffffff;
  box-sizing: border-box;
}
.pa-qr :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
}
.pa-qr-empty {
  flex-direction: column;
  gap: 8px;
  background: var(--color-darker-1, #1b1b2b);
  border: 1px dashed var(--color-dull-navy, #2e3350);
  color: var(--color-light-med-navy, #8b93a7);
  font-size: 12px;
}
.pa-qr-empty i {
  font-size: 32px;
  opacity: 0.4;
}
.pa-countdown {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--color-light-med-navy, #8b93a7);
}
.pa-countdown.expiring {
  color: var(--color-red);
}

.pa-info-col {
  flex: 1;
  min-width: 240px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.pa-step {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: var(--color-text, #e0e0e0);
}
.pa-num {
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 600;
  background: color-mix(in srgb, var(--color-primary, #19ef83) 20%, transparent);
  color: var(--color-primary, #19ef83);
}

.pa-urls {
  margin-top: 4px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.pa-urls-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--color-light-med-navy, #8b93a7);
}
.pa-url {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 40px;
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--color-darker-1, #1b1b2b);
  border: 1px solid var(--color-dull-navy, #2e3350);
  color: var(--color-text, #e0e0e0);
  font-family: inherit;
  cursor: pointer;
  text-align: left;
}
.pa-url:hover {
  border-color: var(--color-primary, #19ef83);
}
.pa-url.active {
  border-color: var(--color-primary, #19ef83);
  background: color-mix(in srgb, var(--color-primary, #19ef83) 12%, transparent);
}
.pa-url code {
  font-size: 13px;
}
.pa-url-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
  overflow: hidden;
}
.pa-url-label {
  font-size: 11px;
  color: var(--color-light-med-navy, #8b93a7);
}
.pa-copy {
  flex: 0 0 auto;
  min-width: 32px;
  min-height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-light-med-navy, #8b93a7);
  cursor: pointer;
}
.pa-copy:hover {
  color: var(--color-primary, #19ef83);
}
.pa-url-code .pa-code-mono {
  flex: 1;
  font-size: 12px;
  letter-spacing: 0.04em;
  word-break: break-all;
  white-space: normal;
}
.pa-url-badge {
  flex: 0 0 auto;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-primary, #19ef83);
  border: 1px solid color-mix(in srgb, var(--color-primary, #19ef83) 50%, transparent);
  border-radius: 4px;
  padding: 2px 6px;
}
.pa-copy-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
  max-width: 280px;
}
.pa-copy-block .pa-url {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  text-align: left;
}
.pa-copy-block .pa-url-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px !important;
  display: block;
}

.pa-req {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--color-primary, #19ef83) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-primary, #19ef83) 45%, transparent);
}

.pa-req > i {
  font-size: 18px;
  line-height: 1.3;
  color: var(--color-primary, #19ef83);
}

.pa-req-body {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.pa-req-title {
  font-size: 14px;
  line-height: 1.45;
  color: var(--color-text, #e0e0e0);
}

.pa-req-title strong {
  color: var(--color-primary, #19ef83);
}

.pa-req-sub {
  font-size: 12px;
  color: var(--color-light-med-navy, #8b93a7);
}

.pa-witness {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  max-width: 208px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-light-med-navy, #8b93a7);
}

.pa-witness.ok {
  color: var(--color-primary, #19ef83);
}

.pa-witness.warn {
  color: var(--color-yellow);
}

.pa-witness code {
  color: inherit;
}

.pa-fineprint {
  margin: 4px 0 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--color-light-med-navy, #8b93a7);
}

.pa-btn {
  min-height: 40px;
  padding: 8px 16px;
  border-radius: 8px;
  border: 1px solid var(--color-dull-navy, #2e3350);
  background: var(--color-darker-1, #1b1b2b);
  color: var(--color-text, #e0e0e0);
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
}
.pa-btn:hover:not(:disabled) {
  border-color: var(--color-primary, #19ef83);
}
.pa-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.pa-btn-primary {
  background: var(--color-primary, #19ef83);
  border-color: var(--color-primary, #19ef83);
  color: var(--on-fill-accent);
  font-weight: 600;
}

/* ── loading skeleton ──
   Deliberately mirrors the settled geometry (208px QR column, 40px button,
   flexible info column) so the panel does not resize when data lands. A
   spinner would say "working"; this says "here is where it goes". */
.pa-skeleton {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.pa-sk {
  border-radius: 8px;
  background: var(--color-dull-navy, #2e3350);
  opacity: 0.35;
  animation: pa-sk-pulse 1.4s ease-in-out infinite;
}
.pa-sk-switch {
  display: inline-block;
  width: 48px;
  height: 28px;
  flex: 0 0 auto;
  border-radius: 999px;
}
.pa-sk-note {
  height: 38px;
}
.pa-sk-target {
  width: 208px;
  height: 32px;
}
.pa-sk-qr {
  width: 208px;
  height: 208px;
}
.pa-sk-btn {
  width: 208px;
  height: 40px;
}
.pa-sk-req {
  height: 56px;
}
.pa-sk-line {
  height: 18px;
  width: 78%;
}
.pa-sk-url {
  height: 44px;
}
.pa-sk-fine {
  height: 72px;
}

@keyframes pa-sk-pulse {
  0%,
  100% {
    opacity: 0.22;
  }
  50% {
    opacity: 0.45;
  }
}

@media (prefers-reduced-motion: reduce) {
  .pa-sk {
    animation: none;
  }
}

@media (max-width: 800px) {
  .pa-body {
    gap: 16px;
  }
  .pa-qr-col {
    width: 100%;
  }
}
</style>
