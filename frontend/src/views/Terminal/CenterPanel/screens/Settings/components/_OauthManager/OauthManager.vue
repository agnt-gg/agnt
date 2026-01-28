<template>
  <div class="auth-manager">
    <h2>App Integrations</h2>

    <div class="search-bar">
      <input type="text" v-model="searchQuery" placeholder="Search connected apps..." @input="searchApps" />
    </div>

    <!-- Category Selector -->
    <!-- <div class="categories">
      <template v-for="(category, index) in categories" :key="category">
        <button
          @click="selectCategory(category)"
          :class="{ active: selectedCategory === category }"
        >
          {{ category }}
        </button>
        <span v-if="index < categories.length - 1" class="category-separator"
          >|</span
        >
      </template>
    </div> -->

    <!-- App Grid -->
    <div class="all-apps">
      <!-- <h3>{{ categoryHeading }}</h3> -->
      <div class="app-grid" ref="appGrid" @scroll="handleScroll">
        <div v-for="app in visibleApps" :key="app.id" class="app-item" :class="{ connected: app.connected }">
          <div class="app-item-inner" @click="handleAppClick(app)">
            <div class="app-icon" :title="app.instructions">
              <SvgIcon :name="app.icon" />
            </div>
            <span :title="app.instructions">{{ app.name }}</span>
            <span v-if="app.connected" class="connected-status">Connected</span>
          </div>
          <!-- <div class="app-actions">
            <button @click="editProvider(app)">Edit</button>
            <button @click="deleteProvider(app.id)">Delete</button>
          </div> -->
        </div>
      </div>
    </div>

    <!-- <div class="provider-form">
      <button @click="showAddProviderForm = true">Add New Provider</button>

      <ProviderForm
        v-if="showAddProviderForm"
        @provider-added="handleProviderAdded"
      />

      <ProviderForm
        v-if="editingProvider"
        :provider="editingProvider"
        @provider-updated="handleProviderUpdated"
      />
    </div> -->
    <SimpleModal ref="modal" />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useStore, mapActions } from 'vuex';
import SvgIcon from '@/views/_components/common/SvgIcon.vue';
import { API_CONFIG, AI_PROVIDERS_CONFIG } from '@/tt.config.js';
import { useRoute, useRouter } from 'vue-router';
import { encrypt, decrypt } from '@/views/_utils/encryption.js';
import ProviderForm from './components/ProviderForm/ProviderForm.vue';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';

const store = useStore();
const route = useRoute();
const router = useRouter();

const searchQuery = ref('');
const selectedCategory = ref('All');
const categories = computed(() => {
  const categorySet = new Set(allApps.value.flatMap((app) => app.categories));
  return ['All', ...Array.from(categorySet).sort()];
});

const categoryHeading = computed(() => {
  if (selectedCategory.value === 'All') {
    return 'All Apps';
  } else {
    return `${selectedCategory.value} Apps`;
  }
});

const allApps = ref([]);

const appGrid = ref(null);
const loadingMore = ref(false);

const currentPage = ref(1);
const appsPerPage = 20;

const showAddProviderForm = ref(false);
const editingProvider = ref(null);

const modal = ref(null);

const filteredApps = computed(() => {
  return allApps.value.filter(
    (app) =>
      (selectedCategory.value === 'All' || app.categories.includes(selectedCategory.value)) &&
      app.name.toLowerCase().includes(searchQuery.value.toLowerCase())
  );
});

const visibleApps = computed(() => {
  return filteredApps.value.sort((a, b) => {
    if (a.connected === b.connected) {
      return a.name.localeCompare(b.name);
    }
    return a.connected ? -1 : 1;
  });
});

const showAlert = async (title, message) => {
  await modal.value.showModal({
    title,
    message,
    confirmText: 'OK',
    showCancel: false,
  });
};

