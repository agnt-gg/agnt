<template>
  <div class="dashboard-section integration-health">
    <h3 class="section-title">CONNECTED INTEGRATIONS</h3>

    <div class="integration-overview">
      <div class="health-meter">
        <div class="meter-track">
          <div class="meter-fill" :style="{ width: integrationHealthPercentage + '%' }" :class="healthStatusClass"></div>
        </div>
        <div class="health-labels">
          <span>Critical</span>
          <span>Degraded</span>
          <span>Healthy</span>
        </div>
      </div>

      <div class="health-summary">
        <span class="health-status" :class="healthStatusClass">{{ healthStatusText }}</span>
        <span class="health-count">{{ displayHealthyCount }}/{{ displayTotalCount }} healthy</span>
        <button @click="refreshHealth" class="refresh-button" :disabled="refreshing">
          <span class="refresh-icon" :class="{ spinning: refreshing }">
            {{ refreshing ? '⟳' : '↻' }}
          </span>
        </button>
      </div>

      <div class="integration-grid">
        <Tooltip
          v-for="integration in integrationDetails"
          :key="integration.provider"
          :text="`${integration.name}: ${integration.metric}`"
          width="auto"
        >
          <div
            class="integration-tile"
            :class="integration.statusClass"
            @click="handleIntegrationClick(integration)"
          >
            <div class="integration-icon">
              <SvgIcon :name="integration.icon" />
            </div>
            <span class="integration-name">{{ integration.name }}</span>
            <span class="integration-status-dot" :class="integration.statusClass"></span>
          </div>
        </Tooltip>
      </div>
    </div>
    <SimpleModal ref="modal" />
  </div>
</template>

<script>
import { computed, ref, onMounted, onUnmounted } from 'vue';
import { useStore } from 'vuex';
import SvgIcon from '@/views/_components/common/SvgIcon.vue';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';
import { API_CONFIG } from '@/tt.config.js';
import { PROVIDER_DISPLAY_NAMES } from '@/store/app/aiProvider.js';
import { encrypt } from '@/views/_utils/encryption.js';

