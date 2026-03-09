/**
 * Shared composable for provider connect/disconnect flows.
 * Encapsulates the OAuth, API-key, Claude Code, and Codex CLI auth logic
 * that lives in IntegrationHealth.vue so other views can reuse it.
 */

import { computed, onMounted, onUnmounted } from 'vue';
import { useStore } from 'vuex';
import { API_CONFIG } from '@/tt.config.js';
import { PROVIDER_DISPLAY_NAMES, resolveProviderKey } from '@/store/app/aiProvider.js';
import { encrypt } from '@/views/_utils/encryption.js';

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

    // Hardcoded fallbacks for local-only providers
    if (normalizedId === 'openai-codex-cli') {
      return {
        id: 'openai-codex-cli',
        name: 'OpenAI Codex CLI',
        icon: 'openai',
        categories: ['AI'],
        connectionType: 'oauth',
        instructions: 'Uses Codex CLI locally (no API key). You will be given a URL and one-time code to complete sign-in.',
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
        instructions: 'Uses Claude Code CLI locally (no API key). Authenticate via setup-token or paste your OAuth token.',
        localOnly: true,
      };
    }
    if (normalizedId === 'gemini-cli') {
      return {
        id: 'gemini-cli',
        name: 'Gemini CLI',
        icon: 'google',
        categories: ['AI'],
        connectionType: 'oauth',
        instructions: 'Uses your Google account (no API key). Sign in with Google to use your AI Pro/Ultra subscription.',
        localOnly: true,
      };
    }

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

  // ── connection flows ─────────────────────────────────────

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

  const connectClaudeCode = async (providerDetails) => {
    try {
      const response = await fetch(`${API_CONFIG.BASE_URL}/claude-code/oauth/start`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!data.authUrl) throw new Error('No authUrl returned');

      if (window.electron?.openExternalUrl) {
        window.electron.openExternalUrl(data.authUrl);
      } else {
        window.open(data.authUrl, '_blank');
      }

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
        { confirmText: 'Connect', cancelText: 'Cancel', confirmClass: 'btn-primary', inputType: 'text' },
      );
      if (!codeState) return;

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
      console.warn('Claude Code OAuth failed, falling back to paste-token:', error.message);
      const token = await showPrompt(
        `Connect to ${providerDetails.name}`,
        'Could not complete Anthropic OAuth. Paste your Claude Code OAuth token (starts with sk-ant-):',
        '',
        { confirmText: 'Connect', cancelText: 'Cancel', confirmClass: 'btn-primary', inputType: 'password' },
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
    const confirmDisconnect = await modalRef.value.showModal({
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

  const connectCodex = async () => {
    try {
      const session = await store.dispatch('appAuth/startCodexDeviceAuth');
      if (!session?.success) throw new Error(session?.error || 'Failed to start Codex device login');
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

      const confirmed = await modalRef.value.showModal({
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
      console.error('Error connecting OpenAI Codex:', error);
      await showAlert('Connection Error', `Failed to connect OpenAI Codex: ${error.message}`);
    }
  };

  const connectGeminiCli = async (providerDetails) => {
    try {
      const response = await fetch(`${API_CONFIG.BASE_URL}/gemini-cli/oauth/start`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!data.authUrl) throw new Error('No authUrl returned');

      // Open Google sign-in in browser
      if (window.electron?.openExternalUrl) {
        window.electron.openExternalUrl(data.authUrl);
      } else {
        window.open(data.authUrl, '_blank');
      }

      // Show waiting modal while polling for completion
      const confirmed = await modalRef.value.showModal({
        title: 'Gemini CLI Authentication',
        message: `<div style="text-align:left">
          <p>A browser window has opened for Google authentication.</p>
          <p><strong>1.</strong> Sign in to your Google account</p>
          <p><strong>2.</strong> Click <strong>Allow</strong> to grant access</p>
          <p><strong>3.</strong> Return here and click <strong>I have signed in</strong></p>
        </div>`,
        confirmText: 'I have signed in',
        cancelText: 'Cancel',
        showCancel: true,
        confirmClass: 'btn-primary',
      });
      if (!confirmed) return;

      // Poll the session status
      const maxAttempts = 20;
      for (let i = 0; i < maxAttempts; i++) {
        const statusResponse = await fetch(`${API_CONFIG.BASE_URL}/gemini-cli/oauth/status?sessionId=${data.sessionId}`);
        const status = await statusResponse.json();

        if (status.status === 'success') {
          localStorage.removeItem('Gemini_models');
          localStorage.removeItem('Gemini-CLI_models');
          await store.dispatch('appAuth/fetchConnectedApps');
          await refreshHealth();
          await showAlert('Success', 'Gemini CLI connected successfully via Google account.');
          return;
        }
        if (status.status === 'error') {
          await showAlert('Connection Failed', status.error || 'Google OAuth failed.');
          return;
        }
        // Still pending — wait and retry
        await new Promise((r) => setTimeout(r, 1500));
      }
      await showAlert('Connection Failed', 'OAuth timed out. Please try again.');
    } catch (error) {
      console.warn('Gemini CLI OAuth failed, falling back to API key:', error.message);
      const apiKey = await showPrompt(
        `Connect to ${providerDetails?.name || 'Gemini CLI'}`,
        'Could not complete Google OAuth. Paste your Gemini API key instead:',
        '',
        { confirmText: 'Connect', cancelText: 'Cancel', confirmClass: 'btn-primary', inputType: 'password' },
      );
      if (!apiKey) return;
      try {
        const result = await fetch(`${API_CONFIG.BASE_URL}/gemini-cli/connect`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey }),
        });
        const respData = await result.json();
        if (respData.success) {
          await showAlert('Success', 'Gemini CLI connected with API key.');
          await store.dispatch('appAuth/fetchConnectedApps');
          await refreshHealth();
        } else {
          await showAlert('Connection Failed', respData.error || 'Failed to save API key.');
        }
      } catch (manualError) {
        await showAlert('Error', `Failed to connect Gemini CLI: ${manualError.message}`);
      }
    }
  };

  const disconnectGeminiCli = async (providerDetails) => {
    const confirmDisconnect = await modalRef.value.showModal({
      title: 'Confirm Disconnection',
      message: `Are you sure you want to disconnect from ${providerDetails?.name || 'Gemini CLI'}?`,
      confirmText: 'Disconnect',
      cancelText: 'Cancel',
      confirmClass: 'btn-danger',
    });
    if (!confirmDisconnect) return;
    try {
      const result = await store.dispatch('appAuth/disconnectGeminiCli');
      if (result?.success) {
        await showAlert('Success', `Successfully disconnected from ${providerDetails?.name || 'Gemini CLI'}`);
        await refreshHealth();
      } else {
        await showAlert('Error', result?.error || 'Failed to disconnect.');
      }
    } catch (error) {
      await showAlert('Error', `Failed to disconnect: ${error.message}`);
    }
  };

  const disconnectCodex = async (providerDetails) => {
    const confirmDisconnect = await modalRef.value.showModal({
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

  // ── main entry point ─────────────────────────────────────

  const handleProviderToggle = async (providerId) => {
    const providerDetails = await fetchProviderDetails(providerId);
    if (!providerDetails) {
      await showAlert('Error', 'Could not load provider details');
      return;
    }

    const connectionType = providerDetails.connectionType || providerDetails.connection_type;
    const normalizedId = String(providerId || '').toLowerCase();
    const connected = isProviderConnected(providerId);

    // Claude Code
    if (normalizedId === 'claude-code') {
      return connected ? disconnectClaudeCode(providerDetails) : connectClaudeCode(providerDetails);
    }
    // Codex CLI
    if (normalizedId === 'openai-codex-cli') {
      return connected ? disconnectCodex(providerDetails) : connectCodex();
    }
    // Gemini CLI
    if (normalizedId === 'gemini-cli') {
      return connected ? disconnectGeminiCli(providerDetails) : connectGeminiCli(providerDetails);
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
