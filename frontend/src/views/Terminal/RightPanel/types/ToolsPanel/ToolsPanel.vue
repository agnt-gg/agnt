<template>
  <div class="tool-panel">
    <div v-if="selectedTool" class="tool-details">
      <div class="tool-header">
        <h2 class="tool-title">{{ selectedTool.title }}</h2>
        <div class="tool-type">[{{ selectedTool.type }}]</div>
      </div>

      <div class="tool-description">
        {{ selectedTool.description || 'No description available' }}
      </div>

      <div class="tool-config" v-if="selectedTool.config">
        <h3>Configuration</h3>
        <div class="config-list">
          <div v-for="(value, key) in selectedTool.config" :key="key" class="config-item">
            <span class="config-icon"><i class="fas fa-cog"></i></span>
            <span class="config-name">{{ key }}:</span>
            <span class="config-value">{{ formatConfigValue(value) }}</span>
          </div>
        </div>
      </div>

      <div class="tool-actions" v-if="isCustomTool">
        <BaseButton @click="showPublishModal = true" variant="primary" full-width>
          <i class="fas fa-store"></i>
          Publish to Marketplace
        </BaseButton>
      </div>
    </div>
    <div v-else class="no-tool-selected">
      <p>Select a tool to view details.</p>
      <BaseButton variant="primary" class="create-tool-button" @click="$emit('panel-action', 'navigate', 'ToolForgeScreen')">
        <i class="fas fa-plus"></i>
        Create New Tool
      </BaseButton>
    </div>

    <!-- Resources Section -->
    <ResourcesSection />

    <!-- Publish Tool Modal -->
    <MarketplaceFormModal
      :is-open="showPublishModal"
      mode="publish"
      item-type="tool"
      :item="selectedTool"
      :categories="toolCategories"
      :stripe-connected="stripeConnected"
      @close="showPublishModal = false"
      @submit="handlePublishTool"
      @setup-stripe="handleSetupStripe"
      @open-billing="handleOpenBilling"
    />

    <SimpleModal ref="simpleModal" />
  </div>
</template>

<script>
import { ref, computed, onMounted } from 'vue';
import { useStore } from 'vuex';
import { API_CONFIG } from '@/tt.config.js';
import BaseButton from '@/views/Terminal/_components/BaseButton.vue';
import ResourcesSection from '@/views/_components/common/ResourcesSection.vue';
import MarketplaceFormModal from '@/views/_components/common/MarketplaceFormModal.vue';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';

