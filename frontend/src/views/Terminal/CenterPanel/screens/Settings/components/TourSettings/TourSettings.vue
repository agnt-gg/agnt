<template>
  <div class="tour-settings">
    <div class="setting-group">
      <h3>Tour Preferences</h3>
      <p class="description">Control how and when interactive tours are displayed</p>

      <div class="setting-row">
        <div class="setting-info">
          <label class="setting-label">Enable Tours</label>
          <p class="setting-description">Show interactive tutorials and guided tours throughout the application</p>
        </div>
        <div class="setting-control">
          <label class="toggle-switch">
            <input type="checkbox" v-model="toursEnabled" @change="saveSettings" />
            <span class="slider"></span>
          </label>
        </div>
      </div>

      <div class="setting-row" v-if="toursEnabled">
        <div class="setting-info">
          <label class="setting-label">Auto-start Tours</label>
          <p class="setting-description">Automatically start tours when visiting new sections for the first time</p>
        </div>
        <div class="setting-control">
          <label class="toggle-switch">
            <input type="checkbox" v-model="autoStartTours" @change="saveSettings" />
            <span class="slider"></span>
          </label>
        </div>
      </div>
    </div>

    <div class="setting-group" v-if="toursEnabled">
      <h3>Tour Management</h3>
      <p class="description">Reset or manage individual tours</p>

      <div class="tour-list">
        <div v-for="tour in availableTours" :key="tour.id" class="tour-item">
          <div class="tour-item-info">
            <div class="tour-item-header">
              <span class="tour-name">{{ tour.name }}</span>
              <span class="tour-status" :class="{ completed: isTourCompleted(tour.id) }">
                {{ isTourCompleted(tour.id) ? '✓ Completed' : 'Not Started' }}
              </span>
            </div>
            <p class="tour-description">{{ tour.description }}</p>
          </div>
          <div class="tour-item-actions">
            <Tooltip v-if="isTourCompleted(tour.id)" text="Reset this tour" width="auto">
              <button @click="resetTour(tour.id)" class="btn-reset">Reset</button>
            </Tooltip>
            <Tooltip v-else text="Start this tour" width="auto">
              <button @click="startTour(tour.id)" class="btn-start">Start</button>
            </Tooltip>
          </div>
        </div>
      </div>

      <div class="bulk-actions">
        <button @click="resetAllTours" class="btn-reset-all">Reset All Tours</button>
      </div>
    </div>

    <SimpleModal ref="modal" />

    <div class="setting-group info-section">
      <h3>About Tours</h3>
      <p class="info-text">
        Tours provide interactive guidance to help you learn and navigate the application. You can enable or disable them at any time, and reset
        individual tours to see them again.
      </p>
    </div>
  </div>
</template>

<script>
import { ref, onMounted, computed, watch, inject } from 'vue';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';

