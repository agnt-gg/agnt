<template>
  <div class="provider-setup">
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
        <span class="provider-name">{{ provider.name }}</span>
      </button>
    </div>
    <SimpleModal ref="modal" />
  </div>
</template>

<script>
import { ref, computed, onMounted } from 'vue';
import { useStore } from 'vuex';
import SvgIcon from '@/views/_components/common/SvgIcon.vue';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import { API_CONFIG } from '@/tt.config.js';
import { encrypt } from '@/views/_utils/encryption.js';

export default {
  name: 'ProviderSetup',
  components: {
    SvgIcon,
    SimpleModal,
  },
  emits: ['provider-connected'],
  setup(props, { emit }) {
    const store = useStore();
    const modal = ref(null);

    const allProviders = computed(() => store.state.appAuth.allProviders || []);

    // Filter to only show AI providers
    const aiProviders = computed(() => {
      return allProviders.value
        .filter((p) => {
          const categories = Array.isArray(p.categories) ? p.categories : p.categories ? JSON.parse(p.categories) : [];
          // Convert all categories to lowercase for case-insensitive comparison
          const lowerCategories = categories.map((cat) => cat.toLowerCase());
          return lowerCategories.includes('ai');
        })
        .sort((a, b) => a.name.localeCompare(b.name));
    });

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

    // Map provider ID to the correct case used in the store
    const getProviderCase = (providerId) => {
      const providerMap = {
        anthropic: 'Anthropic',
        openai: 'OpenAI',
        gemini: 'Gemini',
        grokai: 'GrokAI',
        groq: 'Groq',
        local: 'Local',
        openrouter: 'OpenRouter',
        togetherai: 'TogetherAI',
      };
      return providerMap[providerId.toLowerCase()] || providerId;
    };

    const handleProviderClick = async (provider) => {
      // Local provider doesn't require authentication - just set it directly
      if (provider.id.toLowerCase() === 'local') {
        const correctCase = getProviderCase(provider.id);
        await store.dispatch('aiProvider/setProvider', correctCase);
        emit('provider-connected', provider);
        await showAlert('Success', `${provider.name} provider selected successfully!`);
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

          emit('provider-connected', provider);
        } else {
          throw new Error(result.message || 'Failed to save API key');
        }
      } catch (error) {
        console.error(`Error saving API key for ${provider.name}:`, error);
        await showAlert('Error', `Failed to save API key for ${provider.name}: ${error.message}`);
      }
    };

    onMounted(async () => {
      // Fetch providers if not already loaded
      if (allProviders.value.length === 0) {
        await store.dispatch('appAuth/fetchAllProviders');
      }
    });

    return {
      aiProviders,
      handleProviderClick,
      modal,
    };
  },
};
</script>

<style scoped>
.provider-setup {
  width: 100%;
}

.provider-grid {
  display: flex;
  gap: 6.4px;
  flex-wrap: wrap;
  flex-direction: row;
  align-content: flex-start;
  justify-content: flex-start;
  align-items: flex-start;
}

.provider-tile {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  border: 3px solid var(--color-text-muted);
  border-radius: 8px;
  /* transition: all 0.3s ease; */
  min-width: 80px;
  min-height: 80px;
  justify-content: center;
  cursor: pointer;
  background: transparent;
  padding: 8px;
  font-family: inherit;
}

.provider-tile:focus {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.provider-tile:active {
  transform: translateY(0);
}

.provider-tile:hover {
  background: rgba(127, 129, 147, 0.1);
  transform: translateY(-2px);
  border-color: rgba(25, 239, 131, 0.3);
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
</style>
