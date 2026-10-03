<template>
  <BaseScreen
    ref="baseScreenRef"
    :activeRightPanel="activeRightPanel"
    screenId="SettingsScreen"
    :hidePanels="!isLoggedIn"
    :leftPanelProps="{ activeSection }"
    @screen-change="(screenName) => emit('screen-change', screenName)"
    @panel-action="handlePanelAction"
    @base-mounted="initializeScreen"
  >
    <template #default>
      <MobileDirectory v-if="mobileView && isLoggedIn" v-show="mobileDirectoryOpen" title="Settings" view-id="settings" :groups="settingsDirectory" @select="mobileSelectSection" />
      <div v-show="!mobileView || !isLoggedIn || !mobileDirectoryOpen" class="mobile-section-body">
      <button v-if="mobileView && isLoggedIn" class="mobile-section-back" @click="mobileDirectoryOpen = true"><i class="fas fa-arrow-left"></i>Settings</button>
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
            <h2 class="content-title">API Key</h2>
            <p class="content-subtitle">Call your AGNT from bots, scripts and other services</p>
          </div>
          <ApiKeyManager />
        </div>

        <!-- Navigation Section -->
        <div v-else-if="activeSection === 'navigation'" class="settings-content" data-section="navigation">
          <div class="content-header">
            <h2 class="content-title">Navigation</h2>
            <p class="content-subtitle">Show, hide, arrange, group, add, and remove pages in the left sidebar</p>
          </div>
          <div class="settings-grid">
            <div class="settings-section full-width">
              <NavigationSettings />
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
            <div class="settings-section full-width">
              <UiModeSetting />
            </div>
            <div class="settings-section lower-section full-width">
              <ThemeSelector />
            </div>
          </div>
        </div>

        <!-- AI Provider Section. The page Connectors used to host, moved here
             intact: same three cards, same order, same copy. `.settings-grid`
             and `.connectors-grid` are the identical flex column, so it also
             lays out identically. -->
        <div v-else-if="activeSection === 'providers'" class="settings-content" data-section="providers">
          <div class="content-header">
            <h2 class="content-title">Default AI Provider</h2>
            <p class="content-subtitle">
              The model Annie uses everywhere she isn't told otherwise — and what happens when it's unavailable.
            </p>
          </div>
          <!--
            ORDERED BY HOW OFTEN EACH ONE IS ACTUALLY TOUCHED, not by how new or
            interesting the feature is:

              01 Model        daily          ← the reason anyone opens this page
              02 Fallback     a few × / year
              03 Instructions monthly
              04 Limits       once, ever     ← collapsed, values shown in header

            Dynamic routing is deliberately NOT a fifth card. It is the second
            answer to "which model", so it lives inside 01 as a mode — putting it
            on top would place the rarest decision above the most common one.
          -->
          <div class="settings-grid">
            <ProviderSelector />
            <FallbackProviders />
            <ChatBehaviorSettings />
          </div>
        </div>

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

        <!-- Usage Section -->
        <div v-else-if="activeSection === 'usage'" class="settings-content" data-section="usage">
          <div class="content-header">
            <h2 class="content-title">Usage</h2>
            <p class="content-subtitle">What you've used this month of the hosted services included with your plan</p>
          </div>
          <div class="settings-grid">
            <div class="settings-section full-width">
              <UsageManager />
            </div>
          </div>
        </div>

        <!-- Referrals Section -->
        <div v-else-if="activeSection === 'referrals'" class="settings-content" data-section="referrals">
          <div class="content-header">
            <h2 class="content-title">Referral Program</h2>
            <p class="content-subtitle">Give a month, get a month. Partners earn 30% for each customer's first 12 months.</p>
          </div>
          <div class="settings-grid">
            <div class="settings-section full-width">
              <ReferralsSection />
            </div>
          </div>
        </div>

        <!-- Connection Section -->
        <div v-else-if="activeSection === 'connection'" class="settings-content" data-section="connection">
          <div class="content-header">
            <h2 class="content-title">Connection</h2>
            <p class="content-subtitle">Use AGNT running on this computer, or on a remote server</p>
          </div>
          <div class="settings-grid">
            <div class="settings-section full-width">
              <ConnectionSection />
            </div>
          </div>
        </div>

        <!-- Phone Access Section -->
        <div v-else-if="activeSection === 'phone-access'" class="settings-content" data-section="phone-access">
          <div class="content-header">
            <h2 class="content-title">Phone Access</h2>
            <p class="content-subtitle">Text Annie from anywhere, or run this AGNT from your phone over your local network</p>
          </div>
          <div class="settings-grid">
            <div class="settings-section full-width">
              <TextAnnieCard />
            </div>
            <div class="settings-section full-width">
              <PhoneAccessSection />
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
            <h2 class="content-title">Security Policy</h2>
            <p class="content-subtitle">Control how NOPE handles risky actions across agents and workflows</p>
          </div>
          <div class="settings-grid">
            <div class="settings-section full-width"><SecuritySettings /></div>
          </div>
        </div>

        <!-- Backup Section -->
        <div v-else-if="activeSection === 'backup'" class="settings-content" data-section="backup">
          <div class="content-header">
            <h2 class="content-title">Backup & Restore</h2>
            <p class="content-subtitle">Save your agents, workflows, memory and history to a file, or bring them back from one</p>
          </div>
          <div class="settings-grid">
            <div class="settings-section full-width">
              <DataExportSection />
            </div>
            <div class="settings-section full-width">
              <DataRestoreSection />
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
            <h2 class="content-title">Reset</h2>
            <p class="content-subtitle">Clear chats, history, memory, your work or preferences and start fresh</p>
          </div>
          <div class="settings-grid">
            <div class="settings-section full-width">
              <DataResetSection />
            </div>
          </div>
        </div>

        <!-- About Section -->
        <div v-else-if="activeSection === 'about'" class="settings-content" data-section="about">
          <div class="content-header">
            <h2 class="content-title">About</h2>
            <p class="content-subtitle">Version, updates, and where to find help</p>
          </div>
          <div class="settings-grid">
            <!-- Version · update check · latest releases. This was the
                 "AGNT News & Updates" right panel on Connectors, Plugins and
                 Settings; it has one home now and the toolbar carries an
                 "update" pill when there is one. -->
            <div class="settings-section full-width">
              <NewsPanel />
            </div>
            <!-- Docs · GitHub · Discord · Feedback — once, here, and in ⌘K. -->
            <div class="settings-section full-width">
              <ResourcesSection />
            </div>
          </div>
        </div>
      </template>
      <template v-else>
        <LoginSection @login-success="handleLoginSuccess" />
      </template>

      </div>
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
import { ref, computed, watch , inject } from 'vue';
import { useStore } from 'vuex';
import { useRoute } from 'vue-router';
import MobileDirectory from '@/mobile/MobileDirectory.vue';
import { settingsDirectory } from '@/mobile/sectionDirectories.js';
import BaseScreen from '../../BaseScreen.vue';
import TerminalHeader from '../../../_components/TerminalHeader.vue';
import LoginSection from './components/LoginSection/LoginSection.vue';
import ProviderSelector from './components/ProviderSelector/ProviderSelector.vue';
// Owned by the Connectors screen directory, which is where this page lived
// before it moved under SYSTEM. Imported rather than copied so there is still
// exactly one implementation of each card.
import FallbackProviders from '../Connectors/components/FallbackProviders.vue';
import ChatBehaviorSettings from '../Connectors/components/ChatBehaviorSettings.vue';
import ApiKeyManager from './components/ApiKeyManager/ApiKeyManager.vue';
import ThemeSelector from './components/ThemeSelector/ThemeSelector.vue';
import UiModeSetting from '@/views/Focused/UiModeSetting.vue';
import NavigationSettings from './components/NavigationSettings/NavigationSettings.vue';
import BillingManager from './components/BillingManager/BillingManager.vue';
import UsageManager from './components/UsageManager/UsageManager.vue';
import CreditPurchase from '../../../../_components/common/CreditPurchase.vue';
import ResourcesSection from '../../../../_components/common/ResourcesSection.vue';
import NewsPanel from '@/views/Terminal/RightPanel/types/NewsPanel/NewsPanel.vue';
import TourSettings from './components/TourSettings/TourSettings.vue';
import SoundsSettings from './components/SoundsSettings/SoundsSettings.vue';
import SecuritySettings from './components/SecuritySettings/SecuritySettings.vue';
import AgntScoreBreakdown from './components/AgntScoreBreakdown/AgntScoreBreakdown.vue';
import ProfileSection from './components/ProfileSection/ProfileSection.vue';
import ReferralsSection from './components/ReferralsSection/ReferralsSection.vue';
import PhoneAccessSection from './components/PhoneAccessSection/PhoneAccessSection.vue';
import TextAnnieCard from './components/PhoneAccessSection/TextAnnieCard.vue';
import ConnectionSection from './components/ConnectionSection/ConnectionSection.vue';
import LeaderboardSection from './components/LeaderboardSection/LeaderboardSection.vue';
import DataExportSection from './components/DataExportSection/DataExportSection.vue';
import DataRestoreSection from './components/DataExportSection/DataRestoreSection.vue';
import DataResetSection from './components/DataExportSection/DataResetSection.vue';
import { useSettingsTutorial } from './useTutorial.js';
import PopupTutorial from '../../../../_components/utility/PopupTutorial.vue';

