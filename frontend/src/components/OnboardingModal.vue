<template>
  <!-- SimpleModal for confirmations - outside v-if so ref is always available -->
  <SimpleModal ref="modal" />

  <Transition name="modal-fade">
    <div v-if="show" class="onboarding-overlay" @click.self="handleSkip">
      <div class="onboarding-modal">
        <!-- Progress Indicator -->
        <div class="progress-dots">
          <div v-for="step in totalSteps" :key="step" class="dot" :class="{ active: step === currentStep, completed: step < currentStep }"></div>
        </div>

        <!-- Step Content -->
        <Transition :name="transitionName" mode="out-in">
          <div :key="currentStep" class="step-content">
            <!-- Step 1: Welcome -->
            <div v-if="currentStep === 1" class="step welcome-step">
              <img src="/images/agnt-logo.png" alt="AGNT Logo" class="logo-large" />
              <h1>Welcome to <span style="color: var(--color-primary)">AGNT</span>, {{ userName }}!</h1>
              <p class="subtitle">Your AI-powered automation workspace is ready to go.</p>
              <p class="description">Let's get you started in just a few quick steps.</p>
            </div>

            <!-- Step 2: Theme Selection -->
            <div v-if="currentStep === 2" class="step theme-step">
              <div class="icon-circle">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="5"></circle>
                  <line x1="12" y1="1" x2="12" y2="3"></line>
                  <line x1="12" y1="21" x2="12" y2="23"></line>
                  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
                  <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
                  <line x1="1" y1="12" x2="3" y2="12"></line>
                  <line x1="21" y1="12" x2="23" y2="12"></line>
                  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
                  <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
                </svg>
              </div>
              <h2>Choose Your Theme</h2>
              <p class="subtitle">Pick a look that suits your style</p>
              <div class="theme-grid">
                <button
                  v-for="theme in availableThemes"
                  :key="theme.id"
                  class="theme-tile"
                  :class="{ active: currentTheme === theme.id }"
                  @click="selectTheme(theme.id)"
                >
                  <div class="theme-swatch" :class="'swatch-' + theme.id"></div>
                  <span class="theme-tile-name">{{ theme.name }}</span>
                </button>
              </div>
              <p class="hint" style="margin-top: 16px; text-align: center">You can change this anytime in Settings.</p>
            </div>

            <!-- Step 3: Profile Setup -->
            <div v-if="currentStep === 3" class="step profile-step">
              <div class="icon-circle">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                  <circle cx="12" cy="7" r="4"></circle>
                </svg>
              </div>
              <h2>Set Up Your Profile</h2>
              <p class="subtitle">How would you like to be known in AGNT?</p>
              <div class="input-group">
                <label for="pseudonym">Display Name</label>
                <div class="input-with-status">
                  <input
                    id="pseudonym"
                    v-model="pseudonym"
                    type="text"
                    placeholder="Enter your display name"
                    @input="checkPseudonymAvailability"
                    @keyup.enter="nextStep"
                  />
                  <div v-if="pseudonymStatus" class="status-indicator" :class="pseudonymStatus">
                    <span v-if="pseudonymStatus === 'checking'">⏳</span>
                    <span v-else-if="pseudonymStatus === 'available'">✓</span>
                    <span v-else-if="pseudonymStatus === 'taken'">✗</span>
                    <span v-else-if="pseudonymStatus === 'current'">✓</span>
                  </div>
                </div>
                <p v-if="pseudonymStatus === 'current'" class="hint success">This is your current display name</p>
                <p v-else-if="pseudonymStatus === 'available'" class="hint success">This name is available!</p>
                <p v-else-if="pseudonymStatus === 'taken'" class="hint error">This name is already taken</p>
                <p v-else-if="pseudonymStatus === 'checking'" class="hint">Checking availability...</p>
                <p v-else class="hint">This is how you'll appear on leaderboards and in the community.</p>
              </div>
            </div>

            <!-- Step 4: AI Provider Setup (conditional - only if not connected) -->
            <div v-if="currentStep === 4 && !hasAiProvider" class="step provider-step">
              <div class="icon-circle">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path>
                </svg>
              </div>
              <h2>Connect an AI Provider</h2>
              <p class="subtitle">Choose an AI provider to power your agents</p>
              <p class="description" style="margin-bottom: 24px">
                Select a provider below to get started. You can add more providers later in Settings.
              </p>

              <div class="provider-grid">
                <button
                  v-for="provider in aiProviders"
                  :key="provider.id"
                  type="button"
                  class="provider-tile"
                  :title="provider.name"
                  :aria-label="`Connect to ${provider.name}`"
                  @click="handleProviderClick(provider)"
                >
                  <div class="provider-icon">
                    <SvgIcon :name="provider.icon" />
                  </div>
                  <span class="provider-name">{{
                    PROVIDER_DISPLAY_NAMES[provider.id] || PROVIDER_DISPLAY_NAMES[provider.name] || provider.name
                  }}</span>
                </button>
              </div>

              <p class="hint" style="margin-top: 16px; text-align: center">Don't have an API key? You can skip this step and configure it later.</p>
            </div>

            <!-- Step 5 (or 4 if provider connected): Feature Tour -->
            <div v-if="currentStep === (hasAiProvider ? 4 : 5)" class="step features-step">
              <h2>Explore Key Features</h2>
              <p class="subtitle">Here's what you can do with AGNT:</p>
              <div class="features-grid">
                <div class="feature-card">
                  <div class="feature-icon">💬</div>
                  <h3>AI Chat</h3>
                  <p>Converse with intelligent agents to automate tasks</p>
                </div>
                <div class="feature-card">
                  <div class="feature-icon">⚡</div>
                  <h3>Workflows</h3>
                  <p>Build custom automation workflows visually</p>
                </div>
                <div class="feature-card">
                  <div class="feature-icon">🛠️</div>
                  <h3>Custom Tools</h3>
                  <p>Create and share your own tools and integrations</p>
                </div>
                <div class="feature-card">
                  <div class="feature-icon">📊</div>
                  <h3>$AGNT Score</h3>
                  <p>Track your productivity and earn rewards</p>
                </div>
              </div>
            </div>

            <!-- Step 6 (or 5 if provider connected): Quick Start -->
            <div v-if="currentStep === (hasAiProvider ? 5 : 6)" class="step quickstart-step">
              <h2>What would you like to do first?</h2>
              <p class="subtitle">Choose your starting point:</p>
              <div class="quickstart-options">
                <button
                  v-for="option in quickStartOptions"
                  :key="option.screen"
                  class="quickstart-option"
                  :class="{ selected: selectedStartScreen === option.screen }"
                  @click="selectedStartScreen = option.screen"
                >
                  <div class="option-icon">{{ option.icon }}</div>
                  <div class="option-content">
                    <h3>{{ option.title }}</h3>
                    <p>{{ option.description }}</p>
                  </div>
                  <div class="option-check">
                    <svg v-if="selectedStartScreen === option.screen" width="24" height="24" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" fill="var(--color-primary)" />
                      <path d="M9 12l2 2 4-4" stroke="var(--color-ultra-dark-navy)" stroke-width="2" stroke-linecap="round" />
                    </svg>
                  </div>
                </button>
              </div>
            </div>

            <!-- Step 7 (or 6 if provider connected): Referral Bonus (conditional) -->
            <div v-if="currentStep === (hasAiProvider ? 6 : 7) && hasReferralBonus" class="step referral-step">
              <div class="celebration-icon">🎉</div>
              <h2>You've Earned a Bonus!</h2>
              <div class="bonus-display">
                <div class="bonus-amount">+{{ referralBalance }} pts</div>
                <p class="bonus-label">Referral Score</p>
              </div>
              <p class="subtitle" v-if="referrerName">
                Thanks to <strong>{{ referrerName }}</strong> for inviting you!
              </p>
              <p class="description">Invite others to AGNT and earn even more points. Your referral score boosts your $AGNT Network Score by 20x!</p>
            </div>

            <!-- Final Step: Ready to Go -->
            <div v-if="currentStep === finalStep" class="step ready-step">
              <div class="success-icon">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="var(--color-primary)" stroke-width="2" />
                  <path d="M9 12l2 2 4-4" stroke="var(--color-primary)" stroke-width="2" stroke-linecap="round" />
                </svg>
              </div>
              <h2>Your Workspace is Ready!</h2>
              <p class="subtitle">You're all set to start building with AGNT.</p>
              <div class="ready-summary">
                <div class="summary-item" v-if="pseudonym">
                  <span class="summary-label">Display Name:</span>
                  <span class="summary-value">{{ pseudonym }}</span>
                </div>
                <div class="summary-item">
                  <span class="summary-label">Theme:</span>
                  <span class="summary-value" style="text-transform: capitalize">{{ currentTheme }}</span>
                </div>
                <div class="summary-item">
                  <span class="summary-label">Starting Point:</span>
                  <span class="summary-value">{{ selectedStartOption?.title || 'Chat' }}</span>
                </div>
              </div>
            </div>
          </div>
        </Transition>

        <!-- Navigation Buttons -->
        <div class="modal-actions">
          <button v-if="currentStep > 1 && currentStep < finalStep" @click="prevStep" class="btn-secondary">← Back</button>
          <div class="spacer" v-else></div>

          <button v-if="currentStep < finalStep" @click="handleSkip" class="btn-text">Skip Tour</button>

          <button v-if="currentStep < finalStep" @click="nextStep" class="btn-primary">
            {{ currentStep === totalSteps - 1 ? 'Finish' : 'Continue' }} →
          </button>
          <button v-else @click="complete" class="btn-primary btn-large">Start Building</button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script>
