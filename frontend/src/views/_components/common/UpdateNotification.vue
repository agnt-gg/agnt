<template>
  <Transition name="slide-down">
    <!--
      READY beats AVAILABLE. When the desktop updater has already downloaded the
      new version, offering "Download" would send the user to a browser to fetch
      a file that is sitting on their disk.
    -->
    <div v-if="readyToInstall" class="update-banner">
      <div class="update-content">
        <div class="update-icon">⬇️</div>
        <div class="update-text">
          <span class="update-title">Update Ready</span>
          <span class="update-version">
            <template v-if="installBlocked">
              {{ installBlocked.goals }} goal{{ installBlocked.goals === 1 ? '' : 's' }} still running — finish, then restart
            </template>
            <template v-else> v{{ currentVersion }} → v{{ readyToInstall.version }} </template>
          </span>
        </div>
      </div>
      <div class="update-actions">
        <button class="update-btn download-btn" :disabled="installing" @click="restartToUpdate">
          {{ installing ? 'Restarting…' : 'Restart to update' }}
        </button>
        <button class="update-btn dismiss-btn" @click="dismiss">Later</button>
      </div>
    </div>

    <!-- Downloading: informational only. There is nothing to click yet, and a
         live button before the file exists is a button that fails. -->
    <div v-else-if="downloadPercent !== null" class="update-banner">
      <div class="update-content">
        <div class="update-icon">⬇️</div>
        <div class="update-text">
          <span class="update-title">Downloading Update</span>
          <span class="update-version">{{ downloadPercent }}%</span>
        </div>
      </div>
    </div>

    <div v-else-if="showBanner && updateInfo" class="update-banner">
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
import { ref, onMounted, onUnmounted } from 'vue';

import { API_CONFIG } from '@/tt.config.js';
import { useElectron } from '@/composables/useElectron';

const { electron } = useElectron();

const showBanner = ref(false);
const updateInfo = ref(null);
const currentVersion = ref('');
const dismissed = ref(false);

// ── desktop auto-update ────────────────────────────────────────────────
// On macOS and Linux the update installs itself when the app is quit, so the
// only thing worth saying is that it is ready. On Windows there is no
// code-signing certificate, so installing raises SmartScreen and needs a
// deliberate click — the file is already downloaded, so that click is a restart
// and not a download.
const readyToInstall = ref(null); // { version, needsExplicitInstall }
const downloadPercent = ref(null);
const installBlocked = ref(null); // { goals }
const installing = ref(false);
const unsubscribers = [];

