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
import { getLocalStatus, startLmStudio, setupLocalModel, cancelLocalSetup } from '@/services/localModelsService.js';

/** How long a browser sign-in may take before AGNT stops waiting for it. */
export const SIGN_IN_WAIT_MS = 2 * 60 * 1000;
/** How long AGNT waits for LM Studio to be installed after opening its download page. */
export const LOCAL_INSTALL_WAIT_MS = 15 * 60 * 1000;
const LOCAL_POLL_MS = 3000;
/** Setup progress refresh, and how many failed status reads in a row end the wait. */
const LOCAL_SETUP_POLL_MS = 1000;
const LOCAL_SETUP_MAX_FAILED_POLLS = 30;
const SETUP_DONE_PHASES = ['ready', 'error', 'cancelled'];

/** 734003200 -> "700 MB", 2740937888 -> "2.6 GB". */
export function formatBytes(bytes) {
  const mb = bytes / 1024 ** 2;
  return mb < 1024 ? `${Math.max(1, Math.round(mb))} MB` : `${(mb / 1024).toFixed(1)} GB`;
}
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

  // ── Run a model on this machine ──
  // One click ends with a working local model. In order:
  //   1. a local model is already usable (LM Studio, Ollama, llama.cpp, or
  //      AGNT's own, which starts on first use): use it;
  //   2. LM Studio is installed but stopped: start it;
  //   3. otherwise AGNT downloads llama.cpp and the model that fits this
  //      machine, and runs it (backend services/localModels);
  //   4. where AGNT cannot run one itself (unsupported platform): LM Studio's
  //      download page.
  const hasModels = (status) => (status?.models?.length || 0) > 0;

  const useLocalModels = async (provider) => {
    await store.dispatch('aiProvider/fetchLocalModels', { forceRefresh: true }).catch(() => {});
    await selectProvider(provider);
  };

  const startLmStudioWithDialog = () =>
    waitWithDialog(
      { title: 'Starting LM Studio', message: '<p>Starting LM Studio\'s local server on this computer…</p><p>This closes by itself when it is ready.</p>' },
      startLmStudio(),
    );

  const waitForInstall = async () => {
    const deadline = Date.now() + LOCAL_INSTALL_WAIT_MS;
    while (Date.now() < deadline) {
      await sleep(LOCAL_POLL_MS);
      const status = await getLocalStatus().catch(() => null);
      if (status?.running || status?.installed) return status;
    }
    return null;
  };

  /** The old path, for machines AGNT cannot run a model on itself. */
  const offerLmStudioDownload = async (provider, status) => {
    const download = await modalRef.value.showModal({
      title: 'Run AI on this computer',
      message: `<div style="text-align:left">
        <p>Local models run through <strong>LM Studio</strong>, a free app. It isn't installed on this computer yet.</p>
        <p>Install it and download one model. AGNT will notice and connect on its own.</p>
        <p style="font-size:12px;opacity:.8">Local models are private and free, but slower than AGNT Flash unless this computer has a strong GPU.</p>
      </div>`,
      confirmText: 'Download LM Studio',
      cancelText: 'Not now',
      showCancel: true,
    });
    if (!download) return null;
    openInBrowser(status.downloadUrl || 'https://lmstudio.ai/download');
    const found = await waitWithDialog(
      { title: 'Waiting for LM Studio', message: '<p>Install LM Studio and open it once. This closes by itself when AGNT finds it.</p>' },
      waitForInstall(),
    );
    return found ?? null;
  };

  /** "Download & run" confirmation, sized to this machine. */
  const confirmManagedSetup = (managed, model) => {
    const engineBytes = managed.engine.installed ? 0 : managed.engine.bytes || 0;
    const total = (model.downloaded ? 0 : model.sizeBytes) + engineBytes;
    const where = model.fit === 'gpu'
      ? `runs fully on your ${escapeHtml(managed.hardware.gpu || 'GPU')}`
      : 'runs on this computer (partly in system memory, so replies are slower)';
    return modalRef.value.showModal({
      title: 'Run AI on this computer',
      message: `<div style="text-align:left">
        <p><strong>${escapeHtml(model.name)}</strong> ${where}. ${escapeHtml(model.blurb || '')}</p>
        <p>AGNT downloads it once and runs it here: private, free, and it works offline.</p>
        <p style="font-size:12px;opacity:.8">Already use LM Studio or Ollama? Start it and AGNT uses it automatically.</p>
      </div>`,
      confirmText: total > 0 ? `Download & run (${formatBytes(total)})` : 'Run it',
      cancelText: 'Not now',
      showCancel: true,
    });
  };

  const setupProgressHtml = (job, managed) => {
    const model = managed.models.find((entry) => entry.id === job.modelId);
    const name = escapeHtml(model?.name || job.modelId);
    const percent = job.bytesTotal ? Math.floor((job.bytesDone / job.bytesTotal) * 100) : 0;
    const bytes = job.bytesTotal ? `${formatBytes(job.bytesDone)} of ${formatBytes(job.bytesTotal)} (${percent}%)` : '';
    const line = {
      engine: `Downloading the AI engine for ${escapeHtml(managed.engine.label || 'this computer')}… ${bytes}`,
      model: `Downloading ${name}… ${bytes}`,
      starting: `Starting ${name} on this computer…`,
    }[job.phase] || '';
    return `<p>${line}</p><p style="font-size:12px;opacity:.8">Hide keeps it going in the background and switches to it when it is ready. Cancel stops it; a later try resumes the download.</p>`;
  };

  /**
   * Poll setup progress into the open dialog until it ends. Resolves to the
   * final status, or { unreachable: true } if the backend stopped answering
   * (never null: null is waitWithDialog's "the user pressed Cancel").
   */
  const followSetup = async () => {
    let failures = 0;
    for (;;) {
      const status = await getLocalStatus().catch(() => null);
      failures = status ? 0 : failures + 1;
      if (failures >= LOCAL_SETUP_MAX_FAILED_POLLS) return { unreachable: true };
      const job = status?.managed?.job;
      if (status && (!job || SETUP_DONE_PHASES.includes(job.phase))) return status;
      if (job && modalRef.value?.isOpen) modalRef.value.message = setupProgressHtml(job, status.managed);
      await sleep(LOCAL_SETUP_POLL_MS);
    }
  };

  const runManagedSetup = async (provider, status) => {
    const { managed } = status;
    const busy = managed.job && !SETUP_DONE_PHASES.includes(managed.job.phase);
    const model = managed.models.find((entry) => entry.id === (busy ? managed.job.modelId : managed.recommendedId));
    if (!model) {
      await showError('Not enough memory for a local model', 'This computer does not have enough memory to run a local AI model. AGNT Flash or a connected provider will work instead.');
      return;
    }
    if (!busy) {
      if (!(await confirmManagedSetup(managed, model))) return;
      try {
        await setupLocalModel(model.id);
      } catch (error) {
        await showError('Could not set up the local model', error.message);
        return;
      }
    }
    const final = await waitWithDialog(
      { title: `Setting up ${model.name}`, message: '<p>Preparing…</p>' },
      followSetup(),
    );
    if (final === null) {
      // Cancel pressed: stop the download; the parts are kept for a resume.
      await cancelLocalSetup().catch(() => {});
      return;
    }
    if (final.unreachable) {
      await showError('Lost contact with AGNT', 'The setup may still be running. Click "Run a model on this machine" again to see where it is.');
      return;
    }
    const job = final?.managed?.job;
    if (job?.phase === 'ready' && hasModels(final)) return useLocalModels(provider);
    if (job?.phase === 'cancelled') return;
    await showError('Local model setup failed', job?.error || 'The local model could not be set up.');
  };

  const connectLocal = async (provider) => {
    let status;
    try {
      status = await getLocalStatus();
    } catch (error) {
      await showError('Could not check this computer', `AGNT could not look for local models: ${error.message}`);
      return;
    }
    if (hasModels(status)) return useLocalModels(provider);

    if (status.canStart) {
      const started = await startLmStudioWithDialog();
      if (started === null) return;
      if (hasModels(started)) return useLocalModels(provider);
      if (!started?.running) {
        const why = started?.error === 'start_timeout'
          ? 'LM Studio did not start its server in time.'
          : started?.detail || 'LM Studio could not start its server.';
        await showError('LM Studio did not start', `${why} Open LM Studio, go to the Developer tab and turn on the local server, then try again.`);
        return;
      }
      status = started;
    }

    if (status.managed?.supported) return runManagedSetup(provider, status);

    if (status.running) {
      await showError(
        'Load a model in LM Studio',
        'LM Studio is running, but it has no model yet. Open LM Studio, download a model (Qwen 3.5 4B is a good start), and click "Run a model on this machine" again.',
      );
      return;
    }
    if (!status.installed) {
      const found = await offerLmStudioDownload(provider, status);
      if (!found) return;
      if (hasModels(found)) return useLocalModels(provider);
      if (found.canStart || found.installed) return connectLocal(provider);
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
    if (id === 'agnt') return selectProvider(provider);
    if (id === 'local') return connectLocal(provider);
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