import { ref, computed, onMounted, watch } from 'vue';
import { useStore } from 'vuex';
import SvgIcon from '@/views/_components/common/SvgIcon.vue';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import { API_CONFIG } from '@/tt.config.js';
import { PROVIDER_DISPLAY_NAMES } from '@/store/app/aiProvider.js';
import { encrypt } from '@/views/_utils/encryption.js';

export default {
  name: 'OnboardingModal',
  components: {
    SvgIcon,
    SimpleModal,
  },
  props: {
    show: {
      type: Boolean,
      default: true,
    },
  },
  emits: ['complete', 'skip'],
  setup(props, { emit }) {
    const store = useStore();
    const modal = ref(null);

    // Theme data
    const currentTheme = computed(() => store.getters['theme/currentTheme']);
    const availableThemes = [
      { id: 'dark', name: 'Dark' },
      { id: 'cyberpunk', name: 'Cyberpunk' },
      { id: 'midnight', name: 'Midnight' },
      { id: 'ember', name: 'Ember' },
      { id: 'nord', name: 'Nord' },
      { id: 'hacker', name: 'Hacker' },
      { id: 'light', name: 'Light' },
      { id: 'rose', name: 'Rose' },
    ];
    const selectTheme = (themeId) => {
      store.dispatch('theme/setTheme', themeId);
    };

    // User data
    const userName = computed(() => store.getters['userAuth/userName'] || 'there');
    const userPseudonym = computed(() => store.getters['userAuth/userPseudonym']);
    const referralBalance = computed(() => store.state.userStats?.referralBalance || 0);
    const hasReferralBonus = computed(() => referralBalance.value > 0);

    // State
    const currentStep = ref(1);
    const pseudonym = ref('');
    const pseudonymStatus = ref(null); // 'checking', 'available', 'taken', 'current'
    const selectedStartScreen = ref('ChatScreen');
    const transitionName = ref('slide-left');
    let checkTimeout = null;

    // Provider state
    const allProviders = computed(() => store.state.appAuth.allProviders || []);
    const connectedApps = computed(() => store.state.appAuth.connectedApps || []);
    const codexStatus = computed(() => store.state.appAuth.codexStatus || {});
    const aiProviders = computed(() => {
      return allProviders.value
        .filter((p) => {
          // Hide the non-CLI Codex provider when the OpenAI API is not usable (403, etc.).
          if (p.id === 'openai-codex' && codexStatus.value?.available === true && codexStatus.value?.apiUsable !== true) {
            return false;
          }

          const categories = Array.isArray(p.categories) ? p.categories : p.categories ? JSON.parse(p.categories) : [];
          const lowerCategories = categories.map((cat) => cat.toLowerCase());
          return lowerCategories.includes('ai');
        })
        .sort((a, b) => a.name.localeCompare(b.name));
    });

    // Check if user has any AI provider connected
    const hasAiProvider = computed(() => {
      const currentProvider = store.state.aiProvider?.currentProvider;
      if (currentProvider && currentProvider.toLowerCase() === 'local') {
        return true; // Local provider is always available
      }

      // Check if any AI provider is connected
      const connectedAiProviders = connectedApps.value.filter((app) => {
        const providerId = typeof app === 'string' ? app : app?.provider_id;
        if (!providerId) return false;
        const provider = allProviders.value.find((p) => p.id === providerId);
        if (!provider) return false;
        const categories = Array.isArray(provider.categories) ? provider.categories : provider.categories ? JSON.parse(provider.categories) : [];
        const lowerCategories = categories.map((cat) => cat.toLowerCase());
        return lowerCategories.includes('ai');
      });

      return connectedAiProviders.length > 0;
    });

    // Quick start options
    const quickStartOptions = [
      {
        screen: 'ChatScreen',
        icon: '💬',
        title: 'Start a Conversation',
        description: 'Chat with AI agents to automate your first task',
      },
      {
        screen: 'WorkflowForgeScreen',
        icon: '⚡',
        title: 'Build a Workflow',
        description: 'Create a custom automation workflow visually',
      },
      {
        screen: 'MarketplaceScreen',
        icon: '🏪',
        title: 'Explore Marketplace',
        description: 'Discover pre-built agents, tools, and workflows',
      },
      {
        screen: 'SettingsScreen',
        icon: '📊',
        title: 'View Profile',
        description: 'See your stats, progress, and $AGNT score',
      },
    ];

    const selectedStartOption = computed(() => {
      return quickStartOptions.find((opt) => opt.screen === selectedStartScreen.value);
    });

    // Computed
    const totalSteps = computed(() => {
      let steps = 6; // Base steps: Welcome, Theme, Profile, Features, Quick Start, Ready
      if (!hasAiProvider.value) steps++; // Add provider setup step
      if (hasReferralBonus.value) steps++; // Add referral bonus step
      return steps;
    });
    const finalStep = computed(() => totalSteps.value);
    const referrerName = ref(null);

    // Methods
    const nextStep = () => {
      if (currentStep.value < totalSteps.value) {
        transitionName.value = 'slide-left';
        currentStep.value++;
      }
    };

    const prevStep = () => {
      if (currentStep.value > 1) {
        transitionName.value = 'slide-right';
        currentStep.value--;
      }
    };

    const complete = () => {
      // Save pseudonym if changed
      if (pseudonym.value && pseudonym.value !== userPseudonym.value) {
        // TODO: Save pseudonym to backend
        console.log('Saving pseudonym:', pseudonym.value);
      }

      emit('complete', selectedStartScreen.value);
    };

    const checkPseudonymAvailability = async () => {
      // Clear previous timeout
      if (checkTimeout) {
        clearTimeout(checkTimeout);
      }

      const trimmedPseudonym = pseudonym.value.trim();

      // If empty, clear status
      if (!trimmedPseudonym) {
        pseudonymStatus.value = null;
        return;
      }

      // If it's the current pseudonym, mark as current
      if (trimmedPseudonym === userPseudonym.value) {
        pseudonymStatus.value = 'current';
        return;
      }

      // Set checking status
      pseudonymStatus.value = 'checking';

      // Debounce the API call
      checkTimeout = setTimeout(async () => {
        try {
          const token = store.state.userAuth.token;

          // Use the same endpoint as ProfileSection - check if pseudonym is available
          const response = await fetch(`${API_CONFIG.REMOTE_URL}/referrals/check-availability`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              pseudonym: trimmedPseudonym,
            }),
          });

          // Check if response is ok before parsing
          if (!response.ok) {
            console.warn('Pseudonym check endpoint not available, assuming available');
            pseudonymStatus.value = 'available';
            return;
          }

          const contentType = response.headers.get('content-type');
          if (!contentType || !contentType.includes('application/json')) {
            console.warn('Pseudonym check endpoint returned non-JSON, assuming available');
            pseudonymStatus.value = 'available';
            return;
          }

          const data = await response.json();

          // The endpoint returns { available: true/false }
          if (data.available) {
            pseudonymStatus.value = 'available';
          } else {
            pseudonymStatus.value = 'taken';
          }
        } catch (error) {
          console.error('Error checking pseudonym availability:', error);
          // On error, assume available (graceful degradation)
          pseudonymStatus.value = 'available';
        }
      }, 500); // 500ms debounce
    };

    // Map provider ID to the correct case used in the store
    const getProviderCase = (providerId) => {
      const providerMap = {
        anthropic: 'Anthropic',
        openai: 'OpenAI',
        'openai-codex': 'OpenAI-Codex',
        'openai-codex-cli': 'OpenAI-Codex-CLI',
        gemini: 'Gemini',
        grokai: 'GrokAI',
        groq: 'Groq',
        local: 'Local',
        openrouter: 'OpenRouter',
        togetherai: 'TogetherAI',
      };
      return providerMap[providerId.toLowerCase()] || providerId;
    };

    const showAlert = async (title, message) => {
      await modal.value.showModal({
        title,
        message,
        confirmText: 'OK',
        showCancel: false,
      });
    };

    const showPrompt = async (title, message, defaultValue = '') => {
      const result = await modal.value.showModal({
        title,
        message,
        isPrompt: true,
        inputType: 'password',
        placeholder: defaultValue,
        defaultValue: defaultValue,
        confirmText: 'Connect',
        cancelText: 'Cancel',
        confirmClass: 'btn-primary',
        cancelClass: 'btn-secondary',
        showCancel: true,
      });
      return result === null ? null : result || defaultValue;
    };

    const isProviderConnected = (providerId) => {
      const lower = providerId.toLowerCase();
      return connectedApps.value.some((app) => app.toLowerCase() === lower);
    };

    const selectProvider = async (provider) => {
      const correctCase = getProviderCase(provider.id);
      await store.dispatch('aiProvider/setProvider', correctCase);
    };

    const handleProviderClick = async (provider) => {
      // Local provider doesn't require authentication - just set it directly
      if (provider.id.toLowerCase() === 'local') {
        await selectProvider(provider);
        await showAlert('Success', `${provider.name} provider selected successfully!`);
        return;
      }

      // OpenAI Codex providers use a local device auth flow via the Codex CLI.
      const providerLower = provider.id.toLowerCase();
      if (providerLower === 'openai-codex' || providerLower === 'openai-codex-cli') {
        await connectCodexProvider(provider);
        return;
      }

      // If already connected, just select it.
      if (isProviderConnected(provider.id)) {
        await selectProvider(provider);
        await showAlert('Provider Ready', `${provider.name} is already connected on this machine.`);
        return;
      }

      const connectionType = provider.connectionType || provider.connection_type;

      if (connectionType === 'oauth') {
        await connectOAuthApp(provider);
      } else if (connectionType === 'apikey') {
        await promptApiKey(provider);
      } else {
        await showAlert('Configuration Required', `Please configure the connection type for ${provider.name} in the settings.`);
      }
    };

    const connectOAuthApp = async (provider) => {
      // Show instructions before connecting
      if (provider.instructions) {
        const proceed = await modal.value.showModal({
          title: `Connect to ${provider.name}`,
          message: provider.instructions,
          confirmText: 'Continue',
          cancelText: 'Cancel',
          confirmClass: 'btn-primary',
          showCancel: true,
        });

        if (!proceed) return;
      }

      try {
        const token = localStorage.getItem('token');
        // Pass origin as query parameter for reliable Electron support
        const response = await fetch(`${API_CONFIG.REMOTE_URL}/auth/connect/${provider.id}?origin=${encodeURIComponent(window.location.origin)}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        if (data.authUrl) {
          window.location.href = data.authUrl;
        } else {
          throw new Error('No authUrl provided in the response');
        }
      } catch (error) {
        console.error(`Error connecting to ${provider.name}:`, error);
        await showAlert('Connection Error', `Failed to connect to ${provider.name}: ${error.message}`);
      }
    };

    const connectCodexProvider = async (provider) => {
      try {
        const providerLower = provider.id.toLowerCase();
        const isCliProvider = providerLower === 'openai-codex-cli';
        const status = await store.dispatch('appAuth/fetchCodexStatus');
        if (status?.available && (isCliProvider || status?.apiUsable)) {
          await selectProvider(provider);
          const readyMessage = isCliProvider
            ? 'OpenAI Codex CLI is already connected on this machine.'
            : 'OpenAI Codex is already connected and API access is available.';
          await showAlert('Provider Ready', readyMessage);
          return;
        }

        const session = await store.dispatch('appAuth/startCodexDeviceAuth');
        if (!session?.success) {
          throw new Error(session?.error || 'Failed to start Codex device login');
        }

        if (session.state === 'error') {
          await showAlert('Codex Device Login', session.message || 'Codex device login failed to start.');
          return;
        }

        const deviceUrl = session.deviceUrl || 'https://auth.openai.com/codex/device';
        const deviceCode = session.deviceCode || '(code unavailable)';

        if (!session.deviceUrl || !session.deviceCode) {
          await showAlert('Codex Device Login', session.message || 'Device code was not returned yet. Please try again in a moment.');
          return;
        }

        const confirmed = await modal.value.showModal({
          title: 'OpenAI Codex Device Login',
          message: `
            <div style="text-align:left">
              <p><strong>1.</strong> Open this URL in your browser:</p>
              <p><code>${deviceUrl}</code></p>
              <p><strong>2.</strong> Enter this one-time code:</p>
              <p><code style="font-size:16px">${deviceCode}</code></p>
              <p>Then return here and click <strong>I have logged in</strong>.</p>
            </div>
          `,
          confirmText: 'I have logged in',
          cancelText: 'Cancel',
          showCancel: true,
          confirmClass: 'btn-primary',
        });

        if (!confirmed) return;

        const result = await store.dispatch('appAuth/pollCodexDeviceAuth', { sessionId: session.sessionId });
        if (result?.state === 'success') {
          const latestStatus = await store.dispatch('appAuth/fetchCodexStatus');
          const isReady = latestStatus?.available && (isCliProvider || latestStatus?.apiUsable);

          if (isReady) {
            await selectProvider(provider);
            const successMessage = isCliProvider ? 'OpenAI Codex CLI connected successfully.' : 'OpenAI Codex connected successfully.';
            await showAlert('Success', successMessage);
            return;
          }

          const hint = latestStatus?.hint ? `\n\n${latestStatus.hint}` : '';
          const suggestion = isCliProvider ? '' : '\n\nTip: If you do not have OpenAI API access, use the OpenAI Codex CLI provider instead.';
          await showAlert('Codex Not Ready', `Device login completed but the provider is not ready yet.${hint}${suggestion}`);
        } else {
          const latestStatus = await store.dispatch('appAuth/fetchCodexStatus');
          const hint = latestStatus?.hint ? `\n\n${latestStatus.hint}` : '';
          await showAlert('Codex Not Ready', `${result?.message || 'Device login not completed yet.'}${hint}`);
        }
      } catch (error) {
        console.error('Error connecting OpenAI Codex:', error);
        await showAlert('Connection Error', `Failed to connect OpenAI Codex: ${error.message}`);
      }
    };

    const promptApiKey = async (provider) => {
      const promptMessage = provider.instructions || provider.custom_prompt || `Enter API Key for ${provider.name}:`;
      const apiKey = await showPrompt(`Connect to ${provider.name}`, promptMessage, '');

      if (apiKey) {
        await saveApiKey(provider, apiKey);
      }
    };

    const saveApiKey = async (provider, apiKey) => {
      try {
        const token = localStorage.getItem('token');
        const encryptedApiKey = encrypt(apiKey);

        const response = await fetch(`${API_CONFIG.REMOTE_URL}/auth/apikeys/${provider.id}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ apiKey: encryptedApiKey }),
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        if (result.success) {
          await showAlert('Success', `API key for ${provider.name} saved successfully!`);

          // Update connected apps
          await store.dispatch('appAuth/fetchConnectedApps');

          // Set this as the selected AI provider with correct case
          const correctCase = getProviderCase(provider.id);
          await store.dispatch('aiProvider/setProvider', correctCase);
        } else {
          throw new Error(result.message || 'Failed to save API key');
        }
      } catch (error) {
        console.error(`Error saving API key for ${provider.name}:`, error);
        await showAlert('Error', `Failed to save API key for ${provider.name}: ${error.message}`);
      }
    };

    const handleSkip = async () => {
      // Safety check for modal ref
      if (!modal.value) {
        console.error('Modal ref not available');
        return;
      }

      const confirmed = await modal.value.showModal({
        title: 'Skip Onboarding?',
        message: 'Are you sure you want to skip the tour?<br/>You can always restart it from Tour Settings.',
        confirmText: 'Skip Tour',
        cancelText: 'Continue Tour',
        showCancel: true,
        confirmClass: 'btn-danger',
      });

      if (confirmed) {
        emit('skip');
      }
    };

    // Watch for userPseudonym changes and populate the field
    watch(
      userPseudonym,
      (newValue) => {
        if (newValue && !pseudonym.value) {
          pseudonym.value = newValue;
          // Set status to current since it's their existing pseudonym
          pseudonymStatus.value = 'current';
        }
      },
      { immediate: true },
    );

    // Fetch referrer info if has bonus
    onMounted(async () => {
      // Fetch providers if not already loaded
      if (allProviders.value.length === 0) {
        await store.dispatch('appAuth/fetchAllProviders');
      }

      // Fetch connected apps to check provider status
      await store.dispatch('appAuth/fetchConnectedApps');

      // ALWAYS fetch pseudonym to ensure it's loaded
      await store.dispatch('userAuth/fetchPseudonym');

      // Initialize pseudonym field with the fetched value
      if (userPseudonym.value) {
        pseudonym.value = userPseudonym.value;
        pseudonymStatus.value = 'current';
      }

      if (hasReferralBonus.value) {
        try {
          // Try to get referrer info from referral tree
          await store.dispatch('userStats/fetchReferralTree');
          // The referrer would be in the tree data if available
          // For now, we'll just show the bonus without the referrer name
        } catch (error) {
          console.error('Failed to fetch referrer info:', error);
        }
      }
    });

    return {
      modal,
      currentStep,
      totalSteps,
      finalStep,
      userName,
      pseudonym,
      pseudonymStatus,
      selectedStartScreen,
      quickStartOptions,
      selectedStartOption,
      hasReferralBonus,
      referralBalance,
      referrerName,
      transitionName,
      aiProviders,
      hasAiProvider,
      currentTheme,
      availableThemes,
      selectTheme,
      nextStep,
      prevStep,
      complete,
      handleSkip,
      handleProviderClick,
      checkPseudonymAvailability,
      PROVIDER_DISPLAY_NAMES,
    };
  },
};
</script>

