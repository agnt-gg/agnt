<template>
  <BaseScreen
    ref="baseScreenRef"
    :activeRightPanel="isLoggedIn ? 'NewsPanel' : null"
    screenId="SettingsScreen"
    :showInput="false"
    :hidePanels="!isLoggedIn"
    :leftPanelProps="{ activeSection }"
    @screen-change="(screenName) => emit('screen-change', screenName)"
    @panel-action="handlePanelAction"
    @base-mounted="initializeScreen"
  >
    <template #default>
      <template v-if="isLoggedIn">
        <!-- General Settings Section -->
        <div v-if="activeSection === 'general'" class="settings-content" data-section="general">
          <div class="content-header">
            <h2 class="content-title">General Settings</h2>
            <p class="content-subtitle">Configure your basic system preferences</p>
          </div>
          <div class="settings-grid">
            <div class="settings-section full-width top-section">
              <LoginSection />
            </div>
          </div>
        </div>

        <!-- API Keys Section -->
        <div v-else-if="activeSection === 'api-keys'" class="settings-content" data-section="api-keys">
          <div class="content-header">
            <h2 class="content-title">API Keys</h2>
            <p class="content-subtitle">Manage your API keys and credentials</p>
          </div>
          <div class="settings-grid">
            <div class="settings-section mid-section">
              <ApiKeyManager />
            </div>
          </div>
        </div>

        <!-- Theme Section -->
        <div v-else-if="activeSection === 'theme'" class="settings-content" data-section="theme">
          <div class="content-header">
            <h2 class="content-title">Theme Settings</h2>
            <p class="content-subtitle">Customize your visual experience</p>
          </div>
          <div class="settings-grid">
            <div class="settings-section lower-section full-width">
              <ThemeSelector />
            </div>
          </div>
        </div>

        <!-- Providers Section -->
        <!-- <div v-else-if="activeSection === 'providers'" class="settings-content" data-section="providers">
            <div class="content-header">
              <h2 class="content-title">Provider Settings</h2>
              <p class="content-subtitle">Configure your AI service providers</p>
            </div>
            <div class="settings-grid">
              <div class="settings-section mid-section">
                <ProviderSelector />
              </div>
            </div>
          </div> -->

        <!-- Profile Section -->
        <div v-else-if="activeSection === 'profile'" class="settings-content" data-section="profile">
          <div class="content-header">
            <h2 class="content-title">User Profile</h2>
            <p class="content-subtitle">Manage your account profile and view your Network score</p>
          </div>
          <div class="settings-grid">
            <div class="settings-section full-width">
              <ProfileSection />
              <AgntScoreBreakdown />
            </div>
          </div>
        </div>

        <!-- Billing Section -->
        <div v-else-if="activeSection === 'billing'" class="settings-content" data-section="billing">
          <div class="content-header">
            <h2 class="content-title">Billing Management</h2>
            <p class="content-subtitle">Comprehensive billing and usage management</p>
          </div>
          <div class="settings-grid">
            <div class="settings-section full-width">
              <BillingManager />
            </div>
          </div>
        </div>

        <!-- Referrals Section -->
        <div v-else-if="activeSection === 'referrals'" class="settings-content" data-section="referrals">
          <div class="content-header">
            <h2 class="content-title">Referral Program</h2>
            <p class="content-subtitle">Earn 30% commission when your referrals subscribe to paid plans</p>
          </div>
          <div class="settings-grid">
            <div class="settings-section full-width">
              <ReferralsSection />
            </div>
          </div>
        </div>

        <!-- Leaderboard Section -->
        <div v-else-if="activeSection === 'leaderboard'" class="settings-content" data-section="leaderboard">
          <div class="content-header">
            <h2 class="content-title">Global Leaderboard</h2>
            <p class="content-subtitle">See how you rank against other users based on Referral Points and Network Score</p>
          </div>
          <div class="settings-grid">
            <div class="settings-section full-width">
              <LeaderboardSection />
            </div>
          </div>
        </div>

        <!-- Security Section -->
        <div v-else-if="activeSection === 'security'" class="settings-content" data-section="security">
          <div class="content-header">
            <h2 class="content-title">Security Settings</h2>
            <p class="content-subtitle">Manage your account security</p>
          </div>
          <div class="settings-grid">
            <div class="settings-section">
              <h3>Security Options</h3>
              <p>Security settings will be implemented here.</p>
            </div>
          </div>
        </div>

        <!-- Notifications Section -->
        <div v-else-if="activeSection === 'notifications'" class="settings-content" data-section="notifications">
          <div class="content-header">
            <h2 class="content-title">Notification Settings</h2>
            <p class="content-subtitle">Configure your notification preferences</p>
          </div>
          <div class="settings-grid">
            <div class="settings-section">
              <h3>Notification Preferences</h3>
              <p>Notification settings will be implemented here.</p>
            </div>
          </div>
        </div>

        <!-- Backup Section -->
        <div v-else-if="activeSection === 'backup'" class="settings-content" data-section="backup">
          <div class="content-header">
            <h2 class="content-title">Backup & Export</h2>
            <p class="content-subtitle">Backup and export your data</p>
          </div>
          <div class="settings-grid">
            <div class="settings-section">
              <h3>Data Management</h3>
              <p>Backup and export options will be implemented here.</p>
            </div>
          </div>
        </div>

        <!-- Sounds Section -->
        <div v-else-if="activeSection === 'sounds'" class="settings-content" data-section="sounds">
          <div class="content-header">
            <h2 class="content-title">Sound Settings</h2>
            <p class="content-subtitle">Control audio feedback and sound effects</p>
          </div>
          <div class="settings-grid">
            <div class="settings-section full-width">
              <SoundsSettings />
            </div>
          </div>
        </div>

        <!-- Tours Section -->
        <div v-else-if="activeSection === 'tours'" class="settings-content" data-section="tours">
          <div class="content-header">
            <h2 class="content-title">Tour Settings</h2>
            <p class="content-subtitle">Manage interactive tours and tutorials</p>
          </div>
          <div class="settings-grid">
            <div class="settings-section full-width">
              <TourSettings @start-tour="handleStartTour" />
            </div>
          </div>
        </div>

        <!-- Reset Section -->
        <div v-else-if="activeSection === 'reset'" class="settings-content" data-section="reset">
          <div class="content-header">
            <h2 class="content-title">Reset Settings</h2>
            <p class="content-subtitle">Reset your system to default settings</p>
          </div>
          <div class="settings-grid">
            <div class="settings-section">
              <h3>Reset Options</h3>
              <p>Reset functionality will be implemented here.</p>
            </div>
          </div>
        </div>

        <!-- About Section -->
        <div v-else-if="activeSection === 'about'" class="settings-content" data-section="about">
          <div class="content-header">
            <h2 class="content-title">About</h2>
            <p class="content-subtitle">System information and version details</p>
          </div>
          <div class="settings-grid">
            <div class="settings-section">
              <h3>System Information</h3>
              <p>About information will be implemented here.</p>
            </div>
            <div class="settings-section full-width">
              <ResourcesSection />
            </div>
          </div>
        </div>
      </template>
      <template v-else>
        <LoginSection @login-success="handleLoginSuccess" />
      </template>

      <!-- Tutorial - Only show when logged in -->
      <PopupTutorial
        v-if="isLoggedIn"
        :config="tutorialConfig"
        :startTutorial="startTutorial"
        tutorialId="settings-tutorial"
        @close="onTutorialClose"
      />
    </template>
  </BaseScreen>
