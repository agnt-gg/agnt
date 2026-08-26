<template>
  <div class="provider-setup">
    <ProviderLanes
      :providers="allProviders"
      :connected-ids="connectedApps"
      :codex-status="codexStatus"
      @connect="handleProviderClick"
      @submit-credential="saveApiKey"
    />
    <SimpleModal ref="modal" />
  </div>
</template>

<script>
import { ref, computed, onMounted } from 'vue';
import { useStore } from 'vuex';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import ProviderLanes from '@/components/ProviderLanes.vue';
import { API_CONFIG } from '@/tt.config.js';
import { encrypt } from '@/views/_utils/encryption.js';
import {
  PROVIDER_FETCH_ACTIONS,
  resolveProviderKey,
} from '@/store/app/aiProvider.js';
import providerAuthService from '@/services/providerAuthService.js';

export default {
  name: 'ProviderSetup',
  components: {
    SimpleModal,
    ProviderLanes,
  },
  emits: ['provider-connected'],
  setup(props, { emit }) {
    const store = useStore();
    const modal = ref(null);

    const allProviders = computed(() => store.state.appAuth.allProviders || []);
    const connectedApps = computed(() => store.state.appAuth.connectedApps || []);
    const codexStatus = computed(() => store.state.appAuth.codexStatus || {});
    const claudeCodeStatus = computed(() => store.state.appAuth.claudeCodeStatus || {});

    /**
     * The filter, sort and lane split live in ProviderLanes.vue, shared with
     * the onboarding modal. This card held a private copy that fell behind:
     * the modal learned to order and label by what it renders, this one kept
     * sorting by the auth API's `name`, so ChatGPT sat under O here and under
     * C there. Rendering the same component is what makes that unrepeatable.
     */

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

    const getCodexWorkdirHtml = (status) => {
      const workdir = status?.codexWorkdir || codexStatus.value?.codexWorkdir;
      if (!workdir) return '';
      return `
        <div style="text-align:left;margin-top:8px">
          <p><strong>Codex working directory:</strong></p>
          <p><code>${workdir}</code></p>
        </div>
      `;
    };

    // Map provider ID to the correct case used in the store
    const getProviderCase = (providerId) => {
      const providerMap = {
        anthropic: 'Anthropic',
        'claude-code': 'Claude-Code',
        openai: 'OpenAI',
        'openai-codex': 'OpenAI-Codex',
        chutes: 'Chutes',
        gemini: 'Gemini',
        grokai: 'GrokAI',
        groq: 'Groq',
        local: 'Local',
        openrouter: 'OpenRouter',
        togetherai: 'TogetherAI',
      };
      return providerMap[providerId.toLowerCase()] || providerId;
    };

    /**
     * "Already connected" is not one thing. It can mean the user connected here,
     * or that AGNT discovered the CLI's own session on this machine. Saying which
     * is the difference between a mysterious green light and an explained one —
     * and it tells the user whether Disconnect will actually end that session.
     */
    const connectionDetail = (providerId) => {
      const status = store.state.appAuth?.cliProviderStatuses?.[providerId];
      if (!status?.sourceLabel) return '';
      return status.ownedByAgnt
        ? `\n\nSource: ${status.sourceLabel}.`
        : `\n\nSource: ${status.sourceLabel}. AGNT is using the session your CLI created — disconnecting here removes AGNT's access, not the CLI's.`;
    };

    const isProviderConnected = (providerId) => {
      const providerKey = resolveProviderKey(providerId);
      return connectedApps.value.some((app) => app.toLowerCase() === providerKey);
    };

    const selectProvider = async (provider) => {
      const correctCase = getProviderCase(provider.id);
      await store.dispatch('aiProvider/setProvider', correctCase);

      // Fetch models so the store auto-selects the first one
      const fetchAction = PROVIDER_FETCH_ACTIONS[correctCase];
      if (fetchAction) {
        try {
          await store.dispatch(fetchAction);
        } catch (error) {
          console.error(`Failed to fetch models for ${correctCase}:`, error);
        }
      }

      emit('provider-connected', provider);
    };

    const handleProviderClick = async (provider) => {
      // Local provider doesn't require authentication - just set it directly
      if (provider.id.toLowerCase() === 'local') {
        await selectProvider(provider);
        await showAlert('Success', `${provider.name} provider selected successfully!`);
        return;
      }

      // OpenAI Codex providers use a local device auth flow via the Codex CLI.
      const providerLower = provider.id.toLowerCase();
      if (providerLower === 'openai-codex' || providerLower === 'openai-codex') {
        await connectCodexProvider(provider);
        return;
      }

      // Claude Code provider uses local OAuth via the Claude CLI.
      if (providerLower === 'claude-code') {
        await connectClaudeCodeProvider(provider);
        return;
      }

      // Antigravity uses local Google OAuth (loopback) via the Antigravity gateway.
      if (providerLower === 'antigravity') {
        await connectAntigravityProvider(provider);
        return;
      }

      // If already connected, just select it.
      if (isProviderConnected(provider.id)) {
        await selectProvider(provider);
        await showAlert('Provider Ready', `${provider.name} is already connected on this machine.${connectionDetail(provider.id)}`);
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

    const connectAntigravityProvider = async (provider) => {
      // Already connected on this machine? Just select it.
      if (isProviderConnected(provider.id)) {
        await selectProvider(provider);
        await showAlert('Provider Ready', `${provider.name} is already connected on this machine.${connectionDetail(provider.id)}`);
        return;
      }

      try {
        const data = await providerAuthService.startOAuth('antigravity');
        if (!data.authUrl) throw new Error('No authUrl returned');

        if (window.electron?.openExternalUrl) {
          window.electron.openExternalUrl(data.authUrl);
        } else {
          window.open(data.authUrl, '_blank');
        }

        const confirmed = await modal.value.showModal({
          title: 'Antigravity Authentication',
          message: `<div style="text-align:left">
            <p style="background:rgba(255,180,0,0.1);border:1px solid rgba(255,180,0,0.3);border-radius:6px;padding:8px 10px;font-size:12px;color:rgba(255,180,0,0.85);margin-bottom:12px">
              ⚠️ This is an unofficial integration. Antigravity access is provided through your Google account's subscription — heavy automated usage may trigger rate limits or account restrictions. Use responsibly.
            </p>
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

        const maxAttempts = 20;
        for (let i = 0; i < maxAttempts; i++) {
          const status = await providerAuthService.pollOAuthStatus('antigravity', data.sessionId);

          if (status.status === 'success') {
            localStorage.removeItem('Antigravity_models');
            await store.dispatch('appAuth/fetchConnectedApps', { forceRefresh: true });
            await selectProvider(provider);
            await showAlert('Success', 'Antigravity connected via Google account.');
            return;
          }
          if (status.status === 'error') {
            await showAlert('Connection Failed', status.error || 'Google OAuth failed.');
            return;
          }
          await new Promise((r) => setTimeout(r, 1500));
        }
        await showAlert('Connection Failed', 'OAuth timed out. Please try again.');
      } catch (error) {
        console.warn('Antigravity OAuth failed:', error.message);
        await showAlert('Connection Failed', `OAuth error: ${error.message}`);
      }
    };

    const connectCodexProvider = async (provider) => {
      try {
        const providerLower = provider.id.toLowerCase();
        const isCliProvider = providerLower === 'openai-codex';
        const status = await store.dispatch('appAuth/fetchCodexStatus');
        if (status?.available && (isCliProvider || status?.apiUsable)) {
          await selectProvider(provider);
          const readyMessage = isCliProvider
            ? 'OpenAI Codex is already connected on this machine.'
            : 'OpenAI Codex is already connected and API access is available.';
          await showAlert('Provider Ready', `${readyMessage}${getCodexWorkdirHtml(status)}`);
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
          const latestStatus = await store.dispatch('appAuth/fetchCodexStatus');
          const isReady = latestStatus?.available && (isCliProvider || latestStatus?.apiUsable);

          if (isReady) {
            await selectProvider(provider);
            const successMessage = isCliProvider
              ? 'OpenAI Codex connected successfully.'
              : 'OpenAI Codex connected successfully.';
            await showAlert('Success', `${successMessage}${getCodexWorkdirHtml(latestStatus)}`);
            return;
          }

          const hint = latestStatus?.hint ? `\n\n${latestStatus.hint}` : '';
          const suggestion = isCliProvider
            ? ''
            : '\n\nTip: If you do not have OpenAI API access, use the OpenAI Codex provider instead.';
          await showAlert('Codex Not Ready', `Device login completed but the provider is not ready yet.${hint}${suggestion}`);
        } else {
          const latestStatus = await store.dispatch('appAuth/fetchCodexStatus');
          const hint = latestStatus?.hint ? `\n\n${latestStatus.hint}` : '';
          await showAlert('Codex Not Ready', `${result?.message || 'Device login not completed yet.'}${hint}`);
        }
      } catch (error) {
        console.error('Error connecting OpenAI Codex:', error);
        await showAlert('Connection Error', `Failed to connect OpenAI Codex: ${error.message}`);
      }
    };

    const connectClaudeCodeProvider = async (provider) => {
      const status = await store.dispatch('appAuth/fetchClaudeCodeStatus');
      if (status?.available && status?.apiUsable) {
        await selectProvider(provider);
        await showAlert('Provider Ready', 'Claude Code is already connected on this machine.');
        return;
      }

      try {
        const data = await providerAuthService.startOAuth('claude-code');
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
          ''
        );

        if (!codeState) return;

        const exchangeResult = await providerAuthService.exchangeOAuth('claude-code', {
          sessionId: data.sessionId,
          codeState,
        });

        if (exchangeResult.success) {
          localStorage.removeItem('Claude-Code_models');
          await store.dispatch('appAuth/fetchConnectedApps');
          await selectProvider(provider);
          await showAlert('Success', 'Claude Code connected successfully.');
        } else {
          await showAlert('Connection Failed', exchangeResult.error || 'Failed to exchange authorization code.');
        }
      } catch (error) {
        // Fall back to paste-token prompt
        console.warn('Claude Code OAuth failed, falling back to paste-token:', error.message);

        const token = await showPrompt(
          'Connect Claude Code',
          'Could not complete Anthropic OAuth. Paste your Claude Code OAuth token (starts with sk-ant-):',
          ''
        );

        if (!token) return;

        try {
          const result = await store.dispatch('appAuth/connectClaudeCodeManual', token);
          if (result?.success) {
            await selectProvider(provider);
            await showAlert('Success', result.message || 'Claude Code connected successfully.');
          } else {
            await showAlert('Connection Failed', result?.error || 'Failed to connect Claude Code.');
          }
        } catch (manualError) {
          console.error('Error connecting Claude Code:', manualError);
          await showAlert('Connection Error', `Failed to connect Claude Code: ${manualError.message}`);
        }
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

          // Set this as the selected AI provider and fetch models
          await selectProvider(provider);
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
      await store.dispatch('appAuth/fetchConnectedApps');

    });

    return {
      allProviders,
      connectedApps,
      codexStatus,
      handleProviderClick,
      saveApiKey,
      modal,
    };
  },
};
</script>

<style scoped>
/* The grid, tiles and lane copy live in ProviderLanes.vue, shared with the
   onboarding modal. This card kept its own near-copy — a different gap, no
   transition, a different hover colour — which is how the two screens came to
   disagree about the same list. */
.provider-setup {
  width: 100%;
}

/* The shared component centres itself inside the 700px onboarding modal. A
   sidebar-width chat panel wants neither the cap nor the top margin. */
.provider-setup :deep(.provider-lanes) {
  margin-top: 0;
  max-width: none;
}
</style>