<style scoped>
.onboarding-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.85);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 99;
  padding: 20px;
}

.onboarding-modal {
  background: var(--color-background);
  border: 1px solid var(--terminal-border-color);
  border-radius: 24px;
  padding: 48px;
  max-width: 700px;
  width: 100%;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  position: relative;
}

/* Progress Dots */
.progress-dots {
  display: flex;
  justify-content: center;
  gap: 12px;
  margin-bottom: 40px;
}

.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--color-darker-2);
  transition: all 0.3s ease;
}

.dot.active {
  background: var(--color-primary);
  transform: scale(1.3);
  box-shadow: 0 0 12px rgba(var(--primary-rgb), 0.25);
}

.dot.completed {
  background: var(--color-primary);
  opacity: 0.5;
}

/* Step Content */
.step-content {
  min-height: 400px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.step {
  text-align: center;
  width: 100%;
}

.step h1 {
  font-size: 2.2em;
  margin: 24px 0 12px;
  /* background: linear-gradient(135deg, var(--color-text) 0%, var(--color-primary) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text; */
}

.step h2 {
  font-size: 1.8em;
  margin: 24px 0 12px;
  color: var(--color-text);
}

.subtitle {
  font-size: 1.1em;
  color: var(--color-text-muted);
  margin-bottom: 16px;
}

.description {
  font-size: 1em;
  color: var(--color-text-muted);
  opacity: 0.8;
  line-height: 1.6;
}

/* Welcome Step */
.logo-large {
  width: 120px;
  height: 120px;
  animation: float 3s ease-in-out infinite;
}

@keyframes float {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-10px);
  }
}

