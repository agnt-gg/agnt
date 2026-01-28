import { API_CONFIG } from '@/tt.config.js';
import axios from 'axios';

const state = {
  connectedApps: [],
  allProviders: [],
  connectionHealth: null,
  lastHealthCheck: null,
  isHealthCheckLoading: false,
  pollingIntervalId: null,
  codexStatus: {
    available: false,
    apiUsable: false,
    apiStatus: null,
    source: null,
    hint: null,
    checkedAt: null,
    codexWorkdir: null,
    toolRunner: null,
  },
  kimiStatus: {
    connected: false,
    checkedAt: null,
    baseUrl: null,
    defaultModel: null,
    hint: null,
  },
  codexDeviceSession: null,
};

const mutations = {
  SET_CONNECTED_APPS(state, apps) {
    state.connectedApps = apps;
  },
  SET_ALL_PROVIDERS(state, providers) {
    state.allProviders = providers;
  },
  SET_CONNECTION_HEALTH(state, health) {
    state.connectionHealth = health;
    state.lastHealthCheck = new Date().toISOString();
  },
  SET_HEALTH_CHECK_LOADING(state, isLoading) {
    state.isHealthCheckLoading = isLoading;
  },
  SET_POLLING_INTERVAL_ID(state, intervalId) {
    state.pollingIntervalId = intervalId;
  },
  SET_CODEX_STATUS(state, status) {
    state.codexStatus = {
      available: status?.available === true,
      apiUsable: status?.apiUsable === true,
      apiStatus: typeof status?.apiStatus === 'number' ? status.apiStatus : null,
      source: status?.source || null,
      hint: status?.hint || null,
      checkedAt: status?.checkedAt || new Date().toISOString(),
      codexWorkdir: status?.codexWorkdir || null,
      toolRunner: status?.toolRunner || null,
    };
  },
  SET_CODEX_DEVICE_SESSION(state, session) {
    state.codexDeviceSession = session || null;
  },
  CLEAR_CODEX_DEVICE_SESSION(state) {
    state.codexDeviceSession = null;
  },
  SET_KIMI_STATUS(state, status) {
    state.kimiStatus = {
      connected: status?.connected === true,
      checkedAt: status?.checkedAt || new Date().toISOString(),
      baseUrl: status?.baseUrl || null,
      defaultModel: status?.defaultModel || null,
      hint: status?.message || status?.hint || null,
    };
  },
};