const safeParseCategories = (input) => {
  if (!input) return [];
  if (Array.isArray(input)) return input;
  try {
    const parsed = JSON.parse(input);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const buildAiProviderFallbacks = () => {
  const defaults = {
    Anthropic: {
      id: 'anthropic',
      icon: 'anthropic',
      connectionType: 'apikey',
      instructions: 'Enter your Anthropic API key.',
    },
    Cerebras: {
      id: 'cerebras',
      icon: 'cerebras',
      connectionType: 'apikey',
      instructions: 'Enter your Cerebras API key.',
    },
    DeepSeek: {
      id: 'deepseek',
      icon: 'deepseek',
      connectionType: 'apikey',
      instructions: 'Enter your DeepSeek API key.',
    },
    Gemini: {
      id: 'gemini',
      icon: 'api',
      connectionType: 'apikey',
      instructions: 'Enter your Gemini API key.',
    },
    GrokAI: {
      id: 'grokai',
      icon: 'grok-ai',
      connectionType: 'apikey',
      instructions: 'Enter your Grok API key.',
    },
    Groq: {
      id: 'groq',
      icon: 'groq',
      connectionType: 'apikey',
      instructions: 'Enter your Groq API key.',
    },
    Local: {
      id: 'local',
      icon: 'code',
      connectionType: 'local',
      instructions: 'Local provider does not require a connection. Select it in Default AI Provider.',
    },
    OpenAI: {
      id: 'openai',
      icon: 'openai',
      connectionType: 'apikey',
      instructions: 'Enter your OpenAI API key.',
    },
    'OpenAI-Codex-CLI': {
      id: 'openai-codex-cli',
      icon: 'openai',
      connectionType: 'oauth',
      instructions:
        'Uses Codex CLI locally (no API key). You will be given a URL and one-time code to complete sign-in.',
      localOnly: true,
    },
    'Kimi-Code': {
      id: 'kimi-code',
      icon: 'code',
      connectionType: 'apikey',
      instructions:
        'Enter your Kimi Code API key. This uses the OpenAI-compatible Kimi Code endpoint and the kimi-for-coding model.',
      localOnly: true,
    },
    OpenRouter: {
      id: 'openrouter',
      icon: 'api',
      connectionType: 'apikey',
      instructions: 'Enter your OpenRouter API key.',
    },
    TogetherAI: {
      id: 'togetherai',
      icon: 'together-ai',
      connectionType: 'apikey',
      instructions: 'Enter your TogetherAI API key.',
    },
  };

  const providerNames = Array.isArray(AI_PROVIDERS_CONFIG?.providers) ? AI_PROVIDERS_CONFIG.providers : [];
  return providerNames.map((name) => {
    const def = defaults[name] || {};
    const fallbackId = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return {
      id: def.id || fallbackId,
      name,
      icon: def.icon || 'api',
      categories: ['AI'],
      connectionType: def.connectionType || 'apikey',
      instructions: def.instructions || `Enter API key for ${name}.`,
      localOnly: def.localOnly || false,
    };
  });
};

const ensureLocalProviders = () => {
  const fallbacks = buildAiProviderFallbacks();
  if (!allApps.value.length) {
    allApps.value = fallbacks;
    return;
  }

  const existing = new Set(allApps.value.map((app) => String(app.id).toLowerCase()));
  for (const provider of fallbacks) {
    if (!existing.has(String(provider.id).toLowerCase())) {
      allApps.value.push(provider);
    }
  }
};

const syncProvidersFromStore = () => {
  const providers = Array.isArray(store.state.appAuth.allProviders) ? store.state.appAuth.allProviders : [];
  const connected = Array.isArray(store.state.appAuth.connectedApps) ? store.state.appAuth.connectedApps : [];

  allApps.value = providers.map((provider) => {
    const categories = safeParseCategories(provider.categories);
    const isConnected = connected.some((id) => String(id).toLowerCase() === String(provider.id).toLowerCase());

    return {
      ...provider,
      categories,
      connected: isConnected,
      connectionType: provider.connectionType || provider.connection_type,
      instructions: provider.instructions,
      custom_prompt: provider.custom_prompt,
    };
  });

  ensureLocalProviders();
};

const fetchAuthProviders = async () => {
  try {
    await store.dispatch('appAuth/fetchAllProviders');
    await store.dispatch('appAuth/fetchConnectedApps');
    syncProvidersFromStore();
  } catch (error) {
    console.error('Error fetching auth providers:', error);
    // Fall back to whatever the store currently has.
    syncProvidersFromStore();
  }
};

const handleScroll = () => {
  if (loadingMore.value) return;

  const grid = appGrid.value;
  if (!grid) return;

  const bottomOfGrid = grid.scrollTop + grid.clientHeight;
  const totalHeight = grid.scrollHeight;

  if (bottomOfGrid >= totalHeight - 100) {
    loadMoreApps();
  }
};

const loadMoreApps = () => {
  if (currentPage.value * appsPerPage < visibleApps.value.length) {
    currentPage.value++;
  }
};

const searchApps = () => {
  currentPage.value = 1;
};

const selectCategory = (category) => {
  selectedCategory.value = category;
  searchApps();
};

const handleAppClick = (app) => {
  console.log('Handling app click:', app);
  const appLower = String(app.id || '').toLowerCase();

  if (appLower === 'openai-codex' || appLower === 'openai-codex-cli') {
    connectCodexProvider(app);
    return;
  }
  if (appLower === 'kimi-code') {
    promptApiKey(app);
    return;
  }
  if (appLower === 'local' || app.connectionType === 'local') {
    showAlert('Local Provider', 'Local models do not require a connection. Select Local in Default AI Provider.');
    return;
  }

  if (app.connected) {
    disconnectApp(app);
  } else if (app.connectionType === 'oauth') {
    connectOAuthApp(app);
  } else if (app.connectionType === 'apikey') {
    promptApiKey(app);
  } else {
    console.log('Unsupported app type:', app.connectionType);
  }
};

const connectOAuthApp = async (app) => {
  // Show instructions before connecting
  if (app.instructions) {
    const proceed = await modal.value.showModal({
      title: `Connect to ${app.name}`,
      message: app.instructions,
      confirmText: 'Continue',
      cancelText: 'Cancel',
      confirmClass: 'btn-primary',
    });

    if (!proceed) return;
  }

  try {
    const token = localStorage.getItem('token');
    // Pass origin as query parameter for reliable Electron support
    const response = await fetch(`${API_CONFIG.REMOTE_URL}/auth/connect/${app.id}?origin=${encodeURIComponent(window.location.origin)}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    console.log('OAuth connect response:', data);
    if (data.authUrl) {
      console.log('Redirecting to:', data.authUrl);
      window.location.href = data.authUrl;
    } else {
      console.error('No authUrl provided in the response');
    }
  } catch (error) {
    console.error(`Error connecting to ${app.name}:`, error);
    await showAlert('Connection Error', `Failed to connect to ${app.name}: ${error.message}`);
  }
};

const disconnectApp = async (app) => {
  const confirmDisconnect = await modal.value.showModal({
    title: 'Confirm Disconnection',
    message: `Are you sure you want to disconnect from ${app.name}?`,
    confirmText: 'Disconnect',
    cancelText: 'Cancel',
    confirmClass: 'btn-danger',
  });

  if (!confirmDisconnect) return;

  try {
    const token = localStorage.getItem('token');
    const appLower = String(app.id || '').toLowerCase();

    if (appLower === 'openai-codex' || appLower === 'openai-codex-cli') {
      const response = await fetch(`${API_CONFIG.BASE_URL}/codex/logout`, {
        method: 'POST',
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      if (data.success) {
        await showAlert('Success', `Successfully disconnected from ${app.name}`);
        await store.dispatch('appAuth/fetchConnectedApps');
        syncProvidersFromStore();
        return;
      }
      throw new Error(data.message || 'Disconnection failed');
    }

    if (appLower === 'kimi-code') {
      const response = await fetch(`${API_CONFIG.BASE_URL}/kimi-code/apikey`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      if (data.success) {
        await showAlert('Success', `Successfully disconnected from ${app.name}`);
        await store.dispatch('appAuth/fetchConnectedApps');
        syncProvidersFromStore();
        return;
      }
      throw new Error(data.message || 'Disconnection failed');
    }

    const response = await fetch(`${API_CONFIG.REMOTE_URL}/auth/disconnect/${app.id}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    if (data.success) {
      app.connected = false;
      await showAlert('Success', `Successfully disconnected from ${app.name}`);
    } else {
      throw new Error('Disconnection failed');
    }
  } catch (error) {
    console.error(`Error disconnecting from ${app.name}:`, error);
    await showAlert('Disconnection Error', `Failed to disconnect from ${app.name}: ${error.message}`);
  }
};

const promptApiKey = async (app) => {
  console.log('promptApiKey called with app:', app);
  console.log('app.instructions:', app.instructions);
  console.log('app.custom_prompt:', app.custom_prompt);

  // Use instructions as the message, or fall back to custom_prompt or default
  const promptMessage = app.instructions || app.custom_prompt || `Enter API Key for ${app.name}:`;
  console.log('Final promptMessage:', promptMessage);

  const apiKey = await showPrompt(`Connect to ${app.name}`, promptMessage, '', {
    confirmText: 'Save',
    cancelText: 'Cancel',
    confirmClass: 'btn-primary',
    cancelClass: 'btn-secondary',
  });

  if (apiKey) {
    await saveApiKey(app, apiKey);
  }
};

const showPrompt = async (title, message, defaultValue = '', options = {}) => {
  const result = await modal.value.showModal({
    title,
    message,
    isPrompt: true,
    isTextArea: options.isTextArea || false,
    placeholder: defaultValue,
    defaultValue: defaultValue,
    confirmText: options.confirmText || 'Save',
    cancelText: options.cancelText || 'Cancel',
    confirmClass: options.confirmClass || 'btn-primary',
    cancelClass: options.cancelClass || 'btn-secondary',
    showCancel: options.showCancel !== undefined ? options.showCancel : true,
  });
  return result === null ? null : result || defaultValue;
};

const saveApiKey = async (app, apiKey) => {
  try {
    const token = localStorage.getItem('token');
    const encryptedApiKey = apiKey;
    const appLower = String(app.id || '').toLowerCase();

    if (appLower === 'kimi-code') {
      const response = await fetch(`${API_CONFIG.BASE_URL}/kimi-code/apikey`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ apiKey }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      if (result.success) {
        await showAlert('Success', `API key for ${app.name} saved successfully!`);
        await store.dispatch('appAuth/fetchConnectedApps');
        syncProvidersFromStore();
        return;
      }

      throw new Error(result.message || 'Failed to save API key');
    }

    const response = await fetch(`${API_CONFIG.REMOTE_URL}/auth/apikeys/${app.id}`, {
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
      app.connected = true;
      await showAlert('Success', `API key for ${app.name} saved successfully!`);
    } else {
      throw new Error(result.message || 'Failed to save API key');
    }
  } catch (error) {
    console.error(`Error saving API key for ${app.name}:`, error);
    await showAlert('Error', `Failed to save API key for ${app.name}: ${error.message}`);
  }
};

const completeOAuth = async (code, state, provider) => {
  try {
    const token = localStorage.getItem('token');

    // Split state into its components
    const stateParts = state.split(':');
    const providerId = stateParts[0]; // Take the first part as provider

    const response = await fetch(`${API_CONFIG.REMOTE_URL}/auth/callback`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        code,
        state, // Send the entire state string
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    if (data.success) {
      const app = allApps.value.find((a) => a.id === data.provider);
      if (app) {
        app.connected = true;
      }
      await fetchConnectedApps(); // Refresh the list of connected apps
      await showAlert('Success', `Successfully connected to ${data.provider}`);
    } else {
      throw new Error('OAuth completion failed');
    }
  } catch (error) {
    console.error('Error completing OAuth:', error);
    await showAlert('OAuth Error', `Failed to complete OAuth: ${error.message}`);
  }
};

const connectCodexProvider = async (provider) => {
  try {
    const providerLower = provider.id.toLowerCase();
    const isCliProvider = providerLower === 'openai-codex-cli';
    const status = await store.dispatch('appAuth/fetchCodexStatus');
    if (status?.available && (isCliProvider || status?.apiUsable)) {
      await showAlert('Provider Ready', `${provider.name} is already connected on this machine.`);
      await store.dispatch('appAuth/fetchConnectedApps');
      syncProvidersFromStore();
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
    const instructions = `
1. Open this URL in your browser:<br/><br/>
<strong>${deviceUrl}</strong><br/><br/>
2. Enter this one-time code:<br/><br/>
<strong>${deviceCode}</strong><br/><br/>
Then return here and click <strong>Continue</strong>.
    `;

    const confirmed = await modal.value.showModal({
      title: 'OpenAI Codex Device Login',
      message: instructions,
      confirmText: 'Continue',
      cancelText: 'Cancel',
      confirmClass: 'btn-primary',
      showCancel: true,
    });

    if (!confirmed) return;

    const result = await store.dispatch('appAuth/pollCodexDeviceAuth', { sessionId: session.sessionId });
    if (result?.state === 'success') {
      await showAlert('Success', `${provider.name} connected successfully.`);
      await store.dispatch('appAuth/fetchConnectedApps');
      syncProvidersFromStore();
      return;
    }

    const latestStatus = await store.dispatch('appAuth/fetchCodexStatus');
    const hint = latestStatus?.hint ? `\n\n${latestStatus.hint}` : '';
    await showAlert('Codex Not Ready', `${result?.message || 'Device login not completed yet.'}${hint}`);
  } catch (error) {
    console.error('Error connecting OpenAI Codex:', error);
    await showAlert('Connection Error', `Failed to connect OpenAI Codex: ${error.message}`);
  }
};
const fetchConnectedApps = async () => {
  await store.dispatch('appAuth/fetchConnectedApps');
  const connectedApps = Array.isArray(store.state.appAuth.connectedApps) ? store.state.appAuth.connectedApps : [];
  const connectedSet = new Set(connectedApps.map((id) => String(id).toLowerCase()));
  allApps.value.forEach((app) => {
    app.connected = connectedSet.has(String(app.id).toLowerCase());
  });
};

const handleProviderAdded = (newProvider) => {
  const formattedProvider = {
    ...newProvider,
    connected: false,
  };
  allApps.value.push(formattedProvider);
  showAddProviderForm.value = false;
  console.log('Updated allApps:', allApps.value);
};

const handleProviderUpdated = (updatedProvider) => {
  const index = allApps.value.findIndex((app) => app.id === updatedProvider.id);
  if (index !== -1) {
    allApps.value[index] = updatedProvider;
  }
  editingProvider.value = null;
};

const editProvider = (provider) => {
  editingProvider.value = { ...provider };
};

const deleteProvider = async (providerId) => {
  const confirmDelete = await modal.value.showModal({
    title: 'Confirm Deletion',
    message: 'Are you sure you want to delete this provider?',
    confirmText: 'Delete',
    cancelText: 'Cancel',
    confirmClass: 'btn-danger',
  });

  if (!confirmDelete) return;

  try {
    const token = localStorage.getItem('token');
    const response = await fetch(`${API_CONFIG.REMOTE_URL}/auth/providers/${providerId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    allApps.value = allApps.value.filter((app) => app.id !== providerId);
  } catch (error) {
    console.error('Error deleting provider:', error);
    await showAlert('Deletion Error', 'Failed to delete provider. Please try again.');
  }
};

onMounted(async () => {
  await fetchAuthProviders();
  await fetchConnectedApps();
  loadMoreApps();
  window.addEventListener('resize', handleScroll);

  const code = route.query.code;
  const state = route.query.state;
  if (code && state) {
    const [provider, originalState] = state.split(':');
    if (provider && originalState) {
      completeOAuth(code, originalState, provider);
      router.replace({ query: {} });
    } else {
      console.error('Invalid state format');
    }
  }
});

onUnmounted(() => {
  window.removeEventListener('resize', handleScroll);
});
</script>

<style scoped>
.auth-manager {
  display: flex;
  flex-direction: column;
  flex-wrap: nowrap;
  align-content: flex-start;
  justify-content: flex-start;
  align-items: flex-start;
  gap: 16px;
}

.auth-manager h2,
.auth-manager h3 {
  padding-left: 1px;
}

.app-grid {
  display: flex;
  gap: 8px;
  max-height: 600px;
  overflow-y: auto;
  flex-wrap: wrap;
  flex-direction: row;
  align-content: flex-start;
  justify-content: flex-start;
  align-items: flex-start;
}

.app-item {
  display: flex;
  cursor: pointer;
  border: 3px solid transparent;
  padding: 8px 8px 2px;
  border-radius: 16px;
  transition: all 0.3s ease;
  flex-direction: column;
  flex-wrap: nowrap;
  align-content: center;
  align-items: center;
  justify-content: flex-start;
}

.app-item-inner {
  display: flex;
  flex-direction: column;
  flex-wrap: nowrap;
  align-content: center;
  justify-content: center;
  align-items: center;
}

.app-item:hover {
  background-color: rgba(0, 0, 0, 0.05);
}

body.dark .app-item:hover {
  background-color: rgba(255, 255, 255, 0.05);
}

.app-item.connected {
  border-color: var(--color-green);
}

.connected-status {
  color: var(--color-green);
  font-size: 0.6em;
  line-height: 100%;
}

.app-item :deep(svg) {
  width: 18px;
  height: 18px;
  margin-bottom: 3px;
}

.all-apps h3 {
  margin-bottom: 16px;
}

.categories {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  align-content: flex-start;
  justify-content: flex-start;
  align-items: center;
  gap: 8px;
}

.search-bar {
  width: 100%;
}

.categories button {
  padding: 4px 8px;
  border: 1px solid var(--color-light-navy);
  border-radius: 8px;
}

.categories button.active {
  outline: 2px solid var(--color-pink);
}

body.dark .categories button {
  border: 1px solid var(--color-dull-navy);
}

.category-separator {
  font-weight: normal;
  margin-top: 3px;
  opacity: 0.15;
}
</style>