/* Profile Step */
.icon-circle {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: var(--color-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 24px;
  color: #ffffff;
}

.input-group {
  margin-top: 32px;
  text-align: left;
  max-width: 400px;
  margin-left: auto;
  margin-right: auto;
}

.input-group label {
  display: block;
  font-size: 0.9em;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-text-muted);
  margin-bottom: 8px;
}

.input-group input {
  width: 100%;
  padding: 12px 16px;
  font-size: 1.1em;
  font-family: var(--font-family-primary);
  background: var(--color-dark-navy);
  border: 1px solid var(--terminal-border-color);
  border-radius: 12px;
  color: var(--color-text);
  transition: all 0.2s ease;
}

.input-group input:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px rgba(var(--primary-rgb), 0.2);
}

.input-with-status {
  position: relative;
  display: flex;
  align-items: center;
}

.input-with-status input {
  padding-right: 48px;
}

.status-indicator {
  position: absolute;
  right: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  font-size: 1.2em;
}

.status-indicator.checking {
  background: var(--color-darker-1);
}

.status-indicator.available,
.status-indicator.current {
  background: rgba(var(--primary-rgb), 0.2);
  color: var(--color-primary);
}

.status-indicator.taken {
  background: rgba(255, 0, 0, 0.2);
  color: var(--color-red);
}

