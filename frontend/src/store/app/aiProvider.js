import { API_CONFIG } from '@/tt.config.js';

// Map internal provider keys to user-facing display names where they differ
export const PROVIDER_DISPLAY_NAMES = {
  Minimax: 'MiniMax',
  ZAI: 'Z-AI',
  minimax: 'MiniMax',
  zai: 'Z-AI',
};

// Single source of truth for AI providers that require API keys (excludes 'Local')
export const AI_PROVIDERS_WITH_API = [
  'anthropic',
  'cerebras',
  'claude-code',
  'deepseek',
  'gemini',
  'grokai',
  'groq',
  'kimi',
  'minimax',
  'openai',
  'openai-codex',
  'openai-codex-cli',
  'openrouter',
  'togetherai',
  'zai',
];

// Mapping of provider names to their fetch action names
export const PROVIDER_FETCH_ACTIONS = {
  Anthropic: 'aiProvider/fetchAnthropicModels',
  Cerebras: 'aiProvider/fetchCerebrasModels',
  'Claude-Code': 'aiProvider/fetchClaudeCodeModels',
  DeepSeek: 'aiProvider/fetchDeepSeekModels',
  Gemini: 'aiProvider/fetchGeminiModels',
  GrokAI: 'aiProvider/fetchGrokAIModels',
  Groq: 'aiProvider/fetchGroqModels',
  Kimi: 'aiProvider/fetchKimiModels',
  Local: 'aiProvider/fetchLocalModels',
  Minimax: 'aiProvider/fetchMinimaxModels',
  OpenAI: 'aiProvider/fetchOpenAIModels',
  'OpenAI-Codex': 'aiProvider/fetchOpenAICodexModels',
  'OpenAI-Codex-CLI': 'aiProvider/fetchOpenAICodexCliModels',
  OpenRouter: 'aiProvider/fetchOpenRouterModels',
  TogetherAI: 'aiProvider/fetchTogetherAIModels',
  ZAI: 'aiProvider/fetchZAIModels',
};