export default {
  name: 'TourSettings',
  components: {
    SimpleModal,
    Tooltip,
  },
  emits: ['start-tour'],
  setup(props, { emit }) {
    const modal = ref(null);
    const toursEnabled = ref(true);
    const autoStartTours = ref(true);
    const hasShownCelebration = ref(false);
    const isResetting = ref(false);
    const playSound = inject('playSound', () => {});
    const availableTours = ref([
      {
        id: 'AgentForgeScreen',
        name: 'Agent Builder Tour',
        description: 'Learn how to create and configure custom AI agents',
        screen: 'AgentForgeScreen',
      },
      {
        id: 'AgentsScreen',
        name: 'Agent Assets Tour',
        description: 'Discover how to configure and manage AI agents',
        screen: 'AgentsScreen',
      },
      {
        id: 'secrets',
        name: 'App Connections Tour',
        description: 'Learn how to navigate and configure your app integrations',
        screen: 'ConnectorsScreen',
      },
      {
        id: 'ChatScreen',
        name: 'Chat Page Tour',
        description: 'Discover how to interact with AI agents in chat',
        screen: 'ChatScreen',
      },
      {
        id: 'dashboard',
        name: 'Dashboard Page Tour',
        description: 'Learn to navigate and use the dashboard',
        screen: 'DashboardScreen',
      },
      {
        id: 'MarketplaceScreen',
        name: 'Marketplace Tour',
        description: 'Discover how to browse, install, and publish workflows, agents, and tools',
        screen: 'MarketplaceScreen',
      },
      {
        id: 'onboarding',
        name: 'First-Time Onboarding',
        description: 'Complete onboarding wizard for new users',
        screen: null, // Special case - triggers modal instead of screen navigation
        isOnboarding: true,
      },
      {
        id: 'runs',
        name: 'Runs List Tour',
        description: 'Learn to track and manage workflow executions',
        screen: 'RunsScreen',
      },
      {
        id: 'SettingsScreen',
        name: 'Settings Tour',
        description: 'Learn to navigate and customize your AGNT settings',
        screen: 'SettingsScreen',
      },
      {
        id: 'toolForge',
        name: 'Tool Forge Tour',
        description: 'Discover how to create custom tools for workflows and agents',
        screen: 'ToolForgeScreen',
      },
      {
        id: 'ToolsScreen',
        name: 'Tool Assets Tour',
        description: 'Explore system and custom tools available for your workflows',
        screen: 'ToolsScreen',
      },
      {
        id: 'workflowDesigner',
        name: 'Workflow Canvas Tour',
        description: 'Master the workflow designer and automation tools',
        screen: 'WorkflowForgeScreen',
      },
      {
        id: 'WorkflowsScreen',
        name: 'Workflow Assets Tour',
        description: 'Learn to create, organize, and manage your automation workflows',
        screen: 'WorkflowsScreen',
      },
    ]);

    const loadSettings = () => {
      const savedToursEnabled = localStorage.getItem('tours_enabled');
      const savedAutoStart = localStorage.getItem('tours_auto_start');
      const savedCelebration = localStorage.getItem('tours_celebration_shown');

      if (savedToursEnabled !== null) {
        toursEnabled.value = savedToursEnabled === 'true';
      }
      if (savedAutoStart !== null) {
        autoStartTours.value = savedAutoStart === 'true';
      }
      if (savedCelebration !== null) {
        hasShownCelebration.value = savedCelebration === 'true';
      }
    };

    const saveSettings = () => {
      localStorage.setItem('tours_enabled', toursEnabled.value.toString());
      localStorage.setItem('tours_auto_start', autoStartTours.value.toString());
    };

    const isTourCompleted = (tourId) => {
      // Special case for onboarding
      if (tourId === 'onboarding') {
        return localStorage.getItem('hasCompletedOnboarding') === 'true';
      }

      const completedSteps = localStorage.getItem(`tutorial_${tourId}`);
      return completedSteps !== null && completedSteps !== '[]';
    };

    const resetTour = (tourId) => {
      console.log(`Resetting tour: ${tourId}`);
      isResetting.value = true;

      // Special case for onboarding
      if (tourId === 'onboarding') {
        localStorage.removeItem('hasCompletedOnboarding');
        console.log('Removed hasCompletedOnboarding from localStorage');
      } else {
        localStorage.removeItem(`tutorial_${tourId}`);
        console.log(`Removed tutorial_${tourId} from localStorage`);
      }

      // Reset celebration flag so it can be shown again when tours are completed
      localStorage.removeItem('tours_celebration_shown');
      hasShownCelebration.value = false;

      // Force component re-render by creating a new array reference
      const currentTours = availableTours.value;
      availableTours.value = [];
      setTimeout(() => {
        availableTours.value = currentTours;
        isResetting.value = false;
      }, 0);
    };

    const startTour = (tourId) => {
      console.log(`Starting tour: ${tourId}`);

      // Find the tour configuration
      const tour = availableTours.value.find((t) => t.id === tourId);
      if (!tour) {
        console.error(`Tour not found: ${tourId}`);
        return;
      }

      // Special case for onboarding
      if (tourId === 'onboarding') {
        // Clear onboarding completion flag
        localStorage.removeItem('hasCompletedOnboarding');
        console.log('Cleared hasCompletedOnboarding from localStorage');

        // Reload the page to trigger onboarding modal
        window.location.reload();
        return;
      }

      // Enable tours if they're disabled
      if (!toursEnabled.value) {
        toursEnabled.value = true;
        localStorage.setItem('tours_enabled', 'true');
        console.log('Enabled tours');
      }

      // Enable auto-start tours
      if (!autoStartTours.value) {
        autoStartTours.value = true;
        localStorage.setItem('tours_auto_start', 'true');
        console.log('Enabled auto-start tours');
      }

      // Clear the tour's localStorage to ensure it shows
      localStorage.removeItem(`tutorial_${tourId}`);
      console.log(`Cleared tutorial_${tourId} from localStorage`);

      // Emit event to navigate to the tour's screen
      emit('start-tour', { tourId, screen: tour.screen });

      // Force component re-render
      const currentTours = availableTours.value;
      availableTours.value = [];
      setTimeout(() => {
        availableTours.value = currentTours;
      }, 0);
    };

    const resetAllTours = async () => {
      const confirmed = await modal.value.showModal({
        title: 'Reset All Tours',
        message: 'Are you sure you want to reset all tours? <br/>This will allow you to see all tutorials again.',
        confirmText: 'Reset All',
        cancelText: 'Cancel',
        showCancel: true,
        confirmClass: 'btn-danger',
      });

      if (confirmed) {
        console.log('Resetting all tours...');
        isResetting.value = true;

        // Reset tours from the availableTours list
        availableTours.value.forEach((tour) => {
          if (tour.id === 'onboarding') {
            localStorage.removeItem('hasCompletedOnboarding');
            console.log('Removed hasCompletedOnboarding from localStorage');
          } else {
            localStorage.removeItem(`tutorial_${tour.id}`);
            console.log(`Removed tutorial_${tour.id} from localStorage`);
          }
        });

        // Also clear any other tutorial-related keys in localStorage
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && (key.startsWith('tutorial_') || key.startsWith('tutorial-'))) {
            keysToRemove.push(key);
          }
        }

        keysToRemove.forEach((key) => {
          localStorage.removeItem(key);
          console.log(`Removed ${key} from localStorage`);
        });

        console.log(`Total tutorial keys removed: ${keysToRemove.length}`);

        // Reset celebration flag so it can be shown again when tours are completed
        localStorage.removeItem('tours_celebration_shown');
        hasShownCelebration.value = false;
        console.log('Reset celebration flag');

        // Force component re-render
        const currentTours = availableTours.value;
        availableTours.value = [];
        setTimeout(() => {
          availableTours.value = currentTours;
          console.log('All tours reset complete');
          isResetting.value = false;
        }, 0);
      }
    };

    // Check if all tours are completed
    const allToursCompleted = computed(() => {
      return availableTours.value.every((tour) => isTourCompleted(tour.id));
    });

    // Confetti animation
    const triggerConfetti = () => {
      playSound('chaChingMoney');
      const duration = 3 * 1000;
      const animationEnd = Date.now() + duration;
      const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 2000 };

      function randomInRange(min, max) {
        return Math.random() * (max - min) + min;
      }

      const interval = setInterval(function () {
        const timeLeft = animationEnd - Date.now();

        if (timeLeft <= 0) {
          return clearInterval(interval);
        }

        const particleCount = 50 * (timeLeft / duration);

        // Create confetti from two origins
        if (window.confetti) {
          window.confetti({
            ...defaults,
            particleCount,
            origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 },
          });
          window.confetti({
            ...defaults,
            particleCount,
            origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 },
          });
        }
      }, 250);
    };

    // Show celebration when all tours are completed
    const showCelebration = async () => {
      // Don't show celebration if we're in the middle of resetting
      if (isResetting.value) {
        return;
      }

      if (allToursCompleted.value && !hasShownCelebration.value) {
        hasShownCelebration.value = true;
        localStorage.setItem('tours_celebration_shown', 'true');

        // Trigger confetti
        triggerConfetti();

        // Show congratulations modal
        await modal.value.showModal({
          title: '🎉 Congratulations! 🎉',
          message:
            "You've completed all available tours!<br/><br/>You're now a master of the platform. <br/>Keep exploring and building amazing things!",
          confirmText: 'Awesome!',
          showCancel: false,
          confirmClass: 'btn-primary',
        });
      }
    };

    // Watch for tour completion changes
    watch(
      () => availableTours.value.map((tour) => isTourCompleted(tour.id)),
      () => {
        showCelebration();
      },
      { deep: true }
    );

    onMounted(() => {
      loadSettings();

      // Load confetti library if not already loaded
      if (!window.confetti) {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.2/dist/confetti.browser.min.js';
        document.head.appendChild(script);
      }

      // Check if celebration should be shown on mount
      setTimeout(() => {
        showCelebration();
      }, 500);
    });

    // Expose a method to manually reset celebration (for debugging)
    window.resetTourCelebration = () => {
      localStorage.removeItem('tours_celebration_shown');
      hasShownCelebration.value = false;
      console.log('Tour celebration flag manually reset');
    };

    return {
      modal,
      toursEnabled,
      autoStartTours,
      availableTours,
      saveSettings,
      isTourCompleted,
      resetTour,
      startTour,
      resetAllTours,
      allToursCompleted,
    };
  },
};
</script>