export default {
  name: 'Settings',
  components: { MobileDirectory,
    BaseScreen,
    TerminalHeader,
    LoginSection,
    ProviderSelector,
    FallbackProviders,
    ChatBehaviorSettings,
    ApiKeyManager,
    ThemeSelector,
    UiModeSetting,
    NavigationSettings,
    BillingManager,
    UsageManager,
    CreditPurchase,
    ResourcesSection,
    NewsPanel,
    TourSettings,
    SoundsSettings,
    SecuritySettings,
    AgntScoreBreakdown,
    ProfileSection,
    ReferralsSection,
    LeaderboardSection,
    PhoneAccessSection,
    TextAnnieCard,
    ConnectionSection,
    DataExportSection,
    DataRestoreSection,
    DataResetSection,
    PopupTutorial,
  },
  emits: ['screen-change', 'start-tour'],
  setup(props, { emit }) {
    const store = useStore();
    const route = useRoute();
    const baseScreenRef = ref(null);
    const mobileView = inject('isMobile', ref(false));
    const mobileDirectoryOpen = ref(!route?.query?.section);
    const mobileSelectSection = item => { mobileDirectoryOpen.value = false; handlePanelAction(item.screen ? 'settings-goto' : 'settings-nav', item.screen || item.id); };

    const activeSection = ref('profile');
    watch(() => route?.query?.section, section => { if (section) mobileDirectoryOpen.value = false; });
    const componentKey = ref(0);

    const isLoggedIn = computed(() => store.getters['userAuth/isAuthenticated']);
    const activeRightPanel = computed(() => {
      if (!isLoggedIn.value) return null;
      return activeSection.value === 'security' ? 'SecurityActivityPanel' : 'NewsPanel';
    });

    // Tutorial setup
    const { tutorialConfig, startTutorial, currentStep, onTutorialClose, nextStep, initializeSettingsTutorial } = useSettingsTutorial();

    // BaseScreen re-emits `base-mounted` on every KeepAlive re-activation, so
    // bouncing between screens replayed all ten of these requests each time.
    // They are background refreshes of slow-moving data; once a minute is
    // plenty, and the first visit is never throttled.
    const REFRESH_INTERVAL_MS = 60_000;
    let lastRefreshAt = 0;

    const initializeScreen = () => {
      // Check if there's a requested section to navigate to: the URL first
      // (?section=about from the toolbar pill / Jump palette), then the
      // localStorage hand-off older callers use.
      const urlSection = typeof route?.query?.section === 'string' ? route.query.section : '';
      const requestedSection = urlSection || localStorage.getItem('settings-initial-section');
      if (requestedSection) {
        mobileDirectoryOpen.value = false;
        activeSection.value = requestedSection;
        localStorage.removeItem('settings-initial-section'); // Clean up
      }

      // Non-blocking: refresh all data in parallel in background
      if (isLoggedIn.value && Date.now() - lastRefreshAt >= REFRESH_INTERVAL_MS) {
        lastRefreshAt = Date.now();
        Promise.allSettled([
          store.dispatch('userStats/fetchReferralBalance'),
          store.dispatch('userStats/fetchReferralTree'),
          store.dispatch('userStats/fetchStats'),
          store.dispatch('userStats/fetchSecondsAutomated90Day'),
          store.dispatch('goals/fetchGoals'),
          store.dispatch('agents/fetchAgents'),
          store.dispatch('workflows/fetchWorkflows'),
          store.dispatch('tools/fetchTools'),
          store.dispatch('executionHistory/fetchExecutions'),
          store.dispatch('appAuth/fetchConnectedApps'),
        ])
          .then(() => {
            // Recalculate AGNT score with fresh data
            store.dispatch('userStats/calculateAndStoreAgntScore');
          })
          .catch((error) => {
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
        mobileDirectoryOpen.value = false;
        activeSection.value = payload;
      } else if (action === 'settings-goto') {
        // A SYSTEM row that is a whole screen (Memory / Evolution / Autonomy)
        // rather than a section of this one.
        emit('screen-change', payload);
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

    return { mobileView, mobileDirectoryOpen, mobileSelectSection, settingsDirectory,
      baseScreenRef,
      emit,
      initializeScreen,
      isLoggedIn,
      activeRightPanel,
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
  padding: 0;
  transition: all 0.3s ease;
  border-radius: 16px;
}

body.dark .settings-section {
  /* background: rgba(127, 129, 147, 0.08);
  border: 1px solid rgba(18, 224, 255, 0.1); */
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
}

.settings-section.full-width,
body.dark .settings-section.full-width {
  background: transparent;
  border: none;
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
