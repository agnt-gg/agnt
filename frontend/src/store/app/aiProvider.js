import { API_CONFIG, DEPLOYMENT_CONFIG } from '@/tt.config.js';

// ─────────────────────────── PROVIDER REGISTRY ───────────────────────────
// Single source of truth for all built-in provider metadata on the frontend.
// Derived from the same data as backend/src/services/ai/providerConfigs.js.

const BUILT_IN_PROVIDERS = [
  { key: 'anthropic', displayName: 'Anthropic' },
  { key: 'cerebras', displayName: 'Cerebras' },
  { key: 'claude-code', displayName: 'Claude-Code' },
  { key: 'deepseek', displayName: 'DeepSeek' },
  { key: 'gemini', displayName: 'Gemini' },
  { key: 'grokai', displayName: 'GrokAI' },
  { key: 'groq', displayName: 'Groq' },
  { key: 'kimi', displayName: 'Kimi' },
  { key: 'local', displayName: 'Local' },
  { key: 'minimax', displayName: 'MiniMax' },
  { key: 'openai', displayName: 'OpenAI' },
  { key: 'openai-codex', displayName: 'OpenAI-Codex' },
  { key: 'openai-codex-cli', displayName: 'OpenAI-Codex-CLI' },
  { key: 'openrouter', displayName: 'OpenRouter' },
  { key: 'togetherai', displayName: 'TogetherAI' },
  { key: 'zai', displayName: 'Z-AI' },
];

// ─────────────────────────── DERIVED EXPORTS ───────────────────────────

// Map internal provider keys to user-facing display names where they differ
export const PROVIDER_DISPLAY_NAMES = {};
for (const p of BUILT_IN_PROVIDERS) {
  // Only add entries where key-based capitalization != display name
  const defaultName = p.key.charAt(0).toUpperCase() + p.key.slice(1);
  if (p.displayName !== defaultName) {
    PROVIDER_DISPLAY_NAMES[p.displayName] = p.displayName;
    PROVIDER_DISPLAY_NAMES[p.key] = p.displayName;
  }
}

// Resolve any provider identifier (display name, key, or mixed case) to its canonical key.
// e.g. "Z-AI" → "zai", "GrokAI" → "grokai", "openai" → "openai"
export function resolveProviderKey(identifier) {
  if (!identifier) return null;
  const lower = identifier.toLowerCase();
  // Direct key match
  const byKey = BUILT_IN_PROVIDERS.find((p) => p.key === lower);
  if (byKey) return byKey.key;
  // Display name match (case-insensitive)
  const byDisplay = BUILT_IN_PROVIDERS.find((p) => p.displayName.toLowerCase() === lower);
  if (byDisplay) return byDisplay.key;
  // Not a built-in provider — return as-is (custom provider ID)
  return identifier;
}

// Single source of truth for AI providers that require API keys (excludes 'Local')
export const AI_PROVIDERS_WITH_API = BUILT_IN_PROVIDERS.filter((p) => p.key !== 'local').map((p) => p.key);

// Mapping of provider display names to their fetch action names (auto-generated)
export const PROVIDER_FETCH_ACTIONS = {};
for (const p of BUILT_IN_PROVIDERS) {
  const actionSuffix = p.displayName.replace(/-/g, '');
  PROVIDER_FETCH_ACTIONS[p.displayName] = `aiProvider/fetch${actionSuffix}Models`;
}

// Provider display names list (used by state.providers)
const PROVIDER_DISPLAY_LIST = BUILT_IN_PROVIDERS.map((p) => p.displayName);

// Initial allModels shape
const INITIAL_ALL_MODELS = {};
for (const p of BUILT_IN_PROVIDERS) {
  INITIAL_ALL_MODELS[p.displayName] = [];
}