<style scoped>
.tour-settings {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.setting-group {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.setting-group h3 {
  color: var(--color-primary);
  font-size: 1.2em;
  font-weight: 500;
  margin: 0;
}

.description {
  color: var(--color-text-muted);
  font-size: 0.95em;
  margin: 0;
  opacity: 0.9;
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 12px;
  transition: all 0.2s ease;
}

.setting-row:hover {
  background: var(--color-darker-1);
  border-color: var(--color-primary);
}

.setting-info {
  flex: 1;
}

.setting-label {
  display: block;
  color: var(--color-text);
  font-size: 1em;
  font-weight: 500;
  margin-bottom: 4px;
}

.setting-description {
  color: var(--color-text-muted);
  font-size: 0.9em;
  margin: 0;
  opacity: 0.8;
}

.setting-control {
  margin-left: 16px;
}

.toggle-switch {
  position: relative;
  display: inline-block;
  width: 52px;
  height: 28px;
  flex-shrink: 0;
}

.toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(127, 129, 147, 0.3);
  transition: 0.3s;
  border-radius: 28px;
  border: 1px solid var(--terminal-border-color);
}

.slider:before {
  position: absolute;
  content: '';
  height: 20px;
  width: 20px;
  left: 3px;
  bottom: 3px;
  background-color: var(--color-text-muted);
  transition: 0.3s;
  border-radius: 50%;
}

input:checked + .slider {
  background-color: var(--color-primary);
  border-color: var(--color-primary);
}

input:checked + .slider:before {
  transform: translateX(24px);
  background-color: var(--color-white);
}

.tour-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.tour-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 12px;
  transition: all 0.2s ease;
}

