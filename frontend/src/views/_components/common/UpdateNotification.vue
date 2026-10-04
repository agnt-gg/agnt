<template>
  <Transition name="slide-down">
    <!--
      Desktop builds that update themselves render ONLY from main's update state
      (electron/autoUpdate.js). The agnt.gg "download it yourself" banner is for
      everything else: browser, Docker, deb/rpm and dev builds.
    -->
    <div v-if="view === 'ready'" class="update-banner" data-testid="update-ready">
      <div class="update-content">
        <div class="update-icon">⬇️</div>
        <div class="update-text">
          <span class="update-title">Update Ready</span>
          <span class="update-version">
            <template v-if="blockedText">{{ blockedText }}</template>
            <template v-else>v{{ state.currentVersion }} → v{{ state.available?.version }}</template>
            <template v-if="state.needsPermission"> · Windows will ask for permission</template>
          </span>
        </div>
      </div>
      <div class="update-actions">
        <button v-if="state.blocked" class="update-btn download-btn" :disabled="installing" @click="install(true)">
          {{ installing ? 'Restarting…' : 'Restart anyway' }}
        </button>
        <button v-else-if="state.needsExplicitInstall" class="update-btn download-btn" :disabled="installing" @click="install(false)">
          {{ installing ? 'Restarting…' : 'Restart to update' }}
        </button>
        <button v-else class="update-btn download-btn" :disabled="installing" @click="install(false)">
          {{ installing ? 'Restarting…' : 'Restart now' }}
        </button>
        <button class="update-btn dismiss-btn" @click="dismiss">Later</button>
      </div>
    </div>

    <!-- Downloading: informational only; there is nothing to click yet. -->
    <div v-else-if="view === 'downloading'" class="update-banner" data-testid="update-downloading">
      <div class="update-content">
        <div class="update-icon">⬇️</div>
        <div class="update-text">
          <span class="update-title">Downloading Update</span>
          <span class="update-version">v{{ state.available?.version }} · {{ state.percent ?? 0 }}%</span>
        </div>
      </div>
    </div>

    <!-- macOS: downloaded, but Squirrel is still unpacking and verifying it.
         Nothing to click yet; a restart now would install nothing. -->
    <div v-else-if="view === 'preparing'" class="update-banner" data-testid="update-preparing">
      <div class="update-content">
        <div class="update-icon">⬇️</div>
        <div class="update-text">
          <span class="update-title">Preparing Update</span>
          <span class="update-version">v{{ state.available?.version }} · almost ready</span>
        </div>
      </div>
    </div>

    <div v-else-if="view === 'installing'" class="update-banner" data-testid="update-installing">
      <div class="update-content">
        <div class="update-icon">⬇️</div>
        <div class="update-text">
          <span class="update-title">Installing v{{ state.available?.version }}</span>
          <span class="update-version">AGNT will restart</span>
        </div>
      </div>
    </div>

    <div v-else-if="view === 'error'" class="update-banner is-error" data-testid="update-error">
      <div class="update-content">
        <div class="update-icon">⚠️</div>
        <div class="update-text">
          <span class="update-title">Update failed</span>
          <span class="update-version">{{ state.error?.message }}</span>
        </div>
      </div>
      <div class="update-actions">
        <button class="update-btn download-btn" :disabled="retrying" @click="retry">{{ retrying ? 'Checking…' : 'Retry' }}</button>
        <button class="update-btn dismiss-btn" @click="dismiss">Later</button>
      </div>
    </div>

    <div v-else-if="view === 'installed'" class="update-banner" :class="{ 'is-error': !state.installed?.ok }" data-testid="update-installed">
      <div class="update-content">
        <div class="update-icon">{{ state.installed?.ok ? '✅' : '⚠️' }}</div>
        <div class="update-text">
          <span class="update-title">{{ state.installed?.ok ? `Updated to v${state.installed.to}` : 'The update did not install' }}</span>
          <span class="update-version">
            {{ state.installed?.ok ? `from v${state.installed.from}` : `Still running v${state.installed?.running}; v${state.installed?.to} will be offered again.` }}
          </span>
        </div>
      </div>
      <div class="update-actions">
        <button class="update-btn dismiss-btn" @click="dismiss">OK</button>
      </div>
    </div>

    <div v-else-if="view === 'notice'" class="update-banner" data-testid="update-notice">
      <div class="update-content">
        <div class="update-icon">🚀</div>
        <div class="update-text">
          <span class="update-title">Update Available</span>
          <span class="update-version"> v{{ currentVersion }} → v{{ updateInfo.latestVersion }} </span>
        </div>
      </div>
      <div class="update-actions">
        <button class="update-btn download-btn" @click="openDownloads">Download</button>
        <button class="update-btn dismiss-btn" @click="dismiss">Later</button>
      </div>
    </div>
  </Transition>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch, inject } from 'vue';

