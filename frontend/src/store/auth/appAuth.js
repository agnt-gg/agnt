import { API_CONFIG } from '@/tt.config.js';
import axios from 'axios';
import { resolveProviderKey } from '@/store/app/aiProvider.js';
import providerAuthService from '@/services/providerAuthService.js';

// CLI provider IDs that use local filesystem auth
const CLI_PROVIDER_IDS = ['openai-codex', 'claude-code', 'gemini-cli'];

// In-flight promise for deduplicating concurrent fetchConnectedApps calls
let _fetchConnectedAppsPromise = null;

const state = {
  connectedApps: [],
  allProviders: [],
  connectionHealth: null,
  lastHealthCheck: null,
  isHealthCheckLoading: false,
  pollingIntervalId: null,
  // Unified CLI provider statuses keyed by provider ID
  cliProviderStatuses: {},
  codexDeviceSession: null,
  claudeCodeSetupSession: null,
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
  SET_CLI_PROVIDER_STATUS(state, { providerId, status }) {
    state.cliProviderStatuses = {
      ...state.cliProviderStatuses,
      [providerId]: {
        available: status?.available === true,
        apiUsable: status?.apiUsable === true,
        apiStatus: typeof status?.apiStatus === 'number' ? status.apiStatus : null,
        source: status?.source || null,
        hint: status?.hint || null,
        checkedAt: status?.checkedAt || new Date().toISOString(),
        // Codex-specific extras
        ...(status?.codexWorkdir !== undefined ? { codexWorkdir: status.codexWorkdir } : {}),
        ...(status?.toolRunner !== undefined ? { toolRunner: status.toolRunner } : {}),
      },
    };
  },
  SET_CODEX_DEVICE_SESSION(state, session) {
    state.codexDeviceSession = session || null;
  },
  CLEAR_CODEX_DEVICE_SESSION(state) {
    state.codexDeviceSession = null;
  },
  SET_CLAUDE_CODE_SETUP_SESSION(state, session) {
    state.claudeCodeSetupSession = session || null;
  },
  CLEAR_CLAUDE_CODE_SETUP_SESSION(state) {
    state.claudeCodeSetupSession = null;
  },
};