.hint {
  font-size: 0.85em;
  color: var(--color-text-muted);
  opacity: 0.7;
  margin-top: 8px;
}

.hint.success {
  color: var(--color-primary);
  opacity: 1;
}

.hint.error {
  color: var(--color-red);
  opacity: 1;
}

/* Theme Step */
.theme-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  justify-content: center;
  margin-top: 28px;
  max-width: 460px;
  margin-left: auto;
  margin-right: auto;
}

.theme-tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 12px 8px;
  border: 2px solid var(--color-darker-2);
  border-radius: 12px;
  cursor: pointer;
  background: transparent;
  transition: all 0.2s ease;
  width: 96px;
  font-family: inherit;
}

.theme-tile:hover {
  border-color: var(--color-text-muted);
  background: var(--color-darker-0);
  transform: translateY(-2px);
}

.theme-tile.active {
  border-color: var(--color-primary);
  background: rgba(var(--primary-rgb), 0.1);
}

.theme-swatch {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: none;
}

.swatch-dark {
  background: #10101f;
}
.swatch-cyberpunk {
  background: #0b0b30;
}
.swatch-midnight {
  background: #080818;
}
.swatch-ember {
  background: #120c08;
}
.swatch-nord {
  background: #2e3440;
}
.swatch-hacker {
  background: #000000;
}
.swatch-light {
  background: #f1f0f5;
}
.swatch-rose {
  background: #faf4f4;
}

