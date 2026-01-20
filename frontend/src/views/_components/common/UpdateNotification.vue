<template>
  <Transition name="slide-down">
    <div v-if="showBanner && updateInfo" class="update-banner">
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

// Check for updates on mount
onMounted(async () => {
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
  background: linear-gradient(135deg, rgba(25, 239, 131, 0.15) 0%, rgba(25, 239, 131, 0.05) 100%);
  border: 1px solid rgba(25, 239, 131, 0.4);
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
  font-family: 'League Spartan', sans-serif;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-green, #19ef83);
}

.update-version {
  font-family: 'Fira Code', monospace;
  font-size: 12px;
  color: var(--fg-dim, rgba(255, 255, 255, 0.6));
}

.update-actions {
  display: flex;
  gap: 8px;
}

.update-btn {
  font-family: 'Fira Code', monospace;
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
  color: #070710;
}

.download-btn:hover {
  background: #14d974;
  transform: translateY(-1px);
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