.tour-item:hover {
  background: var(--color-darker-1);
  border-color: var(--color-primary);
}

.tour-item-info {
  flex: 1;
}

.tour-item-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 4px;
}

.tour-name {
  color: var(--color-text);
  font-size: 1em;
  font-weight: 500;
}

.tour-status {
  padding: 4px 12px 1px;
  background: var(--color-darker-1);
  color: var(--color-text-secondary);
  border-radius: 12px;
  font-size: 0.85em;
}

.tour-status.completed {
  background: var(--terminal-muted-color);
  color: var(--color-primary);
}

.tour-description {
  color: var(--color-text-muted);
  font-size: 0.9em;
  margin: 0;
  opacity: 0.8;
}

.tour-item-actions {
  margin-left: 16px;
}

.btn-reset,
.btn-start {
  padding: 8px 16px;
  border: none;
  border-radius: 8px;
  font-size: 0.9em;
  cursor: pointer;
  transition: all 0.2s ease;
}

button.btn-reset {
  background: var(--color-darker-1);
  color: var(--color-text) !important;
}

.btn-reset:hover {
  background: var(--color-darker-2);
}

button.btn-start {
  background: var(--color-primary);
  color: var(--color-white) !important;
}

.btn-start:hover {
  opacity: 0.9;
  transform: translateY(-1px);
}

.bulk-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
}

button.btn-reset-all {
  padding: 10px 20px;
  background: var(--color-darker-1);
  color: var(--color-text) !important;
  border: none;
  border-radius: 8px;
  font-size: 0.95em;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-reset-all:hover {
  background: var(--color-darker-2);
}

.info-section {
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 12px;
  padding: 20px;
}

.info-text {
  color: var(--color-text-muted);
  font-size: 0.95em;
  line-height: 1.6;
  margin: 8px 0 0 0;
}
</style>
