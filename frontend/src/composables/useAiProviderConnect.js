/**
 * Connect or select an AI provider from a provider tile, in one click.
 *
 * The ONE pipeline behind every "which AI" grid (onboarding's AI step and the
 * chat's no-model card). Each used to carry its own copy; they drifted until
 * onboarding had no Claude Code or Antigravity path at all, and both stacked
 * confirmation dialogs between the tile and a working chat.
 *
 * ONE CLICK means the tile click is the last thing AGNT asks for. What remains
 * is what the vendor itself requires and AGNT cannot do for the user:
 *   - OAuth: the vendor's consent page (opened straight away, no "Continue"
 *     pre-dialog).
 *   - Device login (Codex) and Google loopback (Antigravity): the browser
 *     sign-in. AGNT polls on its own and the waiting dialog closes itself on
 *     success; there is no "I have logged in" button to press.
 *   - Claude Code: Anthropic shows a code that must be pasted back.
 *   - API keys: the key itself (ProviderLanes opens the field in place).
 * Success is never announced with an OK-to-dismiss alert: the AI being in use
 * is the confirmation. Errors still say what went wrong.
 */
import { API_CONFIG } from '@/tt.config.js';
import { encrypt } from '@/views/_utils/encryption.js';
import { PROVIDER_FETCH_ACTIONS, providerStoreName, resolveProviderKey } from '@/store/app/aiProvider.js';
import providerAuthService from '@/services/providerAuthService.js';

/** How long a browser sign-in may take before AGNT stops waiting for it. */
export const SIGN_IN_WAIT_MS = 2 * 60 * 1000;
const POLL_INTERVAL_MS = 1500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// SimpleModal renders `message` as HTML; anything from a sign-in session is escaped.
const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

function openInBrowser(url) {
  if (window.electron?.openExternalUrl) window.electron.openExternalUrl(url);
  else window.open(url, '_blank');
}

/**
 * @param {import('vue').Ref} modalRef  a SimpleModal ref, for errors and the
 *   waiting dialog
 * @param {object} options
 * @param {import('vuex').Store} options.store
 * @param {string} options.source  recorded with the default change (default_ai_changes)
 * @param {(provider: object) => void} [options.onSelected]  after the AI is in use
 */