export default {
  namespaced: true,
  state: {
    providers: [...PROVIDER_DISPLAY_LIST],
    customProviders: [],
    allModels: { ...INITIAL_ALL_MODELS },
    selectedProvider: localStorage.getItem('selectedProvider') || null,
    selectedModel: localStorage.getItem('selectedModel') || null,
    loadingModels: {},
    modelCache: {},
  },
  mutations: {
    SET_SELECTED_PROVIDER(state, newProvider) {
      state.selectedProvider = newProvider;

      if (!newProvider) {
        localStorage.removeItem('selectedProvider');
        state.selectedModel = null;
        localStorage.removeItem('selectedModel');
        return;
      }

      localStorage.setItem('selectedProvider', newProvider);

      const availableModels = state.allModels[newProvider] || [];
      if (availableModels.length > 0) {
        state.selectedModel = availableModels[0];
        localStorage.setItem('selectedModel', availableModels[0]);
      } else {
        state.selectedModel = null;
        localStorage.removeItem('selectedModel');
      }
    },
    SET_SELECTED_MODEL(state, newModel) {
      state.selectedModel = newModel;

      if (!newModel) {
        localStorage.removeItem('selectedModel');
        return;
      }

      localStorage.setItem('selectedModel', newModel);
    },
    ENSURE_VALID_MODEL(state) {
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

      try {
        const token = localStorage.getItem('token');
        if (token) {
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
          }
        }
      } catch (error) {
        console.error('Failed to sync provider with backend:', error);
      }
    },

    async setModel({ commit, state }, newModel) {
      commit('SET_SELECTED_MODEL', newModel);

      try {
        const token = localStorage.getItem('token');
        if (token) {
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
          }
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

            if (provider) {
              const isCustomProvider = state.customProviders.some((cp) => cp.id === provider);

              if (provider === 'Local') {
                await dispatch('fetchLocalModels');
              } else if (isCustomProvider) {
                await dispatch('fetchCustomProviderModels', provider);
              } else if (state.providers.includes(provider)) {
                await dispatch('fetchProviderModels', { provider });
              }

              commit('SET_SELECTED_PROVIDER', provider);

              if (model) {
                const availableModels = state.allModels[provider] || [];
                if (availableModels.includes(model)) {
                  commit('SET_SELECTED_MODEL', model);
                }
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
      if (state.loadingModels[provider]) {
        return state.allModels[provider];
      }

      const cacheKey = `${provider}_models`;
      const cached = localStorage.getItem(cacheKey);
      if (!forceRefresh && cached) {
        try {
          const { models, timestamp } = JSON.parse(cached);
          const cacheAge = Date.now() - timestamp;
          const cacheExpiry = 60 * 60 * 1000;

          if (cacheAge < cacheExpiry) {
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

        commit('SET_PROVIDER_MODELS', { provider, models });

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

        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          try {
            const { models } = JSON.parse(cached);
            commit('SET_PROVIDER_MODELS', { provider, models });
            return models;
          } catch (e) {
            console.warn('Failed to parse expired cached models:', e);
          }
        }

        return state.allModels[provider] || [];
      } finally {
        commit('SET_LOADING_MODELS', { provider, loading: false });
      }
    },

    // Per-provider fetch actions (thin wrappers for backward compatibility)
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
    async fetchOpenAICodexCLIModels({ dispatch }, { forceRefresh = false } = {}) {
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
      return dispatch('fetchProviderModels', { provider: 'MiniMax', forceRefresh });
    },
    async fetchZAIModels({ dispatch }, { forceRefresh = false } = {}) {
      return dispatch('fetchProviderModels', { provider: 'Z-AI', forceRefresh });
    },

    async fetchLocalModels({ commit, state }, { forceRefresh = false } = {}) {
      const provider = 'Local';

      // Skip if local LLM is disabled (hosted environments)
      if (DEPLOYMENT_CONFIG.DISABLE_LOCAL_LLM) {
        console.log('Local LLM polling disabled (hosted mode)');
        return [];
      }

      // Check if already loading
      if (state.loadingModels[provider]) {
        return state.allModels[provider];
      }

      const cacheKey = `${provider}_models`;
      const cached = localStorage.getItem(cacheKey);
      if (!forceRefresh && cached) {
        try {
          const { models, timestamp } = JSON.parse(cached);
          const cacheAge = Date.now() - timestamp;
          const cacheExpiry = 5 * 60 * 1000;

          if (cacheAge < cacheExpiry) {
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
        const models = (data.data || []).map((model) => model.id);

        if (models.length === 0) {
          return state.allModels[provider] || [];
        }

        commit('SET_PROVIDER_MODELS', { provider, models });

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

        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          try {
            const { models } = JSON.parse(cached);
            commit('SET_PROVIDER_MODELS', { provider, models });
            return models;
          } catch (e) {
            console.warn('Failed to parse expired cached Local models:', e);
          }
        }

        return state.allModels[provider] || [];
      } finally {
        commit('SET_LOADING_MODELS', { provider, loading: false });
      }
    },

    async refreshLocalModels({ dispatch }) {
      return dispatch('fetchLocalModels', { forceRefresh: true });
    },

    async setProviderWithModelFetch({ commit, dispatch, state }, newProvider) {
      if (newProvider === 'Local') {
        await dispatch('fetchLocalModels');
      } else {
        await dispatch('fetchProviderModels', { provider: newProvider });
      }

      await dispatch('setProvider', newProvider);
    },

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

        const response = await fetch(`${API_CONFIG.BASE_URL}/custom-providers/test`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ base_url, api_key }),
        });

        const data = await response.json();
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
