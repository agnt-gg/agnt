/**
 * Shared composable for provider connect/disconnect flows.
 * Uses unified /api/providers/:id/auth/* endpoints via providerAuthService.
 */

import { computed, onMounted, onUnmounted } from 'vue';
import { useStore } from 'vuex';
import { API_CONFIG } from '@/tt.config.js';
import { PROVIDER_DISPLAY_NAMES, resolveProviderKey } from '@/store/app/aiProvider.js';
import { encrypt } from '@/views/_utils/encryption.js';
import providerAuthService from '@/services/providerAuthService.js';

export function useProviderConnection(modalRef) {
  const store = useStore();

  const allProviders = computed(() => store.state.appAuth.allProviders || []);
  const connectedApps = computed(() => store.state.appAuth.connectedApps || []);

  // ── helpers ──────────────────────────────────────────────

  const isProviderConnected = (providerId) => {
    if (!providerId) return false;
    const normalized = resolveProviderKey(providerId) || providerId.toLowerCase();
    return connectedApps.value.includes(normalized) || connectedApps.value.includes(providerId);
  };

  const refreshHealth = async () => {
    try {
      await store.dispatch('appAuth/checkConnectionHealthStream');
    } catch {
      await store.dispatch('appAuth/checkConnectionHealth');
    }
  };

  const showAlert = async (title, message) => {
    await modalRef.value.showModal({
      title,
      message,
      confirmText: 'OK',
      showCancel: false,
    });
  };

  const showPrompt = async (title, message, defaultValue = '', options = {}) => {
    const result = await modalRef.value.showModal({
      title,
      message,
      isPrompt: true,
      isTextArea: options.isTextArea || false,
      placeholder: defaultValue,
      defaultValue,
      confirmText: options.confirmText || 'Save',
      cancelText: options.cancelText || 'Cancel',
      confirmClass: options.confirmClass || 'btn-primary',
      cancelClass: options.cancelClass || 'btn-secondary',
      showCancel: options.showCancel !== undefined ? options.showCancel : true,
      inputType: options.inputType || 'text',
    });
    return result === null ? null : result || defaultValue;
  };

  // ── provider lookup ──────────────────────────────────────

  const fetchProviderDetails = async (providerId) => {
    const normalizedId = String(providerId || '').toLowerCase();
    const strippedId = normalizedId.replace(/[^a-z0-9]/g, '');

    const cached = allProviders.value.find((p) => {
      const pid = String(p?.id || '').toLowerCase();
      return pid === normalizedId || pid.replace(/[^a-z0-9]/g, '') === strippedId;
    });
    if (cached) return cached;

    try {
      const token = localStorage.getItem('token');
      if (!token) return null;
      const response = await fetch(`${API_CONFIG.REMOTE_URL}/auth/providers`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const providers = await response.json();
      return providers.find((p) => {
        const pid = String(p?.id || '').toLowerCase();
        return pid === normalizedId || pid.replace(/[^a-z0-9]/g, '') === strippedId;
      });
    } catch (error) {
      console.error('Error fetching provider details:', error);
      return null;
    }
  };

  // ── capability-driven connection flows ─────────────────────

  const connectOAuthPkce = async (providerId, providerDetails) => {
    try {
      const data = await providerAuthService.startOAuth(providerId);
      if (!data.authUrl) throw new Error('No authUrl returned');

      if (window.electron?.openExternalUrl) {
        window.electron.openExternalUrl(data.authUrl);
      } else {
        window.open(data.authUrl, '_blank');
      }

      const codeState = await showPrompt(
        `${providerDetails.name} Authentication`,
        `<div style="text-align:left">
          <p>A browser window has opened for authentication.</p>
          <p><strong>1.</strong> Sign in to your account</p>
          <p><strong>2.</strong> Click <strong>Authorize</strong></p>
          <p><strong>3.</strong> Copy the code shown on the resulting page</p>
          <p><strong>4.</strong> Paste it below</p>
        </div>`,
        '',
        { confirmText: 'Connect', cancelText: 'Cancel', confirmClass: 'btn-primary', inputType: 'text' },
      );
      if (!codeState) return;

      const exchangeResult = await providerAuthService.exchangeOAuth(providerId, {
        sessionId: data.sessionId,
        codeState,
      });

      if (exchangeResult.success) {
        localStorage.removeItem('Claude-Code_models');
        await store.dispatch('appAuth/fetchConnectedApps');
        await refreshHealth();
        await showAlert('Success', `${providerDetails.name} connected successfully.`);
      } else {
        await showAlert('Connection Failed', exchangeResult.error || 'Failed to exchange authorization code.');
      }
    } catch (error) {
      // Fall back to paste-token prompt
      console.warn(`${providerDetails.name} OAuth failed, falling back to paste-token:`, error.message);
      const token = await showPrompt(
        `Connect to ${providerDetails.name}`,
        `Could not complete OAuth. Paste your ${providerDetails.name} OAuth token:`,
        '',
        { confirmText: 'Connect', cancelText: 'Cancel', confirmClass: 'btn-primary', inputType: 'password' },
      );
      if (!token) return;
      try {
        const result = await store.dispatch('appAuth/connectClaudeCodeManual', token);
        if (result?.success) {
          await showAlert('Success', result.message || `${providerDetails.name} connected successfully.`);
          await store.dispatch('appAuth/fetchConnectedApps');
          await refreshHealth();
        } else {
          await showAlert('Connection Failed', result?.error || `Failed to connect ${providerDetails.name}.`);
        }
      } catch (manualError) {
        await showAlert('Error', `Failed to connect ${providerDetails.name}: ${manualError.message}`);
      }
    }
  };

  const connectOAuthLoopback = async (providerId, providerDetails) => {
    try {
      const data = await providerAuthService.startOAuth(providerId);
      if (!data.authUrl) throw new Error('No authUrl returned');

      if (window.electron?.openExternalUrl) {
        window.electron.openExternalUrl(data.authUrl);
      } else {
        window.open(data.authUrl, '_blank');
      }

      const confirmed = await modalRef.value.showModal({
        title: `${providerDetails.name} Authentication`,
        message: `<div style="text-align:left">
          <p>A browser window has opened for authentication.</p>
          <p><strong>1.</strong> Sign in to your account</p>
          <p><strong>2.</strong> Click <strong>Allow</strong> to grant access</p>
          <p><strong>3.</strong> Return here and click <strong>I have signed in</strong></p>
        </div>`,
        confirmText: 'I have signed in',
        cancelText: 'Cancel',
        showCancel: true,
        confirmClass: 'btn-primary',
      });
      if (!confirmed) return;

      const maxAttempts = 20;
      for (let i = 0; i < maxAttempts; i++) {
        const status = await providerAuthService.pollOAuthStatus(providerId, data.sessionId);

        if (status.status === 'success') {
          localStorage.removeItem('Gemini_models');
          localStorage.removeItem('Gemini-CLI_models');
          await store.dispatch('appAuth/fetchConnectedApps');
          await refreshHealth();
          await showAlert('Success', `${providerDetails.name} connected successfully.`);
          return;
        }
        if (status.status === 'error') {
          await showAlert('Connection Failed', status.error || 'OAuth failed.');
          return;
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
      await showAlert('Connection Failed', 'OAuth timed out. Please try again.');
    } catch (error) {
      console.warn(`${providerDetails.name} OAuth failed, falling back to API key:`, error.message);
      const apiKey = await showPrompt(
        `Connect to ${providerDetails.name}`,
        `Could not complete OAuth. Paste your API key instead:`,
        '',
        { confirmText: 'Connect', cancelText: 'Cancel', confirmClass: 'btn-primary', inputType: 'password' },
      );
      if (!apiKey) return;
      try {
        const result = await providerAuthService.connect(providerId, { apiKey });
        if (result.success) {
          await showAlert('Success', `${providerDetails.name} connected with API key.`);
          await store.dispatch('appAuth/fetchConnectedApps');
          await refreshHealth();
        } else {
          await showAlert('Connection Failed', result.error || 'Failed to save API key.');
        }
      } catch (manualError) {
        await showAlert('Error', `Failed to connect ${providerDetails.name}: ${manualError.message}`);
      }
    }
  };

  const connectDeviceAuth = async (providerId, providerDetails) => {
    try {
      const session = await store.dispatch('appAuth/startProviderDeviceAuth', providerId);
      if (!session?.success) throw new Error(session?.error || 'Failed to start device login');
      if (session.state === 'error') {
        await showAlert('Device Login', session.message || 'Device login failed to start.');
        return;
      }

      const deviceUrl = session.deviceUrl || 'https://auth.openai.com/codex/device';
      const deviceCode = session.deviceCode || '(code unavailable)';
      if (!session.deviceUrl || !session.deviceCode) {
        await showAlert('Device Login', session.message || 'Device code was not returned yet. Please try again in a moment.');
        return;
      }

      const confirmed = await modalRef.value.showModal({
        title: `${providerDetails.name} Device Login`,
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

      const result = await store.dispatch('appAuth/pollProviderDeviceAuth', { providerId, sessionId: session.sessionId });
      if (result?.state === 'success') {
        await showAlert('Success', `${providerDetails.name} connected successfully.`);
        await refreshHealth();
      } else {
        await showAlert('Connection Failed', result?.message || 'Device login not completed yet.');
      }
    } catch (error) {
      console.error(`Error connecting ${providerDetails.name}:`, error);
      await showAlert('Connection Error', `Failed to connect ${providerDetails.name}: ${error.message}`);
    }
  };

  const disconnectProvider = async (providerId, providerDetails) => {
    const confirmDisconnect = await modalRef.value.showModal({
      title: 'Confirm Disconnection',
      message: `Are you sure you want to disconnect from ${providerDetails.name}?`,
      confirmText: 'Disconnect',
      cancelText: 'Cancel',
      confirmClass: 'btn-danger',
    });
    if (!confirmDisconnect) return;
    try {
      const result = await store.dispatch('appAuth/disconnectProvider', providerId);
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

  // ── remote provider flows (unchanged) ──────────────────────

  const connectOAuthApp = async (app) => {
    if (app.instructions) {
      const proceed = await modalRef.value.showModal({
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
      const normalizedId = resolveProviderKey(app.id) || app.id;
      const response = await fetch(
        `${API_CONFIG.REMOTE_URL}/auth/connect/${normalizedId}?origin=${encodeURIComponent(window.location.origin)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();
      if (data.authUrl) {
        const width = 600;
        const height = 700;
        const left = window.screenX + (window.outerWidth - width) / 2;
        const top = window.screenY + (window.outerHeight - height) / 2;
        const popup = window.open(
          data.authUrl,
          `oauth_${app.id}`,
          `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no,scrollbars=yes,resizable=yes`,
        );
        if (!popup) {
          await showAlert('Popup Blocked', 'Please allow popups for this site to connect integrations.');
          return;
        }
        const checkPopup = setInterval(() => {
          if (popup.closed) {
            clearInterval(checkPopup);
            refreshHealth();
          }
        }, 500);
      }
    } catch (error) {
      console.error(`Error connecting to ${app.name}:`, error);
      await showAlert('Connection Error', `Failed to connect to ${app.name}: ${error.message}`);
    }
  };

  const disconnectApp = async (app) => {
    const confirmDisconnect = await modalRef.value.showModal({
      title: 'Confirm Disconnection',
      message: `Are you sure you want to disconnect from ${app.name}?`,
      confirmText: 'Disconnect',
      cancelText: 'Cancel',
      confirmClass: 'btn-danger',
    });
    if (!confirmDisconnect) return;

    try {
      const token = localStorage.getItem('token');
      const normalizedId = resolveProviderKey(app.id) || app.id;
      const response = await fetch(`${API_CONFIG.REMOTE_URL}/auth/disconnect/${normalizedId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
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
    const promptMessage = app.instructions || app.custom_prompt || `Enter API Key for ${app.name}:`;
    const apiKey = await showPrompt(`Connect to ${app.name}`, promptMessage, '', {
      confirmText: 'Save',
      cancelText: 'Cancel',
      confirmClass: 'btn-primary',
      cancelClass: 'btn-secondary',
      inputType: 'password',
    });
    if (apiKey) await saveApiKey(app, apiKey);
  };

  const saveApiKey = async (app, apiKey) => {
    try {
      const token = localStorage.getItem('token');
      const encryptedApiKey = encrypt(apiKey);
      const normalizedId = resolveProviderKey(app.id) || app.id;
      const response = await fetch(`${API_CONFIG.REMOTE_URL}/auth/apikeys/${normalizedId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ apiKey: encryptedApiKey }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = result.error || result.message || result.details || `HTTP ${response.status}`;
        console.error(`[saveApiKey] ${app.name} (${normalizedId}) failed:`, { status: response.status, result });
        throw new Error(detail);
      }
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

  // ── main entry point (capability-driven) ───────────────────

  const handleProviderToggle = async (providerId) => {
    const providerDetails = await fetchProviderDetails(providerId);
    if (!providerDetails) {
      await showAlert('Error', 'Could not load provider details');
      return;
    }

    const connectionType = providerDetails.connectionType || providerDetails.connection_type;
    const normalizedId = String(providerId || '').toLowerCase();
    const connected = isProviderConnected(providerId);

    // Check if this is a local CLI provider via capabilities
    try {
      const capsResult = await providerAuthService.getCapabilities(normalizedId);
      if (capsResult?.local) {
        if (connected) {
          return disconnectProvider(normalizedId, providerDetails);
        }
        const caps = capsResult.capabilities || [];
        if (caps.includes('oauth-pkce')) return connectOAuthPkce(normalizedId, providerDetails);
        if (caps.includes('oauth-loopback')) return connectOAuthLoopback(normalizedId, providerDetails);
        if (caps.includes('device-auth')) return connectDeviceAuth(normalizedId, providerDetails);
        if (caps.includes('connect-apikey')) return promptApiKey(providerDetails);
      }
    } catch {
      // Capabilities endpoint not available — fall through to generic handling
    }

    // Generic providers
    if (connected) {
      return disconnectApp(providerDetails);
    }
    if (connectionType === 'oauth') {
      return connectOAuthApp(providerDetails);
    }
    if (connectionType === 'apikey') {
      return promptApiKey(providerDetails);
    }
    await showAlert('Configuration Required', `Please configure the connection type for ${providerDetails.name} in the settings.`);
  };

  // ── OAuth postMessage listener ───────────────────────────

  const handleOAuthMessage = async (event) => {
    const allowedOrigins = [window.location.origin, 'https://api.agnt.gg'];
    if (!allowedOrigins.some((origin) => event.origin === origin || event.origin.includes('localhost'))) return;

    if (event.data.type === 'oauth_success') {
      await refreshHealth();
    } else if (event.data.type === 'claude-code-oauth-success') {
      await store.dispatch('appAuth/fetchConnectedApps');
      await refreshHealth();
    } else if (event.data.type === 'oauth_error') {
      const providerName = event.data.provider || 'the service';
      const errorMessage = event.data.message || 'Authentication failed';
      await showAlert('Connection Error', `Failed to connect to ${providerName}: ${errorMessage}`);
    } else if (event.data.type === 'oauth-callback') {
      const { code, state, provider } = event.data;
      if (code && state) {
        try {
          const token = localStorage.getItem('token');
          const response = await fetch(`${API_CONFIG.REMOTE_URL}/auth/callback`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, state }),
          });
          if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
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
      }
    }
  };

  // ── lifecycle ────────────────────────────────────────────

  onMounted(async () => {
    await store.dispatch('appAuth/fetchAllProviders');
    await store.dispatch('appAuth/fetchConnectedApps');
    window.addEventListener('message', handleOAuthMessage);
  });

  onUnmounted(() => {
    window.removeEventListener('message', handleOAuthMessage);
  });

  return {
    allProviders,
    connectedApps,
    isProviderConnected,
    handleProviderToggle,
    refreshHealth,
  };
}