const actions = {
  async fetchConnectedApps({ commit }) {
    // Deduplicate concurrent calls - return existing in-flight promise
    if (_fetchConnectedAppsPromise) return _fetchConnectedAppsPromise;

    _fetchConnectedAppsPromise = (async () => {
      try {
        const token = localStorage.getItem('token');
        let connectedApps = [];

        // Remote agnt.gg call runs concurrently but we don't block on it for initial render
        const remotePromise = axios.get(`${API_CONFIG.REMOTE_URL}/auth/connected`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          timeout: 5000,
        }).catch(() => null);

        // Fast local checks via unified endpoints — these resolve in <100ms
        const statusResults = await Promise.allSettled(
          CLI_PROVIDER_IDS.map((id) => providerAuthService.getStatus(id)),
        );

        // Process each CLI provider status
        CLI_PROVIDER_IDS.forEach((id, index) => {
          const result = statusResults[index];
          if (result.status === 'fulfilled') {
            const status = result.value || {};
            commit('SET_CLI_PROVIDER_STATUS', { providerId: id, status });
            if (status.available === true && !connectedApps.includes(id)) {
              connectedApps = [...connectedApps, id];
            }
          } else {
            console.warn(`Error checking ${id} status:`, result.reason?.message);
            commit('SET_CLI_PROVIDER_STATUS', { providerId: id, status: { available: false, apiUsable: false, hint: `${id} status unavailable` } });
          }
        });

        // Commit local results immediately so UI can render
        const localDeduped = Array.from(new Set(connectedApps));
        commit('SET_CONNECTED_APPS', localDeduped);

        // Now await the remote result and merge it in
        const remoteResult = await remotePromise;
        if (remoteResult && Array.isArray(remoteResult.data)) {
          const normalizeProviderId = (app) => {
            let raw;
            if (typeof app === 'string') raw = app;
            else if (app?.provider_id) raw = String(app.provider_id);
            else if (app?.id) raw = String(app.id);
            else return null;
            return resolveProviderKey(raw) || raw.toLowerCase();
          };
          const remoteApps = remoteResult.data.map(normalizeProviderId).filter(Boolean);
          const merged = Array.from(new Set([...remoteApps, ...connectedApps]));
          commit('SET_CONNECTED_APPS', merged);
        }
      } finally {
        _fetchConnectedAppsPromise = null;
      }
    })();

    return _fetchConnectedAppsPromise;
  },
  async fetchAllProviders({ commit }) {
    try {
      const response = await axios.get(`${API_CONFIG.REMOTE_URL}/auth/providers`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
      });
      const remoteProviders = Array.isArray(response.data) ? response.data : [];

      // Inject local providers so they can be configured without the remote auth service.
      const localCodexProviders = [
        {
          id: 'openai-codex',
          name: 'OpenAI Codex',
          icon: 'openai',
          categories: ['AI'],
          connectionType: 'oauth',
          instructions: 'Uses Codex CLI locally (no API key). You will be given a URL and one-time code to complete sign-in.',
          localOnly: true,
        },
        {
          id: 'claude-code',
          name: 'Claude Code',
          icon: 'anthropic',
          categories: ['AI'],
          connectionType: 'oauth',
          instructions: 'Uses Claude Code CLI locally (no API key). Authenticate via setup-token or paste your OAuth token.',
          localOnly: true,
        },
        {
          id: 'gemini-cli',
          name: 'Gemini CLI',
          icon: 'google',
          categories: ['AI'],
          connectionType: 'oauth',
          instructions: 'Uses your Google account (no API key). Sign in with Google to use your AI Pro/Ultra subscription.',
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
      // Still expose the local providers even if the remote fetch fails.
      commit('SET_ALL_PROVIDERS', [
        {
          id: 'openai-codex',
          name: 'OpenAI Codex',
          icon: 'openai',
          categories: ['AI'],
          connectionType: 'oauth',
          instructions: 'Uses Codex CLI locally (no API key). You will be given a URL and one-time code to complete sign-in.',
          localOnly: true,
        },
        {
          id: 'claude-code',
          name: 'Claude Code',
          icon: 'anthropic',
          categories: ['AI'],
          connectionType: 'oauth',
          instructions: 'Uses Claude Code CLI locally (no API key). Authenticate via setup-token or paste your OAuth token.',
          localOnly: true,
        },
        {
          id: 'gemini-cli',
          name: 'Gemini CLI',
          icon: 'google',
          categories: ['AI'],
          connectionType: 'oauth',
          instructions: 'Uses your Google account (no API key). Sign in with Google to use your AI Pro/Ultra subscription.',
          localOnly: true,
        },
      ]);
    }
  },

  // ── Generic provider actions (unified endpoints) ──────────────────

  async fetchProviderStatus({ commit }, providerId) {
    try {
      const status = await providerAuthService.getStatus(providerId);
      commit('SET_CLI_PROVIDER_STATUS', { providerId, status });
      return status;
    } catch (error) {
      console.error(`Error fetching ${providerId} status:`, error);
      const fallback = { available: false, apiUsable: false, hint: `${providerId} status unavailable` };
      commit('SET_CLI_PROVIDER_STATUS', { providerId, status: fallback });
      return fallback;
    }
  },

  async connectProvider({ dispatch }, { providerId, payload }) {
    const result = await providerAuthService.connect(providerId, payload);
    if (result?.success) {
      await dispatch('fetchProviderStatus', providerId);
      await dispatch('fetchConnectedApps');
      dispatch('checkConnectionHealth');
    }
    return result;
  },

  async disconnectProvider({ commit, dispatch }, providerId) {
    try {
      const result = await providerAuthService.disconnect(providerId);
      commit('SET_CLI_PROVIDER_STATUS', { providerId, status: { available: false, apiUsable: false, hint: 'Disconnected' } });
      commit('CLEAR_CODEX_DEVICE_SESSION');
      commit('CLEAR_CLAUDE_CODE_SETUP_SESSION');
      await dispatch('fetchConnectedApps');
      dispatch('checkConnectionHealth');
      return result;
    } catch (error) {
      console.error(`Error disconnecting ${providerId}:`, error);
      throw error;
    }
  },

  async refreshProviderToken({ commit, dispatch }, providerId) {
    try {
      const result = await providerAuthService.refresh(providerId);
      if (result?.success) {
        commit('SET_CLI_PROVIDER_STATUS', { providerId, status: result });
        return { success: true };
      }
      return { success: false, error: result?.error };
    } catch (error) {
      const data = error?.response?.data;
      if (data?.code === 'REAUTH_REQUIRED') {
        commit('SET_CLI_PROVIDER_STATUS', {
          providerId,
          status: { available: false, apiUsable: false, hint: 'Session expired. Please reconnect.' },
        });
        await dispatch('fetchConnectedApps');
        return { success: false, reauthRequired: true, error: data.error };
      }
      console.error(`Error refreshing ${providerId} token:`, error);
      return { success: false, error: data?.error || error.message };
    }
  },

  async startProviderDeviceAuth({ commit }, providerId) {
    const result = await providerAuthService.startDeviceAuth(providerId);
    if (result?.success) {
      commit('SET_CODEX_DEVICE_SESSION', {
        sessionId: result.sessionId,
        deviceUrl: result.deviceUrl,
        deviceCode: result.deviceCode,
        state: result.state,
        startedAt: result.startedAt,
        expiresAt: result.expiresAt,
      });
    }
    return result;
  },

  async pollProviderDeviceAuth({ commit, dispatch, state: s }, { providerId, sessionId, timeoutMs = 2 * 60 * 1000, intervalMs = 3000 } = {}) {
    const activeSessionId = sessionId || s.codexDeviceSession?.sessionId;
    if (!activeSessionId) {
      throw new Error('No device session to poll.');
    }

    const start = Date.now();
    let lastStatus = null;

    while (Date.now() - start < timeoutMs) {
      lastStatus = await providerAuthService.pollDeviceAuth(providerId, activeSessionId);

      if (lastStatus?.state === 'success') {
        await dispatch('fetchProviderStatus', providerId);
        await dispatch('fetchConnectedApps');
        commit('CLEAR_CODEX_DEVICE_SESSION');
        return lastStatus;
      }

      if (lastStatus?.state === 'error') {
        await dispatch('fetchProviderStatus', providerId);
        return lastStatus;
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    return lastStatus || { success: false, state: 'error', message: 'Timed out waiting for device login.' };
  },

  // ── Legacy action aliases (keep existing component dispatches working) ──

  async fetchCodexStatus({ dispatch }) {
    return dispatch('fetchProviderStatus', 'openai-codex');
  },
  async startCodexDeviceAuth({ dispatch }) {
    return dispatch('startProviderDeviceAuth', 'openai-codex');
  },
  async pollCodexDeviceAuth({ dispatch }, opts = {}) {
    return dispatch('pollProviderDeviceAuth', { providerId: 'openai-codex', ...opts });
  },
  async logoutCodex({ dispatch }) {
    return dispatch('disconnectProvider', 'openai-codex');
  },
  async fetchClaudeCodeStatus({ dispatch }) {
    return dispatch('fetchProviderStatus', 'claude-code');
  },
  async connectClaudeCodeManual({ dispatch }, token) {
    const result = await providerAuthService.connect('claude-code', { token });
    if (result?.success) {
      localStorage.removeItem('Claude-Code_models');
      await dispatch('fetchProviderStatus', 'claude-code');
      await dispatch('fetchConnectedApps');
    }
    return result;
  },
  async refreshCodexToken({ dispatch }) {
    return dispatch('refreshProviderToken', 'openai-codex');
  },
  async refreshClaudeCodeToken({ dispatch }) {
    return dispatch('refreshProviderToken', 'claude-code');
  },
  async disconnectClaudeCode({ commit, dispatch }) {
    try {
      const result = await providerAuthService.disconnect('claude-code');
      await dispatch('fetchProviderStatus', 'claude-code');
      await dispatch('fetchConnectedApps');
      commit('CLEAR_CLAUDE_CODE_SETUP_SESSION');
      return result;
    } catch (error) {
      console.error('Error disconnecting Claude Code:', error);
      throw error;
    }
  },
  async disconnectGeminiCli({ commit, dispatch }) {
    try {
      const result = await providerAuthService.disconnect('gemini-cli');
      commit('SET_CLI_PROVIDER_STATUS', { providerId: 'gemini-cli', status: { available: false, apiUsable: false, hint: 'Disconnected' } });
      await dispatch('fetchConnectedApps');
      return result;
    } catch (error) {
      console.error('Error disconnecting Gemini CLI:', error);
      throw error;
    }
  },

  // ── Health check actions (unchanged) ──────────────────────────────

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
            } else {
              providers.push(data.provider);
            }

            if (data.progress) {
              commit('SET_CONNECTION_HEALTH', {
                overall: 'checking',
                healthyConnections: data.progress.healthy,
                totalConnections: data.progress.total,
                providers: [...providers],
                timestamp: new Date().toISOString(),
                progress: data.progress,
              });
            }
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
  // Backward-compatible getters for existing component reads
  codexStatus: (state) => state.cliProviderStatuses['openai-codex'] || { available: false, apiUsable: false },
  codexDeviceSession: (state) => state.codexDeviceSession,
  claudeCodeStatus: (state) => state.cliProviderStatuses['claude-code'] || { available: false, apiUsable: false },
  claudeCodeSetupSession: (state) => state.claudeCodeSetupSession,
  geminiCliStatus: (state) => state.cliProviderStatuses['gemini-cli'] || { available: false, apiUsable: false },
  claudeCodeNeedsReauth: (state) => {
    const s = state.cliProviderStatuses['claude-code'];
    return s?.available === false && s?.hint && s.hint.includes('expired');
  },
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