.theme-tile-name {
  font-size: 0.85em;
  font-weight: 500;
  color: var(--color-text);
}

/* Provider Step */
.provider-grid {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  flex-direction: row;
  align-content: flex-start;
  justify-content: center;
  align-items: flex-start;
  margin-top: 24px;
  max-width: 500px;
  margin-left: auto;
  margin-right: auto;
}

.provider-tile {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  border: 3px solid var(--color-text-muted);
  border-radius: 8px;
  min-width: 80px;
  min-height: 80px;
  justify-content: center;
  cursor: pointer;
  background: transparent;
  padding: 8px;
  font-family: inherit;
  transition: all 0.3s ease;
}

.provider-tile:focus {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.provider-tile:active {
  transform: translateY(0);
}

.provider-tile:hover {
  background: var(--color-darker-1);
  transform: translateY(-2px);
  border-color: rgba(var(--primary-rgb), 0.3);
}

.provider-icon :deep(svg) {
  width: 32px;
  height: 32px;
  margin-bottom: 3px;
}

.provider-name {
  margin-top: 4px;
  font-weight: 500;
  text-align: center;
  font-size: 0.9em;
  color: var(--color-text);
}

/* Features Step */
.features-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
  margin-top: 32px;
}

.feature-card {
  background: var(--color-darker-0);
  border: 1px solid var(--color-darker-1);
  border-radius: 16px;
  padding: 24px;
  transition: all 0.3s ease;
}