export default {
  namespaced: true,
  state: {
    providers: [
      'Anthropic',
      'Cerebras',
      'Claude-Code',
      'DeepSeek',
      'Gemini',
      'GrokAI',
      'Groq',
      'Kimi',
      'Local',
      'Minimax',
      'OpenAI',
      'OpenAI-Codex',
      'OpenAI-Codex-CLI',
      'OpenRouter',
      'TogetherAI',
      'ZAI',
    ],
    customProviders: [], // Custom OpenAI-compatible providers
    allModels: {
      Anthropic: [], // Will be populated dynamically from API
      Cerebras: [], // Will be populated dynamically from API
      'Claude-Code': [], // Will be populated dynamically from API
      DeepSeek: [], // Will be populated dynamically from API
      Gemini: [], // Will be populated dynamically from API
      GrokAI: [], // Will be populated dynamically from API
      Groq: [], // Will be populated dynamically from API
      Kimi: [], // Will be populated dynamically from API
      Local: [], // Will be populated dynamically from LM Studio
      Minimax: [], // Will be populated dynamically from API
      OpenAI: [], // Will be populated dynamically from API
      'OpenAI-Codex': [], // Will be populated dynamically from API
      'OpenAI-Codex-CLI': [], // Will be populated dynamically from API
      OpenRouter: [], // Will be populated dynamically from API
      TogetherAI: [], // Will be populated dynamically from API
      ZAI: [], // Will be populated dynamically from API
    },
    selectedProvider: localStorage.getItem('selectedProvider') || null, // Load from local storage, no default yet
    selectedModel: localStorage.getItem('selectedModel') || null, // Load from local storage, no default yet
    loadingModels: {}, // Track loading state for each provider
    modelCache: {}, // Cache models with timestamps
  },
  mutations: {
    SET_SELECTED_PROVIDER(state, newProvider) {
      state.selectedProvider = newProvider;

      // Handle null provider - clear from localStorage
      if (!newProvider) {
        localStorage.removeItem('selectedProvider');
        state.selectedModel = null;
        localStorage.removeItem('selectedModel');
        return;
      }

      localStorage.setItem('selectedProvider', newProvider); // Save to local storage

      // Always reset the model when switching providers
      const availableModels = state.allModels[newProvider] || [];
      if (availableModels.length > 0) {
        // If models are already loaded for this provider, select the first one
        state.selectedModel = availableModels[0];
        localStorage.setItem('selectedModel', availableModels[0]);
      } else {
        // If models aren't loaded yet, clear the selection
        // The model will be set after models are fetched via SET_PROVIDER_MODELS
        state.selectedModel = null;
        localStorage.removeItem('selectedModel');
      }
    },
    SET_SELECTED_MODEL(state, newModel) {
      state.selectedModel = newModel;

      // Handle null model - clear from localStorage
      if (!newModel) {
        localStorage.removeItem('selectedModel');
        return;
      }

      localStorage.setItem('selectedModel', newModel); // Save to local storage
    },
    ENSURE_VALID_MODEL(state) {
      // Ensure the selected model is valid for the current provider
      const availableModels = state.allModels[state.selectedProvider] || [];
      if (!state.selectedModel || !availableModels.includes(state.selectedModel)) {
        const defaultModel = availableModels[0];
        if (defaultModel) {
          state.selectedModel = defaultModel;
          localStorage.setItem('selectedModel', defaultModel);
        }
      }
    },
    SET_PROVIDER_MODELS(state, { provider, models }) {
      state.allModels[provider] = models;

      // If this is the current provider and no model is selected, select the first one
      if (state.selectedProvider === provider && !state.selectedModel && models.length > 0) {
        state.selectedModel = models[0];
        localStorage.setItem('selectedModel', models[0]);
      }
    },
    SET_LOADING_MODELS(state, { provider, loading }) {
      if (!state.loadingModels) {
        state.loadingModels = {};
      }
      state.loadingModels[provider] = loading;
    },
    SET_CUSTOM_PROVIDERS(state, providers) {
      state.customProviders = providers;
    },
    ADD_CUSTOM_PROVIDER(state, provider) {
      state.customProviders.push(provider);
      // Initialize models array for this provider
      state.allModels[provider.id] = [];
    },
    UPDATE_CUSTOM_PROVIDER(state, { id, updates }) {
      const index = state.customProviders.findIndex((p) => p.id === id);
      if (index !== -1) {
        state.customProviders[index] = { ...state.customProviders[index], ...updates };
      }
    },
    REMOVE_CUSTOM_PROVIDER(state, id) {
      state.customProviders = state.customProviders.filter((p) => p.id !== id);
      // Clean up models
      delete state.allModels[id];
    },
  },
  getters: {
    filteredModels(state) {
      return state.allModels[state.selectedProvider] || [];
    },
    filteredProviders(state, _getters, rootState) {
      const codexStatus = rootState?.appAuth?.codexStatus || {};
      const shouldHideOpenAICodex = codexStatus.available === true && codexStatus.apiUsable !== true;
      if (!shouldHideOpenAICodex) {
        return state.providers;
      }
      return state.providers.filter((provider) => provider !== 'OpenAI-Codex');
    },
    allProviders(state) {
      // Combine built-in providers with custom providers
      const customProviderNames = state.customProviders.map((p) => ({
        id: p.id,
        name: p.provider_name,
        isCustom: true,
      }));

      const builtInProviders = state.providers.map((p) => ({
        id: p,
        name: p,
        isCustom: false,
      }));

      return [...builtInProviders, ...customProviderNames];
    },
  },
  actions: {
    async setProvider({ commit, state }, newProvider) {
      commit('SET_SELECTED_PROVIDER', newProvider);

      // Sync with backend
      try {
        const token = localStorage.getItem('token');
        if (token) {
          console.log('Syncing provider with backend:', newProvider);
          const response = await fetch(`${API_CONFIG.BASE_URL}/users/settings`, {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              selectedProvider: newProvider,
              selectedModel: state.selectedModel,
            }),
          });

          if (!response.ok) {
            const errorText = await response.text();
            console.error('Backend sync failed:', response.status, errorText);
          } else {
            console.log('Provider synced successfully with backend');
          }
        } else {
          console.warn('No token found, cannot sync provider with backend');
        }
      } catch (error) {
        console.error('Failed to sync provider with backend:', error);
      }
    },

    async setModel({ commit, state }, newModel) {
      commit('SET_SELECTED_MODEL', newModel);

      // Sync with backend
      try {
        const token = localStorage.getItem('token');
        if (token) {
          console.log('Syncing model with backend:', newModel);
          const response = await fetch(`${API_CONFIG.BASE_URL}/users/settings`, {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              selectedProvider: state.selectedProvider,
              selectedModel: newModel,
            }),
          });

          if (!response.ok) {
            const errorText = await response.text();
            console.error('Backend sync failed:', response.status, errorText);
          } else {
            console.log('Model synced successfully with backend');
          }
        } else {
          console.warn('No token found, cannot sync model with backend');
        }
      } catch (error) {
        console.error('Failed to sync model with backend:', error);
      }
    },

    async loadUserSettings({ commit, dispatch, state }) {
      try {
        const token = localStorage.getItem('token');
        if (token) {
          const response = await fetch(`${API_CONFIG.BASE_URL}/users/settings`, {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });

          if (response.ok) {
            const settings = await response.json();
            const provider = settings.selectedProvider;
            const model = settings.selectedModel;

            // Only update if we have valid settings
            if (provider) {
              // Check if this is a custom provider (UUID format)
              const isCustomProvider = state.customProviders.some((cp) => cp.id === provider);

              // Fetch models for the provider first before setting it
              // This ensures models are available when the provider is set
              if (provider === 'Local') {
                await dispatch('fetchLocalModels');
              } else if (isCustomProvider) {
                await dispatch('fetchCustomProviderModels', provider);
              } else if (state.providers.includes(provider)) {
                await dispatch('fetchProviderModels', { provider });
              }

              // Now set the provider (models should be loaded)
              commit('SET_SELECTED_PROVIDER', provider);

              // If we have a specific model saved, use it (if it's valid)
              if (model) {
                const availableModels = state.allModels[provider] || [];
                if (availableModels.includes(model)) {
                  commit('SET_SELECTED_MODEL', model);
                }
                // If the saved model isn't available, SET_SELECTED_PROVIDER already set a default
              }
            }
          }
        }
      } catch (error) {
        console.warn('Failed to load user settings from backend:', error);
      }
    },

    // Generic function to fetch models for any provider
    async fetchProviderModels({ commit, state }, { provider, forceRefresh = false } = {}) {
      // Check if already loading
      if (state.loadingModels[provider]) {
        return state.allModels[provider];
      }

      // Check cache first (unless force refresh)
      const cacheKey = `${provider}_models`;
      const cached = localStorage.getItem(cacheKey);
      if (!forceRefresh && cached) {
        try {
          const { models, timestamp } = JSON.parse(cached);
          const cacheAge = Date.now() - timestamp;
          const cacheExpiry = 60 * 60 * 1000; // 1 hour

          if (cacheAge < cacheExpiry) {
            console.log(`Using cached ${provider} models`);
            commit('SET_PROVIDER_MODELS', { provider, models });
            return models;
          }
        } catch (e) {
          console.warn('Failed to parse cached models:', e);
        }
      }

      commit('SET_LOADING_MODELS', { provider, loading: true });

      try {
        const providerLower = provider.toLowerCase();
        const token = localStorage.getItem('token');
        const isLocalProvider = providerLower === 'openai-codex' || providerLower === 'openai-codex-cli' || providerLower === 'claude-code';
        if (!token && !isLocalProvider) {
          throw new Error(`Authentication required to fetch ${provider} models`);
        }

        const headers = {
          'Content-Type': 'application/json',
        };
        if (token) {
          headers.Authorization = `Bearer ${token}`;
        }

        const response = await fetch(`${API_CONFIG.BASE_URL}/models/${providerLower}/models`, {
          headers,
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        const models = data.models || [];

        // Update state
        commit('SET_PROVIDER_MODELS', { provider, models });

        // Cache the results
        localStorage.setItem(
          cacheKey,
          JSON.stringify({
            models,
            timestamp: Date.now(),
          }),
        );

        console.log(`Fetched ${models.length} ${provider} models`);
        return models;
      } catch (error) {
        console.error(`Failed to fetch ${provider} models:`, error);

        // Try to use cached models even if expired
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          try {
            const { models } = JSON.parse(cached);
            console.log('Using expired cached models due to fetch error');
            commit('SET_PROVIDER_MODELS', { provider, models });
            return models;
          } catch (e) {
            console.warn('Failed to parse expired cached models:', e);
          }
        }

        // Return current models as fallback
        return state.allModels[provider] || [];
      } finally {
        commit('SET_LOADING_MODELS', { provider, loading: false });
      }
    },

    async fetchOpenRouterModels({ dispatch }, { forceRefresh = false } = {}) {
      return dispatch('fetchProviderModels', { provider: 'OpenRouter', forceRefresh });
    },

    async refreshOpenRouterModels({ dispatch }) {
      return dispatch('fetchProviderModels', { provider: 'OpenRouter', forceRefresh: true });
    },

    async fetchAnthropicModels({ dispatch }, { forceRefresh = false } = {}) {
      return dispatch('fetchProviderModels', { provider: 'Anthropic', forceRefresh });
    },

    async fetchOpenAIModels({ dispatch }, { forceRefresh = false } = {}) {
      return dispatch('fetchProviderModels', { provider: 'OpenAI', forceRefresh });
    },

    async fetchOpenAICodexModels({ dispatch }, { forceRefresh = false } = {}) {
      return dispatch('fetchProviderModels', { provider: 'OpenAI-Codex', forceRefresh });
    },

    async fetchOpenAICodexCliModels({ dispatch }, { forceRefresh = false } = {}) {
      return dispatch('fetchProviderModels', { provider: 'OpenAI-Codex-CLI', forceRefresh });
    },

    async fetchGeminiModels({ dispatch }, { forceRefresh = false } = {}) {
      return dispatch('fetchProviderModels', { provider: 'Gemini', forceRefresh });
    },

    async fetchGrokAIModels({ dispatch }, { forceRefresh = false } = {}) {
      return dispatch('fetchProviderModels', { provider: 'GrokAI', forceRefresh });
    },

    async fetchGroqModels({ dispatch }, { forceRefresh = false } = {}) {
      return dispatch('fetchProviderModels', { provider: 'Groq', forceRefresh });
    },

    async fetchTogetherAIModels({ dispatch }, { forceRefresh = false } = {}) {
      return dispatch('fetchProviderModels', { provider: 'TogetherAI', forceRefresh });
    },

    async fetchCerebrasModels({ dispatch }, { forceRefresh = false } = {}) {
      return dispatch('fetchProviderModels', { provider: 'Cerebras', forceRefresh });
    },

    async fetchClaudeCodeModels({ dispatch }, { forceRefresh = false } = {}) {
      return dispatch('fetchProviderModels', { provider: 'Claude-Code', forceRefresh });
    },

    async fetchDeepSeekModels({ dispatch }, { forceRefresh = false } = {}) {
      return dispatch('fetchProviderModels', { provider: 'DeepSeek', forceRefresh });
    },

    async fetchKimiModels({ dispatch }, { forceRefresh = false } = {}) {
      return dispatch('fetchProviderModels', { provider: 'Kimi', forceRefresh });
    },

    async fetchMinimaxModels({ dispatch }, { forceRefresh = false } = {}) {
      return dispatch('fetchProviderModels', { provider: 'Minimax', forceRefresh });
    },

    async fetchZAIModels({ dispatch }, { forceRefresh = false } = {}) {
      return dispatch('fetchProviderModels', { provider: 'ZAI', forceRefresh });
    },

    async fetchLocalModels({ commit, state }, { forceRefresh = false } = {}) {
      const provider = 'Local';

      // Check if already loading
      if (state.loadingModels[provider]) {
        return state.allModels[provider];
      }

      // Check cache first (unless force refresh)
      const cacheKey = `${provider}_models`;
      const cached = localStorage.getItem(cacheKey);
      if (!forceRefresh && cached) {
        try {
          const { models, timestamp } = JSON.parse(cached);
          const cacheAge = Date.now() - timestamp;
          const cacheExpiry = 5 * 60 * 1000; // 5 minutes

          if (cacheAge < cacheExpiry) {
            console.log('Using cached Local models');
            commit('SET_PROVIDER_MODELS', { provider, models });
            return models;
          }
        } catch (e) {
          console.warn('Failed to parse cached Local models:', e);
        }
      }

      commit('SET_LOADING_MODELS', { provider, loading: true });

      try {
        const response = await fetch('http://127.0.0.1:1234/v1/models', {
          method: 'GET',
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        // LM Studio returns models in data.data array
        const models = (data.data || []).map((model) => model.id);

        if (models.length === 0) {
          console.warn('No models found from LM Studio');
          // Keep existing hardcoded models as fallback
          return state.allModels[provider] || [];
        }

        // Update state
        commit('SET_PROVIDER_MODELS', { provider, models });

        // Cache the results
        localStorage.setItem(
          cacheKey,
          JSON.stringify({
            models,
            timestamp: Date.now(),
          }),
        );

        console.log(`Fetched ${models.length} Local models from LM Studio`);
        return models;
      } catch (error) {
        console.error('Failed to fetch Local models:', error);

        // Try to use cached models even if expired
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          try {
            const { models } = JSON.parse(cached);
            console.log('Using expired cached Local models due to fetch error');
            commit('SET_PROVIDER_MODELS', { provider, models });
            return models;
          } catch (e) {
            console.warn('Failed to parse expired cached Local models:', e);
          }
        }

        // Return current models as fallback
        return state.allModels[provider] || [];
      } finally {
        commit('SET_LOADING_MODELS', { provider, loading: false });
      }
    },

    async refreshLocalModels({ dispatch }) {
      return dispatch('fetchLocalModels', { forceRefresh: true });
    },

    async setProviderWithModelFetch({ commit, dispatch, state }, newProvider) {
      // Fetch models for the provider first before switching
      // Local provider uses a different endpoint (LM Studio)
      if (newProvider === 'Local') {
        await dispatch('fetchLocalModels');
      } else {
        // Use the generic fetchProviderModels for all other providers
        // This ensures models are loaded before the provider switch completes
        await dispatch('fetchProviderModels', { provider: newProvider });
      }

      // Then set the provider after models are loaded
      await dispatch('setProvider', newProvider);
    },

    // Ensure a valid model is selected for the current provider
    ensureValidModel({ commit, state }) {
      commit('ENSURE_VALID_MODEL');
    },

    // Custom provider management actions
    async fetchCustomProviders({ commit, state }) {
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          throw new Error('Authentication required');
        }

        const response = await fetch(`${API_CONFIG.BASE_URL}/custom-providers`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch custom providers: ${response.statusText}`);
        }

        const data = await response.json();
        const providers = data.providers || [];
        commit('SET_CUSTOM_PROVIDERS', providers);

        // CRITICAL: Validate that the currently selected provider still exists
        // This handles the case where localStorage has a custom provider ID
        // but we haven't fetched the custom providers yet (e.g., after hard refresh)
        if (state.selectedProvider) {
          const isBuiltIn = state.providers.includes(state.selectedProvider);
          const isCustom = providers.some((p) => p.id === state.selectedProvider);

          if (!isBuiltIn && !isCustom) {
            console.warn(`Selected provider ${state.selectedProvider} no longer exists, clearing selection`);
            commit('SET_SELECTED_PROVIDER', null);
            commit('SET_SELECTED_MODEL', null);
          }
        }

        return providers;
      } catch (error) {
        console.error('Error fetching custom providers:', error);
        return [];
      }
    },

    async createCustomProvider({ commit }, providerData) {
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          throw new Error('Authentication required');
        }

        const response = await fetch(`${API_CONFIG.BASE_URL}/custom-providers`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(providerData),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.details || error.error || 'Failed to create custom provider');
        }

        const data = await response.json();
        commit('ADD_CUSTOM_PROVIDER', data.provider);
        return data.provider;
      } catch (error) {
        console.error('Error creating custom provider:', error);
        throw error;
      }
    },

    async updateCustomProvider({ commit }, { id, updates }) {
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          throw new Error('Authentication required');
        }

        const response = await fetch(`${API_CONFIG.BASE_URL}/custom-providers/${id}`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(updates),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.details || error.error || 'Failed to update custom provider');
        }

        const data = await response.json();
        commit('UPDATE_CUSTOM_PROVIDER', { id, updates: data.provider });
        return data.provider;
      } catch (error) {
        console.error('Error updating custom provider:', error);
        throw error;
      }
    },

    async deleteCustomProvider({ commit }, id) {
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          throw new Error('Authentication required');
        }

        const response = await fetch(`${API_CONFIG.BASE_URL}/custom-providers/${id}`, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.details || error.error || 'Failed to delete custom provider');
        }

        commit('REMOVE_CUSTOM_PROVIDER', id);
      } catch (error) {
        console.error('Error deleting custom provider:', error);
        throw error;
      }
    },

    async testCustomProviderConnection(_, { base_url, api_key }) {
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          throw new Error('Authentication required');
        }

        console.log('Testing custom provider connection:', { base_url, api_key: api_key ? '***' : 'none' });

        const response = await fetch(`${API_CONFIG.BASE_URL}/custom-providers/test`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ base_url, api_key }),
        });

        const data = await response.json();
        console.log('Test connection response:', data);
        console.log('Models count:', data.modelsCount);
        console.log('Models:', data.models);

        return data;
      } catch (error) {
        console.error('Error testing custom provider connection:', error);
        return { success: false, error: error.message };
      }
    },

    async fetchCustomProviderModels({ commit }, providerId) {
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          throw new Error('Authentication required');
        }

        commit('SET_LOADING_MODELS', { provider: providerId, loading: true });

        const response = await fetch(`${API_CONFIG.BASE_URL}/custom-providers/${providerId}/models`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch models: ${response.statusText}`);
        }

        const data = await response.json();
        const models = data.models || [];

        commit('SET_PROVIDER_MODELS', { provider: providerId, models });
        return models;
      } catch (error) {
        console.error('Error fetching custom provider models:', error);
        return [];
      } finally {
        commit('SET_LOADING_MODELS', { provider: providerId, loading: false });
      }
    },
  },
};
