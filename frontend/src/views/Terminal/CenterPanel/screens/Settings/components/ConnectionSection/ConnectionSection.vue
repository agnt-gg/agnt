<template>
  <div class="conn">
    <!-- Browser / Docker users have no Electron bridge. There is nothing to
         configure there — the address bar already IS this setting. -->
    <div v-if="!available" class="conn-note">
      <i class="fas fa-info-circle"></i>
      <span>
        This setting only applies to the AGNT desktop app. In a browser, the address you
        visit already decides which backend you're using.
      </span>
    </div>

    <template v-else>
      <div class="conn-head">
        <h3 class="conn-title"><i class="fas fa-server"></i> Connection</h3>
        <p class="conn-sub">Choose which AGNT backend this app talks to.</p>
      </div>

      <p v-if="envPinned" class="conn-note conn-note-warn">
        <i class="fas fa-lock"></i>
        <span><code>AGNT_REMOTE_URL</code> is set in the environment and overrides this setting.</span>
      </p>

      <div class="conn-options" :class="{ disabled: envPinned }">
        <label class="conn-opt" :class="{ on: mode === 'local' }">
          <input type="radio" value="local" v-model="mode" :disabled="envPinned || busy" />
          <span class="conn-radio"></span>
          <span class="conn-opt-body">
            <span class="conn-opt-title">This computer</span>
            <span class="conn-opt-desc">AGNT runs here. Default.</span>
          </span>
        </label>

        <label class="conn-opt" :class="{ on: mode === 'remote' }">
          <input type="radio" value="remote" v-model="mode" :disabled="envPinned || busy" />
          <span class="conn-radio"></span>
          <span class="conn-opt-body">
            <span class="conn-opt-title">Remote server</span>
            <span class="conn-opt-desc">Use AGNT running on another machine, or in the cloud.</span>
          </span>
        </label>
      </div>

      <div v-if="mode === 'remote'" class="conn-remote">
        <div class="conn-url-row">
          <input
            v-model="url"
            class="conn-url"
            type="text"
            spellcheck="false"
            autocapitalize="off"
            autocorrect="off"
            placeholder="http://192.168.1.50:3333"
            :disabled="envPinned || busy"
            @keyup.enter="onTest"
          />
          <button class="conn-btn" :disabled="!url || busy || envPinned" @click="onTest">
            {{ testing ? 'Testing…' : 'Test' }}
          </button>
        </div>

        <p v-if="test" class="conn-result" :class="test.ok ? 'ok' : 'bad'">
          <i class="fas" :class="test.ok ? 'fa-check-circle' : 'fa-exclamation-circle'"></i>
          <span v-if="test.ok">Reachable — {{ test.latencyMs }}ms</span>
          <span v-else>{{ test.error }}</span>
        </p>

        <p v-if="plaintextWarning" class="conn-note conn-note-warn">
          <i class="fas fa-exclamation-triangle"></i>
          <span>Plain <code>http</code> over a network — anyone on it can read this traffic. Fine on a trusted LAN.</span>
        </p>
      </div>

      <div class="conn-actions">
        <button class="conn-btn conn-btn-primary" :disabled="!canSave" @click="onSave">
          {{ busy ? 'Saving…' : 'Save & Restart' }}
        </button>
        <span v-if="dirty && !busy" class="conn-dirty">Restarts the app</span>
      </div>

      <p v-if="error" class="conn-note conn-note-error">
        <i class="fas fa-exclamation-circle"></i><span>{{ error }}</span>
      </p>

      <p class="conn-fine">
        The remote server sends its own interface, so everything works exactly as it does
        here — your agents, history and settings all live on that machine.
      </p>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';

const api = typeof window !== 'undefined' ? window.electron?.connection : null;
const available = !!api;

const mode = ref('local');
const url = ref('');
const savedMode = ref('local');
const savedUrl = ref('');
const envPinned = ref(false);
const busy = ref(false);
const testing = ref(false);
const test = ref(null);
const error = ref('');

const dirty = computed(() => mode.value !== savedMode.value || (mode.value === 'remote' && url.value.trim() !== savedUrl.value));

const canSave = computed(() => {
  if (!available || envPinned.value || busy.value) return false;
  if (mode.value === 'remote' && !url.value.trim()) return false;
  return dirty.value;
});