export default {
  name: 'ToolsPanel',
  components: { BaseButton, ResourcesSection, MarketplaceFormModal, SimpleModal },
  props: {
    selectedTool: {
      type: Object,
      default: null,
    },
  },
  emits: ['panel-action'],
  setup(props, { emit }) {
    const store = useStore();

    const formatConfigValue = (value) => {
      if (Array.isArray(value)) return value.join(', ');
      if (typeof value === 'object' && value !== null) return JSON.stringify(value);
      return value;
    };

    // Check if tool is custom (only custom tools can be published)
    const isCustomTool = computed(() => {
      return props.selectedTool && props.selectedTool.source === 'custom';
    });

    // Publishing
    const showPublishModal = ref(false);
    const stripeConnected = ref(false);
    const toolCategories = computed(() => store.getters['tools/toolCategories'] || []);
    const simpleModal = ref(null);

    // Check Stripe Connect status
    const checkStripeStatus = async () => {
      try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_CONFIG.REMOTE_URL}/marketplace/stripe/connect/status`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const data = await response.json();
        stripeConnected.value = data.exists && data.onboardingComplete;
      } catch (error) {
        console.error('Error checking Stripe status:', error);
      }
    };

    // Confetti animation
    const triggerConfetti = () => {
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

    onMounted(() => {
      checkStripeStatus();

      // Load confetti library if not already loaded
      if (!window.confetti) {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.2/dist/confetti.browser.min.js';
        document.head.appendChild(script);
      }
    });

    const handlePublishTool = async (publishData) => {
      try {
        // Add the full tool data
        publishData.asset_data = props.selectedTool;

        console.log('[DEBUG] Publishing tool with data:', publishData);

        // Publish to marketplace
        await store.dispatch('marketplace/publishWorkflow', publishData);
        showPublishModal.value = false;
        emit('panel-action', 'tool-published', publishData);

        // Trigger confetti
        triggerConfetti();

        // Show success message
        await simpleModal.value?.showModal({
          title: '🎉 Success! 🎉',
          message: 'Tool published successfully to marketplace!',
          confirmText: 'Awesome!',
          showCancel: false,
        });
      } catch (error) {
        console.error('Error publishing tool:', error);
        await simpleModal.value?.showModal({
          title: 'Error',
          message: `Failed to publish tool: ${error.message}`,
          confirmText: 'OK',
          showCancel: false,
        });
      }
    };

    const handleSetupStripe = async () => {
      try {
        const token = localStorage.getItem('token');
        const user = store.state.userAuth?.user;

        const response = await fetch(`${API_CONFIG.REMOTE_URL}/marketplace/stripe/connect`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            email: user?.email,
            return_url: window.location.origin + '/tools?stripe=success',
            refresh_url: window.location.origin + '/tools?stripe=refresh',
          }),
        });

        const data = await response.json();

        // Validate URL before opening
        if (!data.onboardingUrl || typeof data.onboardingUrl !== 'string' || !data.onboardingUrl.startsWith('http')) {
          console.error('Invalid onboarding URL received:', data.onboardingUrl);
          throw new Error('Invalid Stripe onboarding URL received from server');
        }

        // Open Stripe onboarding in external browser
        if (window.electron?.openExternalUrl) {
          window.electron.openExternalUrl(data.onboardingUrl);
        } else {
          window.open(data.onboardingUrl, '_blank');
        }
      } catch (error) {
        console.error('Error setting up Stripe:', error);
        await simpleModal.value?.showModal({
          title: 'Error',
          message: `Failed to set up Stripe Connect: ${error.message}`,
          confirmText: 'OK',
          showCancel: false,
        });
      }
    };

    const handleOpenBilling = () => {
      // Close the modal first
      showPublishModal.value = false;

      // Navigate to Settings screen
      emit('panel-action', 'navigate', 'SettingsScreen');

      // Set the billing section to be opened
      localStorage.setItem('settings-initial-section', 'billing');
    };

    return {
      formatConfigValue,
      isCustomTool,
      // Publishing
      showPublishModal,
      stripeConnected,
      toolCategories,
      handlePublishTool,
      handleSetupStripe,
      handleOpenBilling,
      simpleModal,
    };
  },
};
</script>

<style scoped>
.tool-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
  background: var(--color-background-soft);
  color: var(--color-text);
  min-height: 0;
}

.tool-details {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 15px;
  border: 1px solid var(--terminal-border-color-light);
  background: var(--color-darker-0);
}

.tool-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0;
  border-bottom: 1px solid var(--terminal-border-color-light);
  padding-bottom: 8px;
}

.tool-title {
  color: var(--color-green);
  font-size: 1.1em;
  margin: 0;
}

.tool-type {
  color: var(--color-text);
  font-size: 0.9em;
}

.tool-description {
  color: var(--color-text);
  font-size: 0.9em;
  line-height: 1.4;
}

.tool-config {
  margin-top: 15px;
  border-top: 1px dashed var(--terminal-border-color-light);
  padding-top: 15px;
}

h3 {
  color: var(--color-green);
  font-size: 1.1em;
  margin: 0 0 15px 0;
  border-bottom: 1px solid var(--terminal-border-color-light);
  padding-bottom: 8px;
}

.config-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
}

.config-item {
  background: var(--color-darker-0);
  padding: 12px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.config-icon {
  color: var(--color-light-green);
  width: 14px;
  text-align: center;
}

.config-name {
  color: var(--color-text);
  font-size: 0.9em;
}

.config-value {
  color: var(--color-light-green);
  font-size: 0.9em;
  text-align: right;
  margin-left: auto;
}

.no-tool-selected {
  text-align: center;
  color: var(--color-text);
  padding: 30px 15px;
  border: 1px dashed var(--terminal-border-color-light);
  background: var(--color-darker-0);
  border-radius: 4px;
  display: flex;
  flex-direction: column;
  height: fit-content;
}

.no-tool-selected p {
  font-style: italic;
  margin: 0 0 16px 0;
}

.create-tool-button {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.tool-actions {
  margin-top: 15px;
  border-top: 1px dashed var(--terminal-border-color-light);
  padding-top: 15px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.tool-actions .BaseButton i {
  margin-right: 6px;
}
</style>