const actions = {
  async fetchConnectedApps({ commit }) {
    const token = localStorage.getItem('token');
    let connectedApps = [];

    try {
      const headers = token
        ? {
            Authorization: `Bearer ${token}`,
          }
        : {};

      const response = await axios.get(`${API_CONFIG.REMOTE_URL}/auth/connected`, {
        headers,
      });

      if (Array.isArray(response.data)) {
        const normalizeProviderId = (app) => {
          if (typeof app === 'string') return app.toLowerCase();
          if (app?.provider_id) return String(app.provider_id).toLowerCase();
          if (app?.id) return String(app.id).toLowerCase();
          return null;
        };

        connectedApps = response.data.map(normalizeProviderId).filter(Boolean);
      }
    } catch (error) {
      console.error('Error fetching connected apps:', error);
    }

    // Local Codex auth:
    // - openai-codex-cli: connected when Codex login exists locally.
    try {
      const codexStatusResponse = await axios.get(`${API_CONFIG.BASE_URL}/codex/status`);
      const codexStatus = codexStatusResponse?.data || {};
      commit('SET_CODEX_STATUS', codexStatus);

      if (codexStatus.available === true) {
        if (!connectedApps.includes('openai-codex-cli')) {
          connectedApps = [...connectedApps, 'openai-codex-cli'];
        }
      }
    } catch (error) {
      console.warn('Error checking Codex status:', error?.message || error);
      commit('SET_CODEX_STATUS', { available: false, apiUsable: false, hint: 'Codex status unavailable' });
    }

    // Local Kimi Code auth (API key stored locally).
    try {
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const kimiStatusResponse = await axios.get(`${API_CONFIG.BASE_URL}/kimi-code/status`, { headers });
      const kimiStatus = kimiStatusResponse?.data || {};
      commit('SET_KIMI_STATUS', kimiStatus);

      if (kimiStatus.connected === true) {
        if (!connectedApps.includes('kimi-code')) {
          connectedApps = [...connectedApps, 'kimi-code'];
        }
      }
    } catch (error) {
      console.warn('Error checking Kimi Code status:', error?.message || error);
      commit('SET_KIMI_STATUS', { connected: false, hint: 'Kimi Code status unavailable' });
    }

    // De-duplicate while preserving order.
    const deduped = Array.from(new Set(connectedApps));
    commit('SET_CONNECTED_APPS', deduped);
  },
  async fetchAllProviders({ commit }) {
    try {
      const response = await axios.get(`${API_CONFIG.REMOTE_URL}/auth/providers`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
      });
      const remoteProviders = Array.isArray(response.data) ? response.data : [];

      // Inject local Codex providers so they can be configured without the remote auth service.
      const localCodexProviders = [
        {
          id: 'openai-codex-cli',
          name: 'OpenAI Codex CLI',
          icon: 'openai',
          categories: ['AI'],
          connectionType: 'oauth',
          instructions:
            'Uses Codex CLI locally (no API key). You will be given a URL and one-time code to complete sign-in.',
          localOnly: true,
        },
        {
          id: 'kimi-code',
          name: 'Kimi Code',
          icon: 'code',
          categories: ['AI'],
          connectionType: 'apikey',
          instructions:
            'Enter your Kimi Code API key. This uses the OpenAI-compatible Kimi Code endpoint and the kimi-for-coding model.',
          localOnly: true,
        },
      ];

      const existingIds = new Set(remoteProviders.map((p) => p.id));
      const mergedProviders = [...remoteProviders];
      for (const provider of localCodexProviders) {
        if (!existingIds.has(provider.id)) {
          mergedProviders.push(provider);
        }
      }

      commit('SET_ALL_PROVIDERS', mergedProviders);
    } catch (error) {
      console.error('Error fetching all providers:', error);
      // Still expose the local Codex providers even if the remote fetch fails.
      commit('SET_ALL_PROVIDERS', [
        {
          id: 'openai-codex-cli',
          name: 'OpenAI Codex CLI',
          icon: 'openai',
          categories: ['AI'],
          connectionType: 'oauth',
          instructions:
            'Uses Codex CLI locally (no API key). You will be given a URL and one-time code to complete sign-in.',
          localOnly: true,
        },
        {
          id: 'kimi-code',
          name: 'Kimi Code',
          icon: 'code',
          categories: ['AI'],
          connectionType: 'apikey',
          instructions:
            'Enter your Kimi Code API key. This uses the OpenAI-compatible Kimi Code endpoint and the kimi-for-coding model.',
          localOnly: true,
        },
      ]);
    }
  },
  async fetchCodexStatus({ commit }) {
    try {
      const response = await axios.get(`${API_CONFIG.BASE_URL}/codex/status`);
      commit('SET_CODEX_STATUS', response.data);
      return response.data;
    } catch (error) {
      console.error('Error fetching Codex status:', error);
      const fallback = { available: false, apiUsable: false, hint: 'Codex status unavailable' };
      commit('SET_CODEX_STATUS', fallback);
      return fallback;
    }
  },
  async startCodexDeviceAuth({ commit }) {
    const response = await axios.post(`${API_CONFIG.BASE_URL}/codex/device/start`);
    if (response.data?.success) {
      commit('SET_CODEX_DEVICE_SESSION', {
        sessionId: response.data.sessionId,
        deviceUrl: response.data.deviceUrl,
        deviceCode: response.data.deviceCode,
        state: response.data.state,
        startedAt: response.data.startedAt,
        expiresAt: response.data.expiresAt,
      });
    }
    return response.data;
  },
  async pollCodexDeviceAuth({ commit, dispatch, state }, { sessionId, timeoutMs = 2 * 60 * 1000, intervalMs = 3000 } = {}) {
    const activeSessionId = sessionId || state.codexDeviceSession?.sessionId;
    if (!activeSessionId) {
      throw new Error('No Codex device session to poll.');
    }

    const start = Date.now();
    let lastStatus = null;

    while (Date.now() - start < timeoutMs) {
      const response = await axios.get(`${API_CONFIG.BASE_URL}/codex/device/status`, {
        params: { sessionId: activeSessionId },
      });
      lastStatus = response.data;

      if (lastStatus?.state === 'success') {
        // Refresh Codex status and connected apps after successful login.
        await dispatch('fetchCodexStatus');
        await dispatch('fetchConnectedApps');
        commit('CLEAR_CODEX_DEVICE_SESSION');
        return lastStatus;
      }

      if (lastStatus?.state === 'error') {
        await dispatch('fetchCodexStatus');
        return lastStatus;
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    return lastStatus || { success: false, state: 'error', message: 'Timed out waiting for device login.' };
  },
  async logoutCodex({ commit, dispatch }) {
    try {
      const response = await axios.post(`${API_CONFIG.BASE_URL}/codex/logout`);
      await dispatch('fetchCodexStatus');
      await dispatch('fetchConnectedApps');
      commit('CLEAR_CODEX_DEVICE_SESSION');
      return response.data;
    } catch (error) {
      console.error('Error logging out of Codex:', error);
      throw error;
    }
  },
  async fetchKimiStatus({ commit }) {
    try {
      const token = localStorage.getItem('token');
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const response = await axios.get(`${API_CONFIG.BASE_URL}/kimi-code/status`, { headers });
      commit('SET_KIMI_STATUS', response.data);
      return response.data;
    } catch (error) {
      console.error('Error fetching Kimi Code status:', error);
      const fallback = { connected: false, hint: 'Kimi Code status unavailable' };
      commit('SET_KIMI_STATUS', fallback);
      return fallback;
    }
  },
  async saveKimiApiKey({ dispatch }, apiKey) {
    const token = localStorage.getItem('token');
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const response = await axios.post(`${API_CONFIG.BASE_URL}/kimi-code/apikey`, { apiKey }, { headers });
    await dispatch('fetchKimiStatus');
    await dispatch('fetchConnectedApps');
    return response.data;
  },
  async deleteKimiApiKey({ dispatch }) {
    const token = localStorage.getItem('token');
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const response = await axios.delete(`${API_CONFIG.BASE_URL}/kimi-code/apikey`, { headers });
    await dispatch('fetchKimiStatus');
    await dispatch('fetchConnectedApps');
    return response.data;
  },
  async checkConnectionHealth({ commit }) {
    try {
      const response = await axios.get(`${API_CONFIG.BASE_URL}/users/connection-health`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
      });
      if (response.data.success) {
        commit('SET_CONNECTION_HEALTH', response.data.data);
        return response.data.data;
      }
    } catch (error) {
      console.error('Error checking connection health:', error);
      return null;
    }
  },
  async checkSingleProviderHealth({ commit }, providerId) {
    try {
      const response = await axios.get(`${API_CONFIG.BASE_URL}/users/connection-health/${providerId}`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
      });
      if (response.data.success) {
        return response.data.data;
      }
    } catch (error) {
      console.error('Error checking provider health:', error);
      return null;
    }
  },
  async updateProvider({ commit, dispatch }, { id, providerData }) {
    try {
      const response = await axios.put(`${API_CONFIG.REMOTE_URL}/auth/providers/${id}`, providerData, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json',
        },
      });

      // Refresh the providers list after update
      await dispatch('fetchAllProviders');
      return { success: true, ...response.data };
    } catch (error) {
      console.error('Error updating provider:', error);
      return { success: false, error: error.message };
    }
  },
  async deleteProvider({ commit, dispatch }, providerId) {
    try {
      const response = await axios.delete(`${API_CONFIG.REMOTE_URL}/auth/providers/${providerId}`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json',
        },
      });

      // Refresh the connected apps list after deletion
      await dispatch('fetchConnectedApps');
      return response.data;
    } catch (error) {
      console.error('Error deleting provider:', error);
      throw error;
    }
  },
  async checkConnectionHealthStream({ commit, state }) {
    // If already loading, don't start another check
    if (state.isHealthCheckLoading) return;

    commit('SET_HEALTH_CHECK_LOADING', true);

    try {
      return new Promise((resolve, reject) => {
        const token = localStorage.getItem('token');
        const eventSource = new EventSource(`${API_CONFIG.BASE_URL}/users/connection-health-stream?token=${encodeURIComponent(token)}`);

        let providers = [];
        let summary = null;

        const messageHandler = (event) => {
          const data = JSON.parse(event.data);

          if (data.type === 'init') {
            providers = data.providers.map((p) => ({ provider: p, status: 'checking' }));
            commit('SET_CONNECTION_HEALTH', {
              overall: 'checking',
              healthyConnections: 0,
              totalConnections: data.totalProviders,
              providers: providers,
              timestamp: new Date().toISOString(),
            });
          } else if (data.type === 'provider') {
            const index = providers.findIndex((p) => p.provider === data.provider.provider);
            if (index !== -1) {
              providers[index] = data.provider;
            }

            commit('SET_CONNECTION_HEALTH', {
              overall: 'checking',
              healthyConnections: data.progress.healthy,
              totalConnections: data.progress.total,
              providers: [...providers],
              timestamp: new Date().toISOString(),
              progress: data.progress,
            });
          } else if (data.type === 'summary') {
            summary = data.data;
            commit('SET_CONNECTION_HEALTH', summary);
          }
        };

        const completeHandler = () => {
          eventSource.removeEventListener('message', messageHandler);
          eventSource.removeEventListener('complete', completeHandler);
          eventSource.removeEventListener('error', errorHandler);
          eventSource.close();
          commit('SET_HEALTH_CHECK_LOADING', false);
          resolve(summary);
        };

        const errorHandler = (event) => {
          eventSource.removeEventListener('message', messageHandler);
          eventSource.removeEventListener('complete', completeHandler);
          eventSource.removeEventListener('error', errorHandler);
          eventSource.close();
          commit('SET_HEALTH_CHECK_LOADING', false);
          if (event.data) {
            try {
              const error = JSON.parse(event.data);
              reject(new Error(error.error));
            } catch {
              reject(new Error('Connection failed'));
            }
          } else {
            reject(new Error('Connection failed'));
          }
        };

        eventSource.addEventListener('message', messageHandler);
        eventSource.addEventListener('complete', completeHandler);
        eventSource.addEventListener('error', errorHandler);

        eventSource.onerror = () => {
          eventSource.removeEventListener('message', messageHandler);
          eventSource.removeEventListener('complete', completeHandler);
          eventSource.removeEventListener('error', errorHandler);
          eventSource.close();
          commit('SET_HEALTH_CHECK_LOADING', false);
          reject(new Error('Stream connection error'));
        };
      });
    } catch (error) {
      commit('SET_HEALTH_CHECK_LOADING', false);
      throw error;
    }
  },
  // Start centralized polling for connected apps (60 second interval)
  startPolling({ dispatch, commit, state }) {
    // Don't start if already polling
    if (state.pollingIntervalId) {
      console.log('[appAuth] Polling already active');
      return;
    }

    console.log('[appAuth] Starting centralized polling (60s interval)');

    // Poll every 60 seconds
    const intervalId = setInterval(() => {
      dispatch('fetchConnectedApps');
    }, 60000);

    commit('SET_POLLING_INTERVAL_ID', intervalId);
  },
  // Stop centralized polling
  stopPolling({ commit, state }) {
    if (state.pollingIntervalId) {
      console.log('[appAuth] Stopping centralized polling');
      clearInterval(state.pollingIntervalId);
      commit('SET_POLLING_INTERVAL_ID', null);
    }
  },
};

const HEALTH_CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes in milliseconds

const getters = {
  connectedApps: (state) => state.connectedApps,
  codexStatus: (state) => state.codexStatus,
  codexDeviceSession: (state) => state.codexDeviceSession,
  kimiStatus: (state) => state.kimiStatus,
  connectionHealthStatus: (state) => {
    if (!state.connectionHealth) return 'unknown';
    return state.connectionHealth.overall;
  },
  healthyConnectionsCount: (state) => {
    if (!state.connectionHealth) return 0;
    return state.connectionHealth.healthyConnections;
  },
  totalConnectionsCount: (state) => {
    if (!state.connectionHealth) return 0;
    return state.connectionHealth.totalConnections;
  },
  providerHealthDetails: (state) => {
    if (!state.connectionHealth) return [];
    return state.connectionHealth.providers;
  },
  isHealthCheckLoading: (state) => state.isHealthCheckLoading,
  needsHealthCheck: (state) => {
    if (!state.lastHealthCheck) return true;

    const now = new Date().getTime();
    const lastCheck = new Date(state.lastHealthCheck).getTime();
    return now - lastCheck > HEALTH_CHECK_INTERVAL;
  },
};

export default {
  namespaced: true,
  state,
  mutations,
  actions,
  getters,
};