export function useAiProviderConnect(modalRef, { store, source, onSelected = () => {} }) {
  const connectedIds = () => (store.getters['appAuth/connectedApps'] ?? store.state.appAuth?.connectedApps) || [];
  const isConnected = (providerId) => {
    const key = resolveProviderKey(String(providerId || ''));
    return connectedIds().some((id) => String(id).toLowerCase() === key);
  };

  const showError = (title, message) =>
    modalRef.value?.showModal({ title, message, confirmText: 'OK', showCancel: false });

  /**
   * Show `dialog` while `work` runs; the dialog closes itself when `work`
   * settles. Resolves to work's result, or null if the user cancelled first.
   * A cancelled poll is left to time out on its own — its result is ignored,
   * and a sign-in that completes anyway is simply a connection that exists.
   */
  const waitWithDialog = async (dialog, work) => {
    const dialogClosed = modalRef.value.showModal({ ...dialog, showCancel: true, cancelText: 'Cancel', confirmText: 'Hide' });
    const finished = work.then((result) => ({ result }));
    const first = await Promise.race([finished, dialogClosed.then((ok) => ({ closed: true, ok }))]);
    if (!first.closed) {
      if (modalRef.value?.isOpen) modalRef.value.confirm();
      return first.result;
    }
    if (!first.ok) return null; // Cancel
    return (await finished).result; // "Hide": keep waiting without the dialog
  };

  const selectProvider = async (provider) => {
    const storeName = providerStoreName(provider.id);
    // Provider and model saved together in one write (aiProvider/useProvider).
    if (storeName !== 'Local' && (await store.dispatch('aiProvider/useProvider', { provider: storeName, source }))) {
      onSelected(provider);
      return;
    }
    await store.dispatch('aiProvider/setProvider', storeName);
    const fetchAction = PROVIDER_FETCH_ACTIONS[storeName];
    if (fetchAction) {
      try {
        await store.dispatch(fetchAction);
      } catch (error) {
        console.error(`Failed to fetch models for ${storeName}:`, error);
      }
    }
    onSelected(provider);
  };

  const connectOAuth = async (provider) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(
        `${API_CONFIG.REMOTE_URL}/auth/connect/${provider.id}?origin=${encodeURIComponent(window.location.origin)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();
      if (!data.authUrl) throw new Error('No authUrl provided in the response');
      window.location.href = data.authUrl;
    } catch (error) {
      console.error(`Error connecting to ${provider.name}:`, error);
      await showError('Connection Error', `Failed to connect to ${provider.name}: ${error.message}`);
    }
  };

  const connectCodex = async (provider) => {
    try {
      const status = await store.dispatch('appAuth/fetchCodexStatus');
      if (status?.available) {
        await selectProvider(provider);
        return;
      }
      const session = await store.dispatch('appAuth/startCodexDeviceAuth');
      if (!session?.success) throw new Error(session?.error || 'Failed to start Codex device login');
      if (session.state === 'error' || !session.deviceUrl || !session.deviceCode) {
        await showError('Codex Device Login', session.message || 'Codex device login could not start. Please try again in a moment.');
        return;
      }
      openInBrowser(session.deviceUrl);
      const result = await waitWithDialog(
        {
          title: 'Sign in to ChatGPT',
          message: `<div style="text-align:left">
            <p>A browser window opened at <code>${escapeHtml(session.deviceUrl)}</code>.</p>
            <p>Enter this code there:</p>
            <p><code style="font-size:18px;letter-spacing:2px">${escapeHtml(session.deviceCode)}</code></p>
            <p>This closes by itself once you are signed in.</p>
          </div>`,
        },
        store.dispatch('appAuth/pollCodexDeviceAuth', { sessionId: session.sessionId, timeoutMs: SIGN_IN_WAIT_MS }),
      );
      if (result === null) return;
      const latest = await store.dispatch('appAuth/fetchCodexStatus');
      if (result?.state === 'success' && latest?.available) {
        await selectProvider(provider);
        return;
      }
      const hint = latest?.hint ? `\n\n${latest.hint}` : '';
      await showError('ChatGPT not connected', `${result?.message || 'Sign-in was not completed.'}${hint}`);
    } catch (error) {
      console.error('Error connecting OpenAI Codex:', error);
      await showError('Connection Error', `Failed to connect ChatGPT: ${error.message}`);
    }
  };

  const pollAntigravity = async (sessionId) => {
    const deadline = Date.now() + SIGN_IN_WAIT_MS;
    while (Date.now() < deadline) {
      const status = await providerAuthService.pollOAuthStatus('antigravity', sessionId);
      if (status.status === 'success' || status.status === 'error') return status;
      await sleep(POLL_INTERVAL_MS);
    }
    return { status: 'error', error: 'Sign-in timed out. Please try again.' };
  };

  const connectAntigravity = async (provider) => {
    try {
      const data = await providerAuthService.startOAuth('antigravity');
      if (!data.authUrl) throw new Error('No authUrl returned');
      openInBrowser(data.authUrl);
      const status = await waitWithDialog(
        {
          title: 'Sign in to Antigravity',
          message: `<div style="text-align:left">
            <p>A browser window opened for your Google account. Sign in and click <strong>Allow</strong>.</p>
            <p>This closes by itself once you are signed in.</p>
            <p style="font-size:12px;opacity:.8">Unofficial integration: heavy automated use may trigger Google rate limits.</p>
          </div>`,
        },
        pollAntigravity(data.sessionId),
      );
      if (status === null) return;
      if (status.status !== 'success') {
        await showError('Connection Failed', status.error || 'Google sign-in failed.');
        return;
      }
      localStorage.removeItem('Antigravity_models');
      await store.dispatch('appAuth/fetchConnectedApps', { forceRefresh: true });
      await selectProvider(provider);
    } catch (error) {
      console.warn('Antigravity OAuth failed:', error.message);
      await showError('Connection Failed', `Sign-in error: ${error.message}`);
    }
  };

  const promptForSecret = async (title, message) => {
    const value = await modalRef.value.showModal({
      title,
      message,
      isPrompt: true,
      inputType: 'password',
      confirmText: 'Connect',
      cancelText: 'Cancel',
      confirmClass: 'btn-primary',
      showCancel: true,
    });
    return value || null;
  };

  const connectClaudeCode = async (provider) => {
    const status = await store.dispatch('appAuth/fetchClaudeCodeStatus');
    if (status?.available && status?.apiUsable) {
      await selectProvider(provider);
      return;
    }
    try {
      const data = await providerAuthService.startOAuth('claude-code');
      if (!data.authUrl) throw new Error('No authUrl returned');
      openInBrowser(data.authUrl);
      // Anthropic's flow ends on a page showing a code; pasting it back is the
      // one step the vendor requires.
      const codeState = await promptForSecret(
        'Sign in to Claude',
        `<div style="text-align:left">
          <p>A browser window opened. Sign in, click <strong>Authorize</strong>, then paste the code it shows:</p>
        </div>`,
      );
      if (!codeState) return;
      const exchange = await providerAuthService.exchangeOAuth('claude-code', { sessionId: data.sessionId, codeState });
      if (!exchange.success) {
        await showError('Connection Failed', exchange.error || 'Failed to exchange authorization code.');
        return;
      }
      localStorage.removeItem('Claude-Code_models');
      await store.dispatch('appAuth/fetchConnectedApps');
      await selectProvider(provider);
    } catch (error) {
      console.warn('Claude Code OAuth failed, falling back to paste-token:', error.message);
      const token = await promptForSecret(
        'Connect Claude Code',
        'Could not complete Anthropic sign-in. Paste your Claude Code OAuth token (starts with sk-ant-):',
      );
      if (!token) return;
      try {
        const result = await store.dispatch('appAuth/connectClaudeCodeManual', token);
        if (result?.success) await selectProvider(provider);
        else await showError('Connection Failed', result?.error || 'Failed to connect Claude Code.');
      } catch (manualError) {
        console.error('Error connecting Claude Code:', manualError);
        await showError('Connection Error', `Failed to connect Claude Code: ${manualError.message}`);
      }
    }
  };

  /** Store an API key on the account, then use that provider. */
  const saveApiKey = async (provider, apiKey) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_CONFIG.REMOTE_URL}/auth/apikeys/${provider.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ apiKey: encrypt(apiKey) }),
      });
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const result = await response.json();
      if (!result.success) throw new Error(result.message || 'Failed to save API key');
      await store.dispatch('appAuth/fetchConnectedApps');
      await selectProvider(provider);
    } catch (error) {
      console.error(`Error saving API key for ${provider.name}:`, error);
      await showError('Error', `Failed to save the API key for ${provider.name}: ${error.message}`);
    }
  };

  /** A provider tile was clicked: use it if AGNT can, otherwise start its sign-in. */
  const connect = async (provider) => {
    const id = String(provider?.id || '').toLowerCase();
    if (!id) return;
    // Included with the account, or nothing to sign in to.
    if (id === 'agnt' || id === 'local') return selectProvider(provider);
    // Local CLIs check their own sign-in first, so a connected seat is one click too.
    if (id === 'openai-codex') return connectCodex(provider);
    if (id === 'claude-code') return connectClaudeCode(provider);
    if (id === 'antigravity') {
      return isConnected(provider.id) ? selectProvider(provider) : connectAntigravity(provider);
    }
    if (isConnected(provider.id)) return selectProvider(provider);

    const connectionType = provider.connectionType || provider.connection_type;
    if (connectionType === 'oauth') return connectOAuth(provider);
    if (connectionType === 'apikey') {
      // ProviderLanes collects keys in place; this is the fallback for callers
      // that emit a bare connect for a key provider.
      const key = await promptForSecret(`Connect ${provider.name}`, `Paste your ${provider.name} API key:`);
      if (key) await saveApiKey(provider, key);
      return;
    }
    await showError('Configuration Required', `${provider.name} has no connection type configured.`);
  };

  return { connect, saveApiKey, selectProvider };
}