export default {
  name: 'IntegrationHealth',
  components: {
    SvgIcon,
    SimpleModal,
    Tooltip,
  },
  setup() {
    const store = useStore();
    const modal = ref(null);
    const refreshing = computed(() => store.getters['appAuth/isHealthCheckLoading']);

    const connectionHealth = computed(() => store.state.appAuth.connectionHealth);

    const healthStatusText = computed(() => {
      const status = store.getters['appAuth/connectionHealthStatus'];
      switch (status) {
        case 'healthy':
          return 'All Systems Operational';
        case 'degraded':
          return 'Some Issues Detected';
        case 'critical':
          return 'Critical Issues';
        case 'no_connections':
          return 'No Connections';
        default:
          return 'Status Unknown';
      }
    });

    const healthStatusClass = computed(() => {
      const status = store.getters['appAuth/connectionHealthStatus'];
      return `status-${status}`;
    });

    const healthyConnectionsCount = computed(() => store.getters['appAuth/healthyConnectionsCount']);
    const totalConnectionsCount = computed(() => store.getters['appAuth/totalConnectionsCount']);

    // Adjust counts by subtracting 1 for display
    const displayHealthyCount = computed(() => {
      const count = healthyConnectionsCount.value;
      return count > 0 ? count - 1 : 0;
    });

    const displayTotalCount = computed(() => {
      const count = totalConnectionsCount.value;
      return count > 0 ? count - 1 : 0;
    });

    const integrationHealthPercentage = computed(() => {
      const total = displayTotalCount.value;
      const healthy = displayHealthyCount.value;
      if (total === 0) return 0;
      return Math.round((healthy / total) * 100);
    });

    const allProviders = computed(() => store.state.appAuth.allProviders);
    const connectedApps = computed(() => store.state.appAuth.connectedApps || []);

    const integrationDetails = computed(() => {
      // Get all providers from the store
      const providers = allProviders.value || [];

      // Get connection health status for each provider
      const healthProviders = connectionHealth.value?.providers || [];

      return providers
        .map((provider) => {
          // Find health status for this provider
          const healthStatus = healthProviders.find((hp) => hp.provider === provider.id);

          // For local-only providers (Codex CLI, Claude Code) that aren't in the remote
          // health check, fall back to the connectedApps list to determine status.
          let status = healthStatus?.status;
          let metric = healthStatus?.details?.error || healthStatus?.error;

          if (!healthStatus && connectedApps.value.includes(provider.id)) {
            status = 'healthy';
            metric = 'Connected';
          }

          return {
            provider: provider.id,
            icon: provider.icon || 'custom',
            name: PROVIDER_DISPLAY_NAMES[provider.id] || PROVIDER_DISPLAY_NAMES[provider.name] || provider.name || provider.id.charAt(0).toUpperCase() + provider.id.slice(1),
            metric: metric || (status === 'healthy' ? 'Connected' : 'Not Connected'),
            statusClass: status || 'error',
            connectionType: provider.connectionType || provider.connection_type,
            instructions: provider.instructions,
            custom_prompt: provider.custom_prompt,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
    });

    const refreshHealth = async () => {
      try {
        await store.dispatch('appAuth/checkConnectionHealthStream');
      } catch (error) {
        console.error('Error refreshing health:', error);
        await store.dispatch('appAuth/checkConnectionHealth');
      }
    };

    const showAlert = async (title, message) => {
      await modal.value.showModal({
        title,
        message,
        confirmText: 'OK',
        showCancel: false,
      });
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
        inputType: options.inputType || 'text',
      });
      return result === null ? null : result || defaultValue;
    };

    const fetchProviderDetails = async (providerId) => {
      const normalizedId = String(providerId || '').toLowerCase();

      // Prefer locally cached provider definitions (these include local Codex providers).
      const cachedProviders = Array.isArray(allProviders.value) ? allProviders.value : [];
      const cachedMatch = cachedProviders.find((p) => String(p?.id || '').toLowerCase() === normalizedId);
      if (cachedMatch) {
        return cachedMatch;
      }

      // Fallback: provide local provider details even if the remote auth service is unavailable.
      if (normalizedId === 'openai-codex-cli') {
        return {
          id: 'openai-codex-cli',
          name: 'OpenAI Codex CLI',
          icon: 'openai',
          categories: ['AI'],
          connectionType: 'oauth',
          instructions:
            'Uses Codex CLI locally (no API key). You will be given a URL and one-time code to complete sign-in.',
          localOnly: true,
        };
      }
      if (normalizedId === 'claude-code') {
        return {
          id: 'claude-code',
          name: 'Claude Code',
          icon: 'anthropic',
          categories: ['AI'],
          connectionType: 'oauth',
          instructions:
            'Uses Claude Code CLI locally (no API key). Authenticate via setup-token or paste your OAuth token.',
          localOnly: true,
        };
      }

      try {
        const token = localStorage.getItem('token');
        if (!token) {
          return null;
        }
        const response = await fetch(`${API_CONFIG.REMOTE_URL}/auth/providers`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const providers = await response.json();
        return providers.find((p) => String(p?.id || '').toLowerCase() === normalizedId);
      } catch (error) {
        console.error('Error fetching provider details:', error);
        return null;
      }
    };

    const handleIntegrationClick = async (integration) => {
      // Always fetch full provider details to ensure we have all fields including instructions
      const providerDetails = await fetchProviderDetails(integration.provider);

      if (!providerDetails) {
        await showAlert('Error', 'Could not load provider details');
        return;
      }

      // Determine connection type
      const connectionType = providerDetails.connectionType || providerDetails.connection_type;

      // Claude Code and Codex CLI use local auth flows — handle separately.
      const normalizedProviderId = String(integration.provider || '').toLowerCase();
      if (normalizedProviderId === 'claude-code') {
        if (integration.statusClass === 'healthy') {
          await disconnectClaudeCode(providerDetails);
        } else {
          await connectClaudeCode(providerDetails);
        }
        return;
      }

      if (normalizedProviderId === 'openai-codex-cli') {
        if (integration.statusClass === 'healthy') {
          await disconnectCodex(providerDetails);
        } else {
          await connectCodexFromHealth(providerDetails);
        }
        return;
      }

      if (integration.statusClass === 'healthy') {
        disconnectApp(providerDetails);
      } else if (connectionType === 'oauth') {
        connectOAuthApp(providerDetails);
      } else if (connectionType === 'apikey') {
        promptApiKey(providerDetails);
      } else {
        await showAlert('Configuration Required', `Please configure the connection type for ${providerDetails.name} in the settings.`);
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
        if (data.authUrl) {
          // Open OAuth in popup window
          const width = 600;
          const height = 700;
          const left = window.screenX + (window.outerWidth - width) / 2;
          const top = window.screenY + (window.outerHeight - height) / 2;

          const popup = window.open(
            data.authUrl,
            `oauth_${app.id}`,
            `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no,scrollbars=yes,resizable=yes`
          );

          if (!popup) {
            await showAlert('Popup Blocked', 'Please allow popups for this site to connect integrations.');
            return;
          }

          // Monitor popup for completion
          const checkPopup = setInterval(() => {
            if (popup.closed) {
              clearInterval(checkPopup);
              // Refresh health after popup closes
              refreshHealth();
            }
          }, 500);
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
          await showAlert('Success', `Successfully disconnected from ${app.name}`);
          await refreshHealth();
        } else {
          throw new Error('Disconnection failed');
        }
      } catch (error) {
        console.error(`Error disconnecting from ${app.name}:`, error);
        await showAlert('Disconnection Error', `Failed to disconnect from ${app.name}: ${error.message}`);
      }
    };

    const promptApiKey = async (app) => {
      // Use instructions as the message, or fall back to custom_prompt or default
      const promptMessage = app.instructions || app.custom_prompt || `Enter API Key for ${app.name}:`;
      const apiKey = await showPrompt(`Connect to ${app.name}`, promptMessage, '', {
        confirmText: 'Save',
        cancelText: 'Cancel',
        confirmClass: 'btn-primary',
        cancelClass: 'btn-secondary',
        inputType: 'password',
      });

      if (apiKey) {
        await saveApiKey(app, apiKey);
      }
    };

    const saveApiKey = async (app, apiKey) => {
      try {
        const token = localStorage.getItem('token');
        const encryptedApiKey = encrypt(apiKey);

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
          await showAlert('Success', `API key for ${app.name} saved successfully!`);
          await refreshHealth();
        } else {
          throw new Error(result.message || 'Failed to save API key');
        }
      } catch (error) {
        console.error(`Error saving API key for ${app.name}:`, error);
        await showAlert('Error', `Failed to save API key for ${app.name}: ${error.message}`);
      }
    };

    const connectCodexFromHealth = async (providerDetails) => {
      try {
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
          await showAlert(
            'Codex Device Login',
            session.message || 'Device code was not returned yet. Please try again in a moment.'
          );
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
          await showAlert('Success', 'OpenAI Codex CLI connected successfully.');
          await refreshHealth();
        } else {
          await showAlert('Connection Failed', result?.message || 'Device login not completed yet.');
        }
      } catch (error) {
        console.error('Error connecting OpenAI Codex from health panel:', error);
        await showAlert('Connection Error', `Failed to connect OpenAI Codex: ${error.message}`);
      }
    };

    const connectClaudeCode = async (providerDetails) => {
      try {
        // Get the Anthropic OAuth URL from the local backend
        const response = await fetch(`${API_CONFIG.BASE_URL}/claude-code/oauth/start`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();

        if (!data.authUrl) throw new Error('No authUrl returned');

        // Open in the system browser
        if (window.electron?.openExternalUrl) {
          window.electron.openExternalUrl(data.authUrl);
        } else {
          window.open(data.authUrl, '_blank');
        }

        // Prompt the user to paste the code from Anthropic's callback page
        const codeState = await showPrompt(
          'Claude Code Authentication',
          `<div style="text-align:left">
            <p>A browser window has opened for Anthropic authentication.</p>
            <p><strong>1.</strong> Sign in to your Anthropic account</p>
            <p><strong>2.</strong> Click <strong>Authorize</strong></p>
            <p><strong>3.</strong> Copy the code shown on the resulting page</p>
            <p><strong>4.</strong> Paste it below</p>
          </div>`,
          '',
          {
            confirmText: 'Connect',
            cancelText: 'Cancel',
            confirmClass: 'btn-primary',
            inputType: 'text',
          }
        );

        if (!codeState) return;

        // Exchange the code for tokens via the backend
        const exchangeResponse = await fetch(`${API_CONFIG.BASE_URL}/claude-code/oauth/exchange`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: data.sessionId, codeState }),
        });
        const exchangeResult = await exchangeResponse.json();

        if (exchangeResult.success) {
          localStorage.removeItem('Claude-Code_models');
          await store.dispatch('appAuth/fetchConnectedApps');
          await refreshHealth();
          await showAlert('Success', 'Claude Code connected successfully.');
        } else {
          await showAlert('Connection Failed', exchangeResult.error || 'Failed to exchange authorization code.');
        }
      } catch (error) {
        // Fall back to paste-token prompt
        console.warn('Claude Code OAuth failed, falling back to paste-token:', error.message);
        const token = await showPrompt(
          `Connect to ${providerDetails.name}`,
          'Could not complete Anthropic OAuth. Paste your Claude Code OAuth token (starts with sk-ant-):',
          '',
          {
            confirmText: 'Connect',
            cancelText: 'Cancel',
            confirmClass: 'btn-primary',
            inputType: 'password',
          }
        );

        if (!token) return;

        try {
          const result = await store.dispatch('appAuth/connectClaudeCodeManual', token);
          if (result?.success) {
            await showAlert('Success', result.message || 'Claude Code connected successfully.');
            await store.dispatch('appAuth/fetchConnectedApps');
            await refreshHealth();
          } else {
            await showAlert('Connection Failed', result?.error || 'Failed to connect Claude Code.');
          }
        } catch (manualError) {
          await showAlert('Error', `Failed to connect Claude Code: ${manualError.message}`);
        }
      }
    };

    const disconnectClaudeCode = async (providerDetails) => {
      const confirmDisconnect = await modal.value.showModal({
        title: 'Confirm Disconnection',
        message: `Are you sure you want to disconnect from ${providerDetails.name}?`,
        confirmText: 'Disconnect',
        cancelText: 'Cancel',
        confirmClass: 'btn-danger',
      });

      if (!confirmDisconnect) return;

      try {
        const result = await store.dispatch('appAuth/disconnectClaudeCode');
        if (result?.success) {
          await showAlert('Success', `Successfully disconnected from ${providerDetails.name}`);
          await refreshHealth();
        } else {
          await showAlert('Error', result?.error || 'Failed to disconnect.');
        }
      } catch (error) {
        await showAlert('Error', `Failed to disconnect: ${error.message}`);
      }
    };

    const disconnectCodex = async (providerDetails) => {
      const confirmDisconnect = await modal.value.showModal({
        title: 'Confirm Disconnection',
        message: `Are you sure you want to disconnect from ${providerDetails.name}?`,
        confirmText: 'Disconnect',
        cancelText: 'Cancel',
        confirmClass: 'btn-danger',
      });

      if (!confirmDisconnect) return;

      try {
        const result = await store.dispatch('appAuth/logoutCodex');
        if (result?.success) {
          await showAlert('Success', `Successfully disconnected from ${providerDetails.name}`);
          await refreshHealth();
        } else {
          await showAlert('Error', result?.error || 'Failed to disconnect.');
        }
      } catch (error) {
        await showAlert('Error', `Failed to disconnect: ${error.message}`);
      }
    };

    // Handle OAuth completion messages from popup
    const handleOAuthMessage = async (event) => {
      // Verify origin for security (allow same origin and api.agnt.gg for postMessage)
      const allowedOrigins = [window.location.origin, 'https://api.agnt.gg'];
      if (!allowedOrigins.some((origin) => event.origin === origin || event.origin.includes('localhost'))) return;

      if (event.data.type === 'oauth_success') {
        // Refresh health immediately
        await refreshHealth();
      } else if (event.data.type === 'claude-code-oauth-success') {
        // Claude Code OAuth completed via popup — refresh health and connected apps
        await store.dispatch('appAuth/fetchConnectedApps');
        await refreshHealth();
      } else if (event.data.type === 'oauth_error') {
        const providerName = event.data.provider || 'the service';
        const errorMessage = event.data.message || 'Authentication failed';
        await showAlert('Connection Error', `Failed to connect to ${providerName}: ${errorMessage}`);
      }
      // Handle new oauth-callback message from postMessage approach (for Electron)
      else if (event.data.type === 'oauth-callback') {
        console.log('OAuth callback received via postMessage in IntegrationHealth:', event.data);
        const { code, state, provider } = event.data;
        if (code && state) {
          // Complete the OAuth flow
          await completeOAuthFromMessage(code, state, provider);
        }
      }
    };

    // Complete OAuth from postMessage
    const completeOAuthFromMessage = async (code, state, provider) => {
      try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_CONFIG.REMOTE_URL}/auth/callback`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ code, state }),
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        if (data.success) {
          await refreshHealth();
          await showAlert('Success', `Successfully connected to ${data.provider || provider}`);
        } else {
          throw new Error('OAuth completion failed');
        }
      } catch (error) {
        console.error('Error completing OAuth:', error);
        await showAlert('OAuth Error', `Failed to complete OAuth: ${error.message}`);
      }
    };

    // Fetch all providers and connection health on mount
    onMounted(async () => {
      await store.dispatch('appAuth/fetchAllProviders');
      await store.dispatch('appAuth/fetchConnectedApps');
      if (store.getters['appAuth/needsHealthCheck']) {
        await refreshHealth();
      }

      // Listen for OAuth completion messages
      window.addEventListener('message', handleOAuthMessage);
    });

    // Cleanup message listener on unmount
    onUnmounted(() => {
      window.removeEventListener('message', handleOAuthMessage);
    });

    return {
      integrationHealthPercentage,
      integrationDetails,
      healthStatusText,
      healthStatusClass,
      healthyConnectionsCount,
      totalConnectionsCount,
      displayHealthyCount,
      displayTotalCount,
      refreshHealth,
      refreshing,
      handleIntegrationClick,
      modal,
    };
  },
};
</script>

<style scoped>
.dashboard-section {
  margin-bottom: 32px;
}

.section-title {
  font-size: 0.75em;
  font-weight: 500;
  color: var(--color-duller-navy);
  letter-spacing: 0.2em;
  margin-bottom: 16px;
  font-family: var(--font-family-primary);
}

.health-meter {
  margin-bottom: 20px;
}

.meter-track {
  height: 8px;
  background: rgba(127, 129, 147, 0.2);
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 8px;
}

.meter-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--color-yellow) 0%, var(--color-green) 100%);
  transition: width 0.8s cubic-bezier(0.4, 0, 0.2, 1);
}

.health-labels {
  display: flex;
  justify-content: space-between;
  font-size: 0.7em;
  color: var(--color-duller-navy);
}

.health-summary {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.health-status {
  font-size: 0.9em;
  font-weight: 500;
}

.health-status.status-healthy {
  color: var(--color-green);
}

.health-status.status-degraded {
  color: var(--color-yellow);
}

.health-status.status-critical {
  color: var(--color-red);
}

.health-status.status-unknown {
  color: var(--color-med-navy);
}

.health-count {
  font-size: 0.8em;
  color: var(--color-med-navy);
}

.refresh-button {
  background: none;
  border: 1px solid var(--color-duller-navy);
  color: var(--color-med-navy);
  border-radius: 4px;
  padding: 4px 8px;
  cursor: pointer;
  font-size: 0.9em;
  transition: all 0.2s;
}

.refresh-button:hover:not(:disabled) {
  border-color: var(--color-blue);
  color: var(--color-blue);
}

.refresh-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.refresh-icon {
  display: inline-block;
}

.refresh-icon.spinning {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.integration-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(40px, 1fr));
  gap: 4px;
  margin-top: 16px;
  padding: 8px;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  max-height: 188px;
  overflow: scroll;
}

/* Fix Tooltip container to fill grid cells */
.integration-grid :deep(.tooltip-container) {
  width: 100%;
}

.integration-tile {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 4px;
  /* background: rgba(127, 129, 147, 0.05); */
  border: 2px solid transparent;
  border-radius: 8px;
  transition: all 0.2s ease;
  cursor: pointer;
  min-height: 32px;
}

.integration-tile:hover {
  /* background: rgba(127, 129, 147, 0.1); */
  transform: translateY(-2px);
}

.integration-tile.healthy {
  background: rgba(var(--green-rgb), 0.05);
  border-color: var(--color-green);
}

.integration-tile.error {
  /* border-color: rgba(255, 0, 0, 0.3); */
  border-color: var(--terminal-border-color);
  opacity: 0.8;
}

/* .integration-icon {
  margin-bottom: 8px;
} */

.integration-icon :deep(svg) {
  width: 16px;
  height: 16px;
}

.integration-name {
  display: none;
  font-size: 0.75em;
  color: var(--color-med-navy);
  text-align: center;
  line-height: 1.2;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.integration-status-dot {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
}

.integration-status-dot.healthy {
  background: var(--color-green);
  box-shadow: 0 0 4px var(--color-green);
}

.integration-status-dot.error {
  background: var(--color-text-muted);
  /* box-shadow: 0 0 4px var(--color-text-muted); */
}

.integration-status-dot.checking {
  background: var(--color-yellow);
  animation: pulse 1.5s infinite;
}

@keyframes pulse {
  0% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.5;
    transform: scale(1.1);
  }
  100% {
    opacity: 1;
    transform: scale(1);
  }
}

@media (max-width: 768px) {
  .integration-grid {
    grid-template-columns: repeat(auto-fill, minmax(40px, 1fr));
    gap: 6px;
    padding: 12px;
  }

  .integration-tile {
    padding: 10px 6px;
    min-height: 50px;
  }

  .integration-icon :deep(svg) {
    width: 24px;
    height: 24px;
  }

  .integration-tile .integration-name {
    font-size: 0.7em;
  }
}

@media (min-width: 1200px) {
  .integration-grid {
    grid-template-columns: repeat(auto-fill, minmax(40px, 1fr));
  }
}
</style>