import { API_CONFIG } from '@/tt.config.js';
import { useElectron } from '@/composables/useElectron';

const { electron } = useElectron();
// Vuex's injection key. Optional: specs mount this without a store.
const store = inject('store', null);

// ── desktop self-update: main owns the state; this only renders it ─────────
const state = ref(null); // see preload.js autoUpdate.state()
const installing = ref(false);
const retrying = ref(false);
const dismissedKey = ref(null); // a dismissal hides THIS state, not future ones

// ── agnt.gg notice: browser, Docker, deb/rpm, dev ─────────────────────────
const updateInfo = ref(null);
const currentVersion = ref('');
const showNotice = ref(false);

const unsubscribers = [];

/** A key that changes whenever there is something new to say. */
function keyOf(s) {
  if (!s) return null;
  if (s.installed) return `installed:${s.installed.to}`;
  return `${s.phase}:${s.available?.version || ''}:${s.blocked?.reason || ''}:${s.error?.message || ''}`;
}

const selfUpdating = computed(() => !!state.value?.enabled);

// The version waiting to be installed, whichever path found it. This
// component is always mounted (App.vue), so it is the ONE writer of the
// toolbar's "update" pill. That used to be NewsPanel, which meant the pill
// only appeared after someone happened to open Settings.
const availableVersion = computed(() => {
  if (selfUpdating.value) return state.value?.available?.version || null;
  return updateInfo.value?.updateAvailable ? updateInfo.value.latestVersion || null : null;
});
watch(availableVersion, (version) => store?.dispatch('shell/setUpdateAvailable', version ? { version } : null), { immediate: true });

const view = computed(() => {
  const s = state.value;
  if (selfUpdating.value) {
    if (dismissedKey.value === keyOf(s)) return null;
    if (s.installed) return 'installed';
    if (s.phase === 'ready') return 'ready';
    if (s.phase === 'downloading') return 'downloading';
    if (s.phase === 'preparing') return 'preparing';
    if (s.phase === 'installing') return 'installing';
    if (s.phase === 'error') return 'error';
    return null;
  }
  return showNotice.value && updateInfo.value ? 'notice' : null;
});

const LABELS = { goals: ['goal', 'goals'], chats: ['chat', 'chats'], workflows: ['workflow', 'workflows'], tools: ['tool run', 'tool runs'] };

/** "2 goals, 1 chat still running" or "Can't tell what's running". */
const blockedText = computed(() => {
  const b = state.value?.blocked;
  if (!b) return '';
  if (b.reason === 'busy') {
    const parts = Object.entries(LABELS)
      .map(([k, [one, many]]) => [Number(b.busy?.[k]) || 0, one, many])
      .filter(([n]) => n > 0)
      .map(([n, one, many]) => `${n} ${n === 1 ? one : many}`);
    return `${parts.join(', ')} still running`;
  }
  return "Can't tell what's running";
});

function applyState(s) {
  const wasKey = keyOf(state.value);
  state.value = s;
  // New news clears an old dismissal; the same state stays dismissed.
  if (keyOf(s) !== wasKey && dismissedKey.value && dismissedKey.value !== keyOf(s)) dismissedKey.value = null;
  if (s?.phase !== 'installing') installing.value = false;
}

onMounted(async () => {
  if (electron?.autoUpdate) {
    unsubscribers.push(electron.autoUpdate.onState(applyState));
    try {
      applyState(await electron.autoUpdate.state());
    } catch (e) {
      console.log('[Update] auto-update state unavailable:', e?.message);
    }
    if (selfUpdating.value) return; // main handles everything from here
  }
  await checkNotice();
});

onUnmounted(() => {
  for (const off of unsubscribers) {
    try {
      off?.();
    } catch {
      /* listener already gone */
    }
  }
});

async function install(force) {
  if (!electron?.autoUpdate) return;
  installing.value = true;
  try {
    const r = await electron.autoUpdate.install({ force });
    // On refusal main has already set `blocked` in the state it pushed.
    if (!r?.ok) installing.value = false;
  } catch {
    installing.value = false;
  }
}