const plaintextWarning = computed(() => {
  const v = url.value.trim();
  if (!/^https?:\/\//i.test(v)) return /^(?!localhost|127\.0\.0\.1)[^/]+:\d+/.test(v);
  try {
    const u = new URL(v);
    return u.protocol === 'http:' && !['localhost', '127.0.0.1', '::1'].includes(u.hostname);
  } catch {
    return false;
  }
});

async function refresh() {
  if (!api) return;
  try {
    const cfg = await api.get();
    mode.value = cfg.mode;
    savedMode.value = cfg.mode;
    url.value = cfg.url || '';
    savedUrl.value = cfg.url || '';
    envPinned.value = !!cfg.envPinned;
    if (cfg.invalid) error.value = cfg.invalid;
  } catch (e) {
    error.value = e?.message || 'Could not read the current connection.';
  }
}

async function onTest() {
  if (!api || !url.value.trim()) return;
  testing.value = true;
  test.value = null;
  error.value = '';
  try {
    test.value = await api.test(url.value.trim());
  } catch (e) {
    test.value = { ok: false, error: e?.message || 'Test failed.' };
  } finally {
    testing.value = false;
  }
}

async function onSave() {
  if (!api) return;
  busy.value = true;
  error.value = '';
  try {
    const next = mode.value === 'remote' ? { mode: 'remote', url: url.value.trim() } : { mode: 'local' };
    const res = await api.set(next);
    if (!res?.ok) {
      error.value = res?.error || 'Could not save.';
      busy.value = false;
      return;
    }
    // Relaunch is what actually applies it: the backend fork decision and the
    // window's URL are both made at startup.
    await api.relaunch();
  } catch (e) {
    error.value = e?.message || 'Could not save.';
    busy.value = false;
  }
}

onMounted(refresh);
</script>

<style scoped>
.conn {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.conn-title {
  margin: 0 0 4px;
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text, #e0e0e0);
}
.conn-title i {
  color: var(--color-primary, #19ef83);
  margin-right: 8px;
}
.conn-sub {
  margin: 0;
  font-size: 13px;
  color: var(--color-light-med-navy, #8b93a7);
}

.conn-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.conn-options.disabled {
  opacity: 0.55;
}

.conn-opt {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  min-height: 40px;
  padding: 12px;
  border-radius: 10px;
  border: 1px solid var(--color-dull-navy, #2e3350);
  background: var(--color-darker-1, #1b1b2b);
  cursor: pointer;
}
.conn-opt.on {
  border-color: var(--color-primary, #19ef83);
}
.conn-opt input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}
.conn-radio {
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  margin-top: 2px;
  border-radius: 50%;
  border: 2px solid var(--color-dull-navy, #2e3350);
}
.conn-opt.on .conn-radio {
  border-color: var(--color-primary, #19ef83);
  box-shadow: inset 0 0 0 3px var(--color-primary, #19ef83);
}
.conn-opt-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.conn-opt-title {
  font-size: 14px;
  color: var(--color-text, #e0e0e0);
}
.conn-opt-desc {
  font-size: 12px;
  color: var(--color-light-med-navy, #8b93a7);
}

.conn-remote {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.conn-url-row {
  display: flex;
  gap: 8px;
}
.conn-url {
  flex: 1;
  min-width: 0;
  min-height: 40px;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid var(--color-dull-navy, #2e3350);
  background: var(--color-background, #12121c);
  color: var(--color-text, #e0e0e0);
  font-family: inherit;
  font-size: 13px;
}
.conn-url:focus {
  outline: none;
  border-color: var(--color-primary, #19ef83);
}

.conn-result {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 13px;
}
.conn-result.ok {
  color: var(--color-primary, #19ef83);
}
.conn-result.bad {
  color: #e53d8f;
}

.conn-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
.conn-dirty {
  font-size: 12px;
  color: var(--color-light-med-navy, #8b93a7);
}

.conn-btn {
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
.conn-btn:hover:not(:disabled) {
  border-color: var(--color-primary, #19ef83);
}
.conn-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.conn-btn-primary {
  background: var(--color-primary, #19ef83);
  border-color: var(--color-primary, #19ef83);
  color: #04120a;
  font-weight: 600;
}

.conn-note {
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
.conn-note code {
  color: var(--color-text, #e0e0e0);
}
.conn-note-warn {
  border-color: color-mix(in srgb, #ffd700 40%, transparent);
  color: #ffd700;
}
.conn-note-error {
  border-color: color-mix(in srgb, #e53d8f 50%, transparent);
  color: #e53d8f;
}

.conn-fine {
  margin: 0;
  font-size: 11px;
  line-height: 1.6;
  color: var(--color-light-med-navy, #8b93a7);
}
</style>