.feature-card:hover {
  background: var(--color-darker-1);
  border-color: var(--color-primary);
  transform: translateY(-2px);
}

.feature-icon {
  font-size: 2.5em;
  margin-bottom: 12px;
}

.feature-card h3 {
  font-size: 1.1em;
  margin-bottom: 8px;
  color: var(--color-text);
}

.feature-card p {
  font-size: 0.9em;
  color: var(--color-text-muted);
  opacity: 0.8;
  line-height: 1.4;
}

/* Quick Start Step */
.quickstart-options {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 32px;
}

.quickstart-option {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 20px;
  background: var(--color-darker-0);
  border: 2px solid var(--color-darker-1);
  border-radius: 16px;
  cursor: pointer;
  transition: all 0.3s ease;
  text-align: left;
}

.quickstart-option:hover {
  background: var(--color-darker-1);
  border-color: rgba(var(--primary-rgb), 0.3);
}

.quickstart-option.selected {
  background: rgba(var(--primary-rgb), 0.12);
  border-color: var(--color-primary);
}

.option-icon {
  font-size: 2em;
  flex-shrink: 0;
}

.option-content {
  flex: 1;
}

.option-content h3 {
  font-size: 1.1em;
  margin-bottom: 4px;
  color: var(--color-text);
}

.option-content p {
  font-size: 0.9em;
  color: var(--color-text-muted);
  opacity: 0.8;
}

