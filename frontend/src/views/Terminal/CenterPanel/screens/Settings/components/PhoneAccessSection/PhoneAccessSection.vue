<template>
  <div class="phone-access">
    <div class="pa-header">
      <div>
        <h3 class="pa-title"><i class="fas fa-mobile-screen-button"></i> Phone Access</h3>
        <p class="pa-sub">Run this AGNT instance from your phone on the same network.</p>
      </div>
      <label class="pa-switch" :class="{ disabled: busy || envPinned }">
        <input type="checkbox" :checked="lanEnabled" :disabled="busy || envPinned" @change="onToggle" />
        <span class="pa-slider"></span>
      </label>
    </div>

    <p v-if="envPinned" class="pa-note pa-note-warn">
      <i class="fas fa-lock"></i>
      <span><code>BIND_HOST</code> is set in the environment and overrides this toggle.</span>
    </p>

    <p v-if="!lanEnabled && !envPinned" class="pa-note">
      <i class="fas fa-shield-halved"></i>
      <span>AGNT is bound to <code>127.0.0.1</code> — reachable only from this machine.</span>
    </p>

    <div v-if="restartRequired" class="pa-restart">
      <div class="pa-restart-text">
        <i class="fas fa-rotate"></i>
        <span>Restart the backend to apply the new binding.</span>
      </div>
      <button class="pa-btn pa-btn-primary" :disabled="busy" @click="onRestart">Restart now</button>
    </div>

    <template v-if="lanEnabled && !restartRequired">
      <div v-if="!urls.length" class="pa-note pa-note-warn">
        <i class="fas fa-triangle-exclamation"></i>
        <span>No network address found. Connect to Wi-Fi or Ethernet.</span>
      </div>

      <div v-else class="pa-body">
        <div class="pa-qr-col">
          <div v-if="qrSvg" class="pa-qr" v-html="qrSvg"></div>
          <div v-else class="pa-qr pa-qr-empty">
            <i class="fas fa-qrcode"></i>
            <span>Generate a code to pair</span>
          </div>

          <div v-if="code" class="pa-countdown" :class="{ expiring: secondsLeft <= 20 }">
            <template v-if="secondsLeft > 0">Expires in {{ secondsLeft }}s</template>
            <template v-else>Expired</template>
          </div>

          <button class="pa-btn" :disabled="busy" @click="onGenerate">
            {{ code ? 'New code' : 'Generate pairing code' }}
          </button>
        </div>

        <div class="pa-info-col">
          <div class="pa-step"><span class="pa-num">1</span><span>Make sure your phone is on the same Wi-Fi.</span></div>
          <div class="pa-step"><span class="pa-num">2</span><span>Scan the code with your camera.</span></div>
          <div class="pa-step"><span class="pa-num">3</span><span>The link signs the phone in automatically.</span></div>

          <div class="pa-urls">
            <div class="pa-urls-label">Reachable at</div>
            <button v-for="u in urls" :key="u" class="pa-url" :title="'Copy ' + u" @click="copy(u)">
              <code>{{ u }}</code>
              <i class="fas" :class="copied === u ? 'fa-check' : 'fa-copy'"></i>
            </button>
          </div>

          <p class="pa-fineprint">
            Codes are single-use and expire in two minutes. The QR contains only the code —
            never your sign-in token.
          </p>
        </div>
      </div>
    </template>

    <p v-if="error" class="pa-note pa-note-error"><i class="fas fa-circle-exclamation"></i><span>{{ error }}</span></p>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, computed } from 'vue';
import { toSvg } from '@/utils/qrcode.js';
import pairingService from '@/services/pairingService.js';

const lanEnabled = ref(false);
const envPinned = ref(false);
const restartRequired = ref(false);
const urls = ref([]);
const code = ref(null);
const expiresAt = ref(0);
const now = ref(Date.now());
const busy = ref(false);
const error = ref('');
const copied = ref('');
let ticker = null;

const secondsLeft = computed(() => Math.max(0, Math.ceil((expiresAt.value - now.value) / 1000)));

const qrSvg = computed(() => {
  if (!code.value || secondsLeft.value <= 0) return '';
  try {
    return toSvg(code.value.url, { moduleSize: 5, quietZone: 3, dark: '#000000', light: '#ffffff' });
  } catch (e) {
    // Never render a corrupt code: an unscannable QR is worse than none.
    error.value = `Could not render QR: ${e.message}`;
    return '';
  }
});

async function refresh() {
  try {
    const s = await pairingService.getStatus();
    lanEnabled.value = s.lanEnabled;
    restartRequired.value = s.restartRequired;
    urls.value = s.urls || [];
    envPinned.value = s.bindSource === 'env';
  } catch (e) {
    error.value = friendly(e);
  }
}

function friendly(e) {
  if (e?.response?.status === 401) return 'Session expired — sign in again.';
  return e?.response?.data?.error || e?.message || 'Something went wrong.';
}

async function onToggle(evt) {
  const next = evt.target.checked;
  busy.value = true;
  error.value = '';
  try {
    const r = await pairingService.setLanAccess(next);
    lanEnabled.value = r.lanEnabled;
    envPinned.value = !!r.envPinned;
    restartRequired.value = !!r.restartRequired;
    if (!r.restartRequired) await refresh();
  } catch (e) {
    error.value = friendly(e);
    evt.target.checked = lanEnabled.value; // revert the visual state
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
    expiresAt.value = c.expiresAt;
    now.value = Date.now();
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
    restartRequired.value = false;
    // The backend drains for ~2s then respawns; poll until status answers.
    setTimeout(function poll(attempt = 0) {
      refresh().catch(() => {
        if (attempt < 15) setTimeout(() => poll(attempt + 1), 2000);
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
  ticker = setInterval(() => { now.value = Date.now(); }, 1000);
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
  color: #ffd700;
}
.pa-note-error {
  border-color: color-mix(in srgb, #e53d8f 50%, transparent);
  color: #e53d8f;
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
  color: #ffd700;
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
  color: #e53d8f;
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
.pa-url code {
  font-size: 13px;
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
  color: #04120a;
  font-weight: 600;
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