</template>

<script>
import { ref, computed, watch } from 'vue';
import { useStore } from 'vuex';
import BaseScreen from '../../BaseScreen.vue';
import TerminalHeader from '../../../_components/TerminalHeader.vue';
import LoginSection from './components/LoginSection/LoginSection.vue';
import ProviderSelector from './components/ProviderSelector/ProviderSelector.vue';
import ApiKeyManager from './components/ApiKeyManager/ApiKeyManager.vue';
import ThemeSelector from './components/ThemeSelector/ThemeSelector.vue';
import BillingManager from './components/BillingManager/BillingManager.vue';
import CreditPurchase from '../../../../_components/common/CreditPurchase.vue';
import ResourcesSection from '../../../../_components/common/ResourcesSection.vue';
import TourSettings from './components/TourSettings/TourSettings.vue';
import SoundsSettings from './components/SoundsSettings/SoundsSettings.vue';
import AgntScoreBreakdown from './components/AgntScoreBreakdown/AgntScoreBreakdown.vue';
import ProfileSection from './components/ProfileSection/ProfileSection.vue';
import ReferralsSection from './components/ReferralsSection/ReferralsSection.vue';
import LeaderboardSection from './components/LeaderboardSection/LeaderboardSection.vue';
import { useSettingsTutorial } from './useTutorial.js';
import PopupTutorial from '../../../../_components/utility/PopupTutorial.vue';