// Check for updates on mount
onMounted(async () => {
  // FIRST, and deliberately so. The version-check block below returns early on
  // its success path — so registering these at the end of onMounted meant they
  // were never registered whenever agnt.gg reported an update available, which
  // is precisely the run in which an update then downloads and needs to be
  // announced. Nothing here depends on the version lookup.
  //
  // Feature-detected: browser and Docker users have no Electron bridge and keep
  // the download banner.
  if (electron?.autoUpdate) {
    unsubscribers.push(
      electron.autoUpdate.onProgress(({ percent }) => {
        if (!readyToInstall.value) downloadPercent.value = percent;
      }),
    );
    unsubscribers.push(
      electron.autoUpdate.onDownloaded((info) => {
        downloadPercent.value = null;
        readyToInstall.value = info;
        // Worth surfacing even if the user dismissed the earlier "available"
        // banner: what they dismissed was a chore, and this is a finished one.
        dismissed.value = false;
      }),
    );
  }

  try {
    // Get current version - try Electron first, then fallback to API
    if (electron?.getAppVersion) {
      try {
        currentVersion.value = await electron.getAppVersion();
      } catch (e) {
        console.log('[Update] Electron getAppVersion failed, trying API');
      }
    }

    // Fallback to API if Electron didn't work
    if (!currentVersion.value) {
      try {
        const response = await fetch(`${API_CONFIG.BASE_URL}/version`);
        const data = await response.json();
        currentVersion.value = data.version;
      } catch (e) {
        console.error('[Update] Failed to get version from API:', e);
      }
    }

    console.log(`[Update] Current version: ${currentVersion.value}`);

    // Check for updates via Electron if available
    if (electron?.checkForUpdates) {
      try {
        const result = await electron.checkForUpdates();

        if (!result.error && result.updateAvailable) {
          updateInfo.value = result;

          // Check if user dismissed this version before
          const dismissedVersion = localStorage.getItem('agnt_dismissed_update');
          if (dismissedVersion !== result.latestVersion) {
            showBanner.value = true;
          }
          return; // Success, no need for fallback
        }
      } catch (e) {
        console.log('[Update] Electron check failed, trying agnt.gg API');
      }
    }

    // Fallback: Call local backend which proxies to agnt.gg
    try {
      const response = await fetch(`${API_CONFIG.BASE_URL}/updates/check`);
      const data = await response.json();

      if (data.updateAvailable) {
        updateInfo.value = data;
        if (data.currentVersion) {
          currentVersion.value = data.currentVersion;
        }

        // Check if user dismissed this version before
        const dismissedVersion = localStorage.getItem('agnt_dismissed_update');
        if (dismissedVersion !== data.latestVersion) {
          showBanner.value = true;
        }
      }
    } catch (e) {
      console.error('[Update] Failed to check local backend API:', e);
    }
  } catch (error) {
    console.error('[Update] Error checking for updates:', error);
  }

  // Listen for update notifications from main process
  if (electron?.onUpdateAvailable) {
    electron.onUpdateAvailable((info) => {
      updateInfo.value = info;
      if (!dismissed.value) {
        showBanner.value = true;
      }
    });
  }

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

async function restartToUpdate() {
  if (!electron?.autoUpdate) return;
  installing.value = true;
  installBlocked.value = null;
  try {
    const r = await electron.autoUpdate.install();
    if (!r?.ok) {
      // The refusal the user can act on: work is running. Anything else is a
      // state they cannot fix from here, so the banner simply stays put.
      if (r?.reason === 'goal-running') installBlocked.value = { goals: r.goals };
      installing.value = false;
    }
    // On success the app is already quitting; leaving `installing` true keeps
    // the button from being pressed twice during the teardown.
  } catch {
    installing.value = false;
  }
}

function openDownloads() {
  if (electron?.openDownloadPage) {
    electron.openDownloadPage();
  } else {
    // Fallback for browser
    window.open('https://agnt.gg/downloads', '_blank');
  }
  showBanner.value = false;
}

function dismiss() {
  showBanner.value = false;
  dismissed.value = true;
  // Dismissing a ready update keeps it downloaded; on macOS and Linux it still
  // installs on the next quit, and on Windows the banner returns next launch.
  readyToInstall.value = null;
  installBlocked.value = null;

  // Remember dismissed version
  if (updateInfo.value?.latestVersion) {
    localStorage.setItem('agnt_dismissed_update', updateInfo.value.latestVersion);
  }
}

// Expose method to manually trigger update check
defineExpose({
  async checkNow() {
    if (!electron?.checkForUpdates) return null;

    const result = await electron.checkForUpdates();
    if (result.updateAvailable) {
      updateInfo.value = result;
      showBanner.value = true;
    }
    return result;
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
  background: linear-gradient(135deg, rgba(var(--green-rgb), 0.15) 0%, rgba(var(--green-rgb), 0.05) 100%);
  border: 1px solid rgba(var(--green-rgb), 0.4);
  border-radius: 12px;
  padding: 12px 16px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(12px);
}

.update-content {
  display: flex;
  align-items: center;
  gap: 12px;
}

.update-icon {
  font-size: 24px;
}

.update-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.update-title {
  font-family: var(--font-family-primary);
  font-size: 14px;
  font-weight: 600;
  color: var(--color-green, #19ef83);
}

.update-version {
  font-family: var(--font-family-mono);
  font-size: 12px;
  color: var(--fg-dim, rgba(255, 255, 255, 0.6));
}

.update-actions {
  display: flex;
  gap: 8px;
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
