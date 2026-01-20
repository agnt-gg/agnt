<template>
  <div class="news-panel">
    <div class="panel-header">
      <h3 class="panel-title">
        <i class="fas fa-newspaper"></i>
        AGNT News & Updates
      </h3>
    </div>

    <div class="news-content">
      <!-- Version & Update Check Section -->
      <div class="news-section version-section">
        <div class="version-card" :class="{ 'has-update': updateAvailable }">
          <div class="version-info">
            <div class="version-label">Current Version</div>
            <div class="version-number">v{{ appVersion || '...' }}</div>
          </div>
          <div v-if="checkingUpdate" class="update-status checking">
            <i class="fas fa-spinner fa-spin"></i>
            <span>Checking...</span>
          </div>
          <div v-else-if="updateAvailable" class="update-status available">
            <div class="update-badge">
              <i class="fas fa-arrow-up"></i>
              v{{ latestVersion }} Available
            </div>
            <button class="update-btn" @click="openDownloads">
              <i class="fas fa-download"></i>
              Download
            </button>
          </div>
          <div v-else class="update-status current">
            <i class="fas fa-check-circle"></i>
            <span>Up to date</span>
          </div>
          <button class="check-btn" @click="checkForUpdates" :disabled="checkingUpdate">
            <i class="fas fa-sync-alt" :class="{ 'fa-spin': checkingUpdate }"></i>
          </button>
        </div>
      </div>

      <!-- Latest News Section -->
      <div class="news-section">
        <h4 class="section-title">Latest Updates</h4>

        <div class="news-item featured">
          <!-- <div class="news-date">November 2025</div> -->
          <h5 class="news-title">🚀 Major Platform Update</h5>
          <h4 class="news-title">AGNT v{{ appVersion || '...' }}</h4>
          <ul class="news-list">
            <li>Plugin System <span style="color: var(--color-primary)">[New]</span></li>
            <li>Plugin Marketplace <span style="color: var(--color-primary)">[New]</span></li>
            <li>Share Creation Links <span style="color: var(--color-primary)">[New]</span></li>
          </ul>
          <div class="news-tags">
            <span class="tag">Backwards Compatable Release</span>
          </div>
        </div>
      </div>

      <!-- Coming Soon Section -->
      <div class="news-section">
        <h4 class="section-title">Coming Soon</h4>

        <div class="roadmap-item">
          <div class="roadmap-status in-progress">In Progress</div>
          <ul class="news-list">
            <li>AGNT RTS Game Layer</li>
            <li>$AGNT Holder Game Perks</li>
          </ul>
        </div>
      </div>

      <!-- Resources Section -->
      <ResourcesSection />
    </div>
  </div>
</template>

<script>
import { ref, onMounted } from 'vue';
import ResourcesSection from '@/views/_components/common/ResourcesSection.vue';
import { useAppVersion } from '@/composables/useAppVersion.js';
import { API_CONFIG } from '@/tt.config.js';

export default {
  name: 'NewsPanel',
  components: {
    ResourcesSection,
  },
  setup() {
    // Use shared composable for app version
    const { appVersion, fetchVersion } = useAppVersion();

    const latestVersion = ref('');
    const updateAvailable = ref(false);
    const checkingUpdate = ref(false);

    const checkForUpdates = async () => {
      checkingUpdate.value = true;

      try {
        // Try Electron API first
        if (window.electron?.checkForUpdates) {
          const result = await window.electron.checkForUpdates();

          if (!result.error) {
            updateAvailable.value = result.updateAvailable;
            latestVersion.value = result.latestVersion;
            return;
          }
          console.log('[NewsPanel] Electron check failed, trying local backend API');
        }

        // Fallback: Call local backend which proxies to agnt.gg
        const response = await fetch(`${API_CONFIG.BASE_URL}/updates/check`);
        const data = await response.json();

        if (data.updateAvailable !== undefined) {
          updateAvailable.value = data.updateAvailable;
          latestVersion.value = data.latestVersion;
        }
      } catch (error) {
        console.error('[NewsPanel] Error checking for updates:', error);
      } finally {
        checkingUpdate.value = false;
      }
    };

    const openDownloads = () => {
      if (window.electron?.openDownloadPage) {
        window.electron.openDownloadPage();
      } else {
        window.open('https://agnt.gg/downloads', '_blank');
      }
    };

    onMounted(async () => {
      // Fetch version using shared composable
      await fetchVersion();

      // Check for updates on mount
      await checkForUpdates();
    });

    return {
      appVersion,
      latestVersion,
      updateAvailable,
      checkingUpdate,
      checkForUpdates,
      openDownloads,
    };
  },
};
</script>

<style scoped>
.news-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.panel-header {
  padding: 0 0 16px 0;
  border-bottom: 1px solid var(--terminal-border-color);
  margin-bottom: 16px;
}

.panel-title {
  margin: 0;
  font-size: 1.2em;
  font-weight: 600;
  color: var(--color-text);
  display: flex;
  align-items: center;
  gap: 8px;
}

.panel-title i {
  color: var(--color-green);
}

.news-content {
  flex: 1;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(127, 129, 147, 0.2) transparent;
  display: flex;
  flex-direction: column;
}

.news-content::-webkit-scrollbar {
  width: 6px;
}

.news-content::-webkit-scrollbar-track {
  background: transparent;
}