.option-check {
  width: 24px;
  height: 24px;
  flex-shrink: 0;
}

/* Referral Step */
.celebration-icon {
  font-size: 4em;
  margin-bottom: 16px;
  animation: bounce 1s ease-in-out;
}

@keyframes bounce {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-20px);
  }
}

.bonus-display {
  background: rgba(var(--primary-rgb), 0.12);
  border: 2px solid var(--color-primary);
  border-radius: 16px;
  padding: 32px;
  margin: 24px 0;
}

.bonus-amount {
  font-size: 3em;
  font-weight: 700;
  color: var(--color-primary);
  margin-bottom: 8px;
}

.bonus-label {
  font-size: 1.1em;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

/* Ready Step */
.success-icon {
  margin-bottom: 24px;
  animation: scaleIn 0.5s ease-out;
}

@keyframes scaleIn {
  0% {
    transform: scale(0);
  }
  50% {
    transform: scale(1.1);
  }
  100% {
    transform: scale(1);
  }
}

.ready-summary {
  background: var(--color-darker-0);
  border: 1px solid var(--color-darker-1);
  border-radius: 16px;
  padding: 24px;
  margin-top: 32px;
  text-align: left;
}

.summary-item {
  display: flex;
  justify-content: space-between;
  padding: 12px 0;
  border-bottom: 1px solid var(--color-darker-0);
}

.summary-item:last-child {
  border-bottom: none;
}

.summary-label {
  color: var(--color-text-muted);
  font-size: 0.95em;
}

.summary-value {
  color: var(--color-text);
  font-weight: 600;
}

/* Modal Actions */
.modal-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  margin-top: 40px;
  padding-top: 32px;
  border-top: 1px solid var(--color-darker-1);
}

.spacer {
  flex: 1;
}

.btn-primary,
.btn-secondary,
.btn-text {
  padding: 12px 24px;
  border-radius: 999px;
  font-family: var(--font-family-primary);
  font-size: 1em;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  border: none;
}

.btn-primary {
  background: var(--color-primary);
  color: #ffffff;
}

.btn-primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(var(--primary-rgb), 0.3);
}

.btn-primary.btn-large {
  padding: 16px 48px;
  font-size: 1.2em;
}

.btn-secondary {
  background: transparent;
  border: 1px solid var(--terminal-border-color);
  color: var(--color-text);
}

.btn-secondary:hover {
  background: var(--color-darker-0);
  border-color: var(--color-text-muted);
}

.btn-text {
  background: transparent;
  color: var(--color-text-muted);
  padding: 12px 16px;
}

.btn-text:hover {
  color: var(--color-text);
}

/* Transitions */
.modal-fade-enter-active {
  transition: opacity 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}

.modal-fade-leave-active {
  transition: opacity 0.25s ease-out;
}

.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}

.modal-fade-enter-active .onboarding-modal {
  animation: modal-scale-in 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}

.modal-fade-leave-active .onboarding-modal {
  animation: modal-scale-out 0.25s ease-out forwards;
}

@keyframes modal-scale-in {
  0% {
    transform: scale(0.95) translateY(10px);
    opacity: 0;
  }
  100% {
    transform: scale(1) translateY(0);
    opacity: 1;
  }
}

@keyframes modal-scale-out {
  0% {
    transform: scale(1) translateY(0);
    opacity: 1;
  }
  100% {
    transform: scale(0.97) translateY(8px);
    opacity: 0;
  }
}

.slide-left-enter-active,
.slide-left-leave-active,
.slide-right-enter-active,
.slide-right-leave-active {
  transition: all 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94);
}

.slide-left-enter-from {
  opacity: 0;
  transform: translateX(20px);
}

.slide-left-leave-to {
  opacity: 0;
  transform: translateX(-20px);
}

.slide-right-enter-from {
  opacity: 0;
  transform: translateX(-20px);
}

.slide-right-leave-to {
  opacity: 0;
  transform: translateX(20px);
}

/* Responsive */
@media (max-width: 768px) {
  .onboarding-modal {
    padding: 32px 24px;
  }

  .features-grid {
    grid-template-columns: 1fr;
  }

  .step h1 {
    font-size: 1.8em;
  }

  .step h2 {
    font-size: 1.5em;
  }

  .theme-grid {
    max-width: 100%;
  }

  .theme-tile {
    width: 80px;
    padding: 10px 6px;
  }

  .modal-actions {
    flex-wrap: wrap;
  }
}
</style>
