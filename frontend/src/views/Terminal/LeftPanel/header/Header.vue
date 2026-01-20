<template>
  <div class="header-bar" :class="{ collapsed: isCollapsed }">
    <div class="header-layout">
      <div class="nav-links">
        <slot name="nav-links"></slot>
      </div>
      <!-- <div class="header-content-wrapper">
        <transition name="fade">
          <div v-if="!isCollapsed" class="header-content">
            <div class="progress-bar-container">
              <div class="progress-bar">
                <div class="progress-fill" :style="{ width: `${gameProgress}%` }">
                  <p class="progress-text">{{ gameProgressLabel }}</p>
                </div>
              </div>
            </div>
            <div class="stats-container">
              <div class="stats-row">
                <div class="stats-item">
                  <span>XP ⭐ 69,420</span>
                </div>
                <div class="stats-item">
                  <span>LEVEL 🔧 4: Agent Wrangler</span>
                </div>
              </div>
              <div class="stats-row">
                <div class="stats-item">
                  <span>TOKENS 💰 {{ formattedTokens }}</span>
                </div>
                <div class="stats-item">
                  <span>TOOLS 🛠️ {{ stats?.totalCustomTools || 0 }}</span>
                </div>
              </div>
              <div class="stats-row">
                <div class="stats-item">
                  <span>WORKFLOWS 📋 {{ stats?.totalWorkflows || 0 }}</span>
                </div>
                <div class="stats-item">
                  <span>POLIS 🏰 "The Loopers"</span>
                </div>
              </div>
            </div>
          </div>
        </transition>
        <div class="header-controls">
          <transition name="fade">
            <div v-if="!isCollapsed" class="header-song-player">
              <SongPlayerController />
            </div>
          </transition>
          <div class="mini-progress" v-if="isCollapsed">
            <div class="mini-progress-fill" :style="{ width: `${gameProgress}%` }"></div>
            <div class="mini-stats">
              <span>💰{{ formattedTokens }}</span>
              <span>🔧4</span>
              <span>⭐69k</span>
            </div>
          </div>
          <button @click="toggleCollapse" class="collapse-toggle" :title="isCollapsed ? 'Expand header' : 'Collapse header'">
            <span class="toggle-icon">{{ isCollapsed ? '↓' : '↑' }}</span>
          </button>
        </div>
      </div> -->
    </div>
  </div>
</template>

<script>
import { computed, ref } from 'vue';
import { useStore } from 'vuex';
import SongPlayerController from '@/views/Terminal/_components/SongPlayerController.vue';

export default {
  name: 'Header',
  components: { SongPlayerController },
  props: {
    stats: {
      type: Object,
      required: true,
      default: () => ({ totalCustomTools: 0, totalWorkflows: 0 }),
    },
    formattedTokens: {
      type: String,
      required: true,
      default: '0',
    },
  },
  setup() {
    const store = useStore();
    const isCollapsed = ref(false);

    const toggleCollapse = () => {
      isCollapsed.value = !isCollapsed.value;
      // Store preference in localStorage
      localStorage.setItem('header-collapsed', isCollapsed.value);
    };

    // Load collapse state from localStorage on initialization
    if (typeof window !== 'undefined') {
      const savedState = localStorage.getItem('header-collapsed');
      if (savedState !== null) {
        isCollapsed.value = savedState === 'true';
      }
    }

    const gameProgress = computed(() => store.getters['userStats/gameProgress']);
    const gameProgressLabel = computed(() => {
      const progress = gameProgress.value;
      return `System Recovery Progress: ${progress}%`;
    });

    return {
      gameProgress,
      gameProgressLabel,
      isCollapsed,
      toggleCollapse,
    };
  },
};
</script>

<style scoped>
.header-bar {
  /* border: 1px solid var(--terminal-border-color); */
  /* border-radius: 0 8px 0 0; */
  /* background: var(--terminal-darken-color); */
  /* padding: 16px; */
  flex-shrink: 0;
  position: relative;
  z-index: 3;
  transition: all 0.3s ease;
}

.header-content {
  color: var(--color-text);
  font-weight: var(--font-weight);
}

.header-bar.collapsed {
  padding: 0;
  border: none;
}

.header-layout {
  display: flex;
  gap: 16px;
  flex-direction: column;
}

.nav-links {
  display: flex;
  width: 100%;
  flex-shrink: 0;
  position: relative;
  z-index: 3;
  flex-direction: column;
  flex-wrap: nowrap;
  align-content: flex-start;
  justify-content: flex-start;
  align-items: flex-end;
  gap: 4px;
}

.stats-container {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
}

.stats-row {
  display: flex;
  justify-content: space-between;
  width: 100%;
}

.stats-item {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight);
  white-space: nowrap;
}

/* Progress Bar Styles */
.progress-bar-container {
  width: 100%;
  margin-bottom: 8px;
}

.progress-bar {
  width: 100%;
  height: fit-content;
  background: var(--terminal-darken-color);
  border: 1px solid var(--terminal-border-color);
  border-radius: 0px;
  overflow: hidden;
  position: relative;
}

.progress-fill {
  height: 100%;
  background: var(--color-primary);
  transition: width 0.5s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  /* box-shadow: 0 0 15px var(--terminal-border-color); */
  padding: 0;
}

.progress-text {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  padding: 2px 8px 0px;
  width: 100%;
  text-align: center;
  z-index: 2;
  text-wrap-mode: nowrap;
  margin-left: 32px;
  margin-bottom: 0;
}

body.dark.cyberpunk .mini-stats {
  padding: 0px 8px 0px;
}

.header-song-player {
  display: flex;
  align-items: center;
  width: 100%;
  margin-right: -46px;
}

.header-content-wrapper {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  justify-content: space-between;
}

/* Collapse/Expand Controls */
.collapse-toggle {
  background: var(--terminal-darken-color);
  border: 1px solid var(--terminal-border-color);
  /* border-radius: 4px; */
  color: var(--color-primary);
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
  padding: 0;
  margin-left: 8px;
}

.collapse-toggle:hover {
  opacity: 0.5;
}

.toggle-icon {
  font-size: 12px;
  line-height: 1;
}

/* Mini Display for Collapsed State */
.header-controls {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  flex-direction: row;
}

.mini-progress {
  height: 22px;
  width: 100%;
  /* flex: 1; */
  background: var(--terminal-darken-color);
  border: 1px solid var(--terminal-border-color);
  border-radius: 0px;
  overflow: hidden;
  position: relative;
}

.mini-progress-fill {
  position: absolute;
  height: 100%;
  width: 100%;
  top: 0;
  left: 0;
  background: var(--color-primary);
}

.mini-stats {
  position: relative;
  z-index: 2;
  display: flex;
  height: 100%;
  width: 100%;
  align-items: center;
  justify-content: space-around;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight);
  padding: 1px 0;
}

body.dark.cyberpunk .mini-stats {
  padding: 0;
}

/* Transitions */
.fade-enter-active,
.fade-leave-active {
  max-height: 500px;
  overflow: hidden;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  max-height: 0;
}
</style>