.news-content::-webkit-scrollbar-thumb {
  background: var(--color-darker-0);
  border-radius: 3px;
}

.news-section {
  margin-bottom: 16px;
}

.news-section:last-child {
  margin-bottom: 0;
  margin-top: auto;
}

.section-title {
  font-size: 1em;
  font-weight: 600;
  color: var(--color-light-med-navy);
  margin: 0 0 16px 0;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* News Items */
.news-item {
  background: var(--color-dull-white);
  border: 1px solid var(--color-light-navy);
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 12px;
  transition: all 0.2s ease;
}

body.dark .news-item,
body.dark .version-card {
  background: rgba(0, 0, 0, 10%);
  border: 1px solid var(--terminal-border-color);
}

.news-item:hover {
  border-color: var(--color-green);
}

.news-item.featured {
  border-color: var(--color-green);
  background: rgba(25, 239, 131, 0.05);
}

.news-date {
  font-size: 0.75em;
  color: var(--color-light-med-navy);
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.news-title {
  font-size: 1em;
  font-weight: 600;
  color: var(--color-text);
  margin: 0 0 8px 0;
}

.news-description {
  font-size: 0.9em;
  color: var(--color-light-med-navy);
  line-height: 1.5;
  margin: 0 0 12px 0;
}

.news-list {
  font-size: 0.9em;
  color: var(--color-light-med-navy);
  line-height: 1.6;
  margin: 0 0 12px 0;
  padding-left: 20px;
}

.news-list li {
  margin-bottom: 4px;
}

.news-tags {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.tag {
  font-size: 0.75em;
  padding: 4px 8px;
  border-radius: 4px;
  background: rgba(25, 239, 131, 0.1);
  color: var(--color-green);
  font-weight: 500;
}

/* Feature Items */
.feature-item {
  display: flex;
  gap: 12px;
  padding: 12px;
  background: var(--color-dull-white);
  border: 1px solid var(--color-light-navy);
  border-radius: 8px;
  margin-bottom: 8px;
  transition: all 0.2s ease;
}

body.dark .feature-item {
  background: rgba(0, 0, 0, 10%);
  border: 1px solid var(--terminal-border-color);
}

.feature-item:hover {
  border-color: var(--color-green);
  transform: translateX(4px);
}

.feature-icon {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(25, 239, 131, 0.1);
  border-radius: 8px;
  color: var(--color-green);
  font-size: 1.2em;
}

.feature-content h5 {
  font-size: 0.95em;
  font-weight: 600;
  color: var(--color-text);
  margin: 0 0 4px 0;
}

.feature-content p {
  font-size: 0.85em;
  color: var(--color-light-med-navy);
  margin: 0;
  line-height: 1.4;
}

/* Roadmap Items */
.roadmap-item {
  padding: 12px;
  background: var(--color-dull-white);
  border: 1px solid var(--color-light-navy);
  border-radius: 8px;
  margin-bottom: 8px;
}

body.dark .roadmap-item {
  background: rgba(0, 0, 0, 10%);
  border: 1px solid var(--terminal-border-color);
}

.roadmap-status {
  display: inline-block;
  font-size: 0.75em;
  padding: 4px 8px;
  border-radius: 4px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
}

.roadmap-status.in-progress {
  background: rgba(59, 130, 246, 0.2);
  color: #3b82f6;
}

.roadmap-status.planned {
  background: rgba(168, 85, 247, 0.2);
  color: #a855f7;
}

.roadmap-item h5 {
  font-size: 0.95em;
  font-weight: 600;
  color: var(--color-text);
  margin: 0 0 4px 0;
}

.roadmap-item p {
  font-size: 0.85em;
  color: var(--color-light-med-navy);
  margin: 0;
  line-height: 1.4;
}

/* Version Card Styles */
.version-section {
  margin-bottom: 24px;
}

.version-card {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 16px;
  transition: all 0.2s ease;
}

.version-card.has-update {
  border-color: var(--color-green);
  background: rgba(25, 239, 131, 0.05);
}

.version-info {
  flex-shrink: 0;
}

.version-label {
  font-size: 0.7em;
  color: var(--color-light-med-navy);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 2px;
}

.version-number {
  font-family: 'Fira Code', monospace;
  font-weight: 600;
  color: var(--color-text);
}

.update-status {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.85em;
}

.update-status.checking {
  color: var(--color-light-med-navy);
}

.update-status.checking i {
  color: var(--color-blue);
}

.update-status.current {
  color: var(--color-green);
}

.update-status.current i {
  font-size: 1.1em;
}

.update-status.available {
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
}

.update-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.85em;
  font-weight: 600;
  color: var(--color-green);
}

.update-badge i {
  font-size: 0.9em;
}

.update-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: var(--color-green);
  color: #070710;
  border: none;
  border-radius: 6px;
  font-size: 0.8em;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.update-btn:hover {
  background: #14d974;
  transform: translateY(-1px);
}

.update-btn i {
  font-size: 0.9em;
}

.check-btn {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid var(--color-light-navy);
  border-radius: 6px;
  color: var(--color-light-med-navy);
  cursor: pointer;
  transition: all 0.2s ease;
}

body.dark .check-btn {
  border-color: var(--terminal-border-color);
}

.check-btn:hover:not(:disabled) {
  border-color: var(--color-green);
  color: var(--color-green);
}

.check-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