export default {
  name: 'Settings',
  components: {
    BaseScreen,
    TerminalHeader,
    LoginSection,
    ProviderSelector,
    ApiKeyManager,
    ThemeSelector,
    BillingManager,
    CreditPurchase,
    ResourcesSection,
    TourSettings,
    SoundsSettings,
    AgntScoreBreakdown,
    ProfileSection,
    ReferralsSection,
    LeaderboardSection,
    PopupTutorial,
  },
  emits: ['screen-change', 'start-tour'],
  setup(props, { emit }) {
    const store = useStore();
    const baseScreenRef = ref(null);
    const activeSection = ref('profile');
    const componentKey = ref(0);

    const isLoggedIn = computed(() => store.getters['userAuth/isAuthenticated']);

    // Tutorial setup
    const { tutorialConfig, startTutorial, currentStep, onTutorialClose, nextStep, initializeSettingsTutorial } = useSettingsTutorial();

    const initializeScreen = () => {
      // Check if there's a requested section to navigate to
      const requestedSection = localStorage.getItem('settings-initial-section');
      if (requestedSection) {
        activeSection.value = requestedSection;
        localStorage.removeItem('settings-initial-section'); // Clean up
      }

      // Non-blocking: refresh all data in parallel in background
      if (isLoggedIn.value) {
        Promise.allSettled([
          store.dispatch('userStats/fetchReferralBalance'),
          store.dispatch('userStats/fetchReferralTree'),
          store.dispatch('userStats/fetchStats'),
          store.dispatch('userStats/fetchCreditsActivity', { activityDays: 90 }),
          store.dispatch('goals/fetchGoals'),
          store.dispatch('agents/fetchAgents'),
          store.dispatch('workflows/fetchWorkflows'),
          store.dispatch('tools/fetchTools'),
          store.dispatch('executionHistory/fetchExecutions'),
          store.dispatch('appAuth/fetchConnectedApps'),
        ]).then(() => {
          // Recalculate AGNT score with fresh data
          store.dispatch('userStats/calculateAndStoreAgntScore');
        }).catch((error) => {
          console.error('Failed to refresh settings data:', error);
        });

        // Start tutorial after 2 seconds
        setTimeout(() => {
          initializeSettingsTutorial();
        }, 2000);
      }
    };

    const handlePanelAction = (action, payload) => {
      console.log('Settings: Received panel action:', action, payload);
      if (action === 'settings-nav') {
        activeSection.value = payload;
      }
      // Handle other panel actions if needed
    };

    const handleStartTour = (tourData) => {
      console.log('Settings: Starting tour:', tourData);
      // Emit screen-change event to navigate to the tour's screen
      emit('screen-change', tourData.screen);
    };

    const handleLoginSuccess = async () => {
      console.log('Login successful, reloading page');
      // Reload the page to show authenticated state
      window.location.href = '/settings';
    };

    // Watch for login state changes and switch to profile section
    watch(isLoggedIn, (newValue, oldValue) => {
      if (newValue && !oldValue) {
        // User just logged in, switch to profile section
        console.log('User logged in, switching to profile section');
        activeSection.value = 'profile';
      }
    });

    return {
      baseScreenRef,
      emit,
      initializeScreen,
      isLoggedIn,
      activeSection,
      handlePanelAction,
      handleStartTour,
      handleLoginSuccess,
      // Tutorial
      tutorialConfig,
      startTutorial,
      currentStep,
      onTutorialClose,
      nextStep,
    };
  },
};
</script>

<style scoped>
.settings-grid {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  margin: 0;
}

.settings-section {
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  padding: 24px;
  transition: all 0.3s ease;
  border-radius: 16px;
  backdrop-filter: blur(4px);
}

body.dark .settings-section {
  /* background: rgba(127, 129, 147, 0.08);
  border: 1px solid rgba(18, 224, 255, 0.1); */
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
  padding: 8px 0;
  border-bottom: 1px dashed var(--terminal-border-color);
}
.about-row {
  margin-bottom: 8px;
  color: var(--color-grey);
}
.terminal-line {
  line-height: 1.3;
  margin-bottom: 2px;
}

.log-line {
  opacity: 0.8; /* Make log lines slightly less prominent */
  font-size: 0.9em;
}

.text-bright-green {
  color: var(--color-green);
}
.font-bold {
  font-weight: bold;
}
.text-xl {
  font-size: 1.25rem;
}
/* .top-section {
  border-radius: 0px;
}
.mid-section {
  border-radius: 0px;
} */
/* .lower-section {
  padding: 24px !important;
} */

.settings-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  max-width: 1048px;
  margin: 0 auto;
  align-items: flex-start;
}

.content-header {
  padding: 0;
  border-bottom: 1px solid var(--terminal-border-color);
  padding-bottom: 16px;
  width: 100%;
  max-width: 1048px;
}

.content-title {
  /* color: var(--color-green); */
  font-size: 1.8em;
  font-weight: 600;
  margin: 0 0 8px 0;
}

.content-subtitle {
  color: var(--color-light-med-navy);
  font-size: 1em;
  margin: 0;
  opacity: 0.8;
  line-height: 1.4;
}

.settings-section h3 {
  color: var(--color-light-green);
  font-size: 1.2em;
  font-weight: 500;
  margin: 0 0 16px 0;
}

.settings-section p {
  color: var(--color-light-med-navy);
  font-size: 0.95em;
  line-height: 1.5;
  margin: 0;
  opacity: 0.9;
}
</style>