async function retry() {
  retrying.value = true;
  try {
    await electron?.autoUpdate?.check();
  } finally {
    retrying.value = false;
  }
}

async function checkNotice() {
  try {
    if (electron?.getAppVersion) {
      try {
        currentVersion.value = await electron.getAppVersion();
      } catch {
        /* fall through to the API */
      }
    }
    if (!currentVersion.value) {
      try {
        const data = await (await fetch(`${API_CONFIG.BASE_URL}/version`)).json();
        currentVersion.value = data.version;
      } catch (e) {
        console.error('[Update] Failed to get version from API:', e);
      }
    }

    let result = null;
    if (electron?.checkForUpdates) {
      try {
        result = await electron.checkForUpdates();
      } catch {
        result = null;
      }
    }
    if (!result || result.error) {
      try {
        result = await (await fetch(`${API_CONFIG.BASE_URL}/updates/check`)).json();
        if (result.currentVersion) currentVersion.value = result.currentVersion;
      } catch (e) {
        console.error('[Update] Failed to check local backend API:', e);
      }
    }
    if (result?.updateAvailable) {
      updateInfo.value = result;
      if (localStorage.getItem('agnt_dismissed_update') !== result.latestVersion) showNotice.value = true;
    }
  } catch (error) {
    console.error('[Update] Error checking for updates:', error);
  }
}

function openDownloads() {
  if (electron?.openDownloadPage) electron.openDownloadPage();
  else window.open('https://agnt.gg/downloads', '_blank');
  showNotice.value = false;
}

function dismiss() {
  if (selfUpdating.value) {
    // Later hides this banner; the download stays, and on macOS and AppImage it
    // still installs on the next quit.
    dismissedKey.value = keyOf(state.value);
    return;
  }
  showNotice.value = false;
  if (updateInfo.value?.latestVersion) localStorage.setItem('agnt_dismissed_update', updateInfo.value.latestVersion);
}

defineExpose({
  async checkNow() {
    if (selfUpdating.value) return electron.autoUpdate.check();
    await checkNotice();
    return updateInfo.value;
  },
});
</script>

<style scoped>
.update-banner {
  position: fixed;
  top: calc(50% - 100px);
  height: fit-content;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10000;
  display: flex;
  align-items: center;
  gap: 16px;
  max-width: min(640px, calc(100vw - 32px));
  background: linear-gradient(135deg, rgba(var(--green-rgb), 0.15) 0%, rgba(var(--green-rgb), 0.05) 100%);
  border: 1px solid rgba(var(--green-rgb), 0.4);
  border-radius: 12px;
  padding: 12px 16px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(12px);
}

.update-banner.is-error {
  background: linear-gradient(135deg, rgba(var(--red-rgb, 254, 78, 78), 0.15) 0%, rgba(var(--red-rgb, 254, 78, 78), 0.05) 100%);
  border-color: rgba(var(--red-rgb, 254, 78, 78), 0.45);
}

.update-content {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.update-icon {
  font-size: 24px;
}

.update-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.update-title {
  font-family: var(--font-family-primary);
  font-size: 14px;
  font-weight: 600;
  color: var(--color-green, #19ef83);
}

.is-error .update-title {
  color: var(--color-red, #fe4e4e);
}

.update-version {
  font-family: var(--font-family-mono);
  font-size: 12px;
  color: var(--fg-dim, rgba(255, 255, 255, 0.6));
  overflow-wrap: anywhere;
}

.update-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.update-btn {
  font-family: var(--font-family-mono);
  font-size: 12px;
  font-weight: 500;
  padding: 6px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
  border: none;
}

.download-btn {
  background: var(--color-green, #19ef83);
  color: var(--on-fill-success);
}

.download-btn:hover {
  background: #14d974;
  transform: translateY(-1px);
}

.download-btn:disabled,
.download-btn:disabled:hover {
  opacity: 0.6;
  cursor: default;
  transform: none;
  background: var(--color-green, #19ef83);
}

.dismiss-btn {
  background: transparent;
  color: var(--fg-dim, rgba(255, 255, 255, 0.6));
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.dismiss-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--fg, #fff);
}

/* Transition animations */
.slide-down-enter-active,
.slide-down-leave-active {
  transition: all 0.3s ease;
}

.slide-down-enter-from {
  opacity: 0;
  transform: translateX(-50%) translateY(-20px);
}

.slide-down-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-20px);
}
</style>
