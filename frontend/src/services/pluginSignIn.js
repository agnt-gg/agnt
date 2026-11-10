/**
 * Sign-ins declared by installed plugins (a manifest's `auth` entries).
 *
 * They exist only in this install, so connecting, saving a key and
 * disconnecting go to this backend's /api/providers/:id/auth/* routes. The
 * remote catalogue has never heard of them and answers 404. Every screen that
 * connects apps asks `isPluginSignIn` first and runs these flows for a match;
 * appAuth's remote actions refuse a plugin sign-in, so a screen that forgets
 * fails with a sentence rather than a 404.
 *
 * The flows know nothing about any one screen. A caller passes `ui`:
 *   prompt({ title, message, confirmText, secret }) -> string, or null when cancelled
 *   confirm({ title, message, confirmText, cancelText }) -> truthy when confirmed
 *   done(title, message)   the sign-in finished
 *   error(title, message)  it did not
 *   refresh()              re-read connections (optional)
 * `modalSignInUi` builds one over the app's SimpleModal.
 */
import providerAuthService from '@/services/providerAuthService.js';
import { escapeHtml } from '@/utils/vizError.js';

const POLL_ATTEMPTS = 20;
const POLL_INTERVAL_MS = 1500;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const errorText = (error) => error?.response?.data?.error || error?.message || String(error);

/**
 * True when this provider row is a plugin's own sign-in. The merged provider
 * list only carries a plugin's definition for an id the remote catalogue does
 * not define (appAuth's mergePluginProviders), so the flag alone decides.
 */
export function isPluginSignIn(provider) {
  return provider?.pluginProvided === true;
}

/** The plugin sign-in named `providerId` in `providers`, or null. */
export function findPluginSignIn(providers, providerId) {
  const wanted = String(providerId || '').toLowerCase();
  const match = (Array.isArray(providers) ? providers : []).find((p) => String(p?.id || '').toLowerCase() === wanted);
  return isPluginSignIn(match) ? match : null;
}

// The modal renders its message as HTML. Text a plugin author wrote is
// untrusted, so it is escaped before it gets anywhere near it.
export function pluginConnectMessage(provider, lead) {
  const parts = [`<p>${escapeHtml(lead)}</p>`];
  if (provider.instructions) parts.push(`<p>${escapeHtml(provider.instructions)}</p>`);
  if (provider.helpUrl) parts.push(`<p>Where to find it: <code>${escapeHtml(provider.helpUrl)}</code></p>`);
  return `<div style="text-align:left">${parts.join('')}</div>`;
}

function openInBrowser(url) {
  if (window.electron?.openExternalUrl) window.electron.openExternalUrl(url);
  else window.open(url, '_blank', 'noopener');
}

/** Save a plugin sign-in's API key in this install. Throws when it is refused. */
export async function savePluginApiKey(providerId, apiKey) {
  const result = await providerAuthService.connect(providerId, { apiKey });
  if (!result?.success) throw new Error(result?.error || 'Failed to save');
  return result;
}

/** Disconnect a plugin sign-in in this install. Throws when it is refused. */
export async function disconnectPluginSignIn(providerId) {
  const result = await providerAuthService.disconnect(providerId);
  if (result && result.success === false) throw new Error(result.error || 'Failed to disconnect.');
  return result;
}

async function connectApiKey(provider, ui) {
  const label = provider.keyLabel || 'API key';
  const apiKey = await ui.prompt({
    title: `Connect ${provider.name}`,
    message: pluginConnectMessage(provider, `Paste your ${provider.name} ${label}.`),
    confirmText: 'Connect',
    secret: true,
  });
  if (!apiKey) return false;
  try {
    await savePluginApiKey(provider.id, apiKey);
    await ui.refresh?.();
    await ui.done('Connected', `${provider.name} is connected.`);
    return true;
  } catch (error) {
    await ui.error('Connection Failed', errorText(error));
    return false;
  }
}

async function connectOAuth(provider, ui) {
  let client = {};
  if (provider.needsClientCredentials) {
    const clientId = await ui.prompt({
      title: `Connect ${provider.name}`,
      message: pluginConnectMessage(
        provider,
        `Create an OAuth app in your ${provider.name} developer settings with this redirect URI, then paste its client ID: ${provider.redirectUri || ''}`,
      ),
      confirmText: 'Next',
    });
    if (!clientId) return false;
    const clientSecret = await ui.prompt({
      title: `Connect ${provider.name}`,
      message: 'Paste the client secret (leave empty for a public client).',
      confirmText: 'Sign in',
      secret: true,
    });
    if (clientSecret === null) return false;
    client = { clientId, clientSecret: clientSecret || undefined };
  }
  try {
    const { authUrl, sessionId } = await providerAuthService.startPluginOAuth(provider.id, client);
    openInBrowser(authUrl);
    const confirmed = await ui.confirm({
      title: `${provider.name} sign-in`,
      message: `<p>Finish signing in to ${escapeHtml(provider.name)} in your browser, then come back here.</p>`,
      confirmText: 'I have signed in',
      cancelText: 'Cancel',
    });
    if (!confirmed) return false;
    for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
      const status = await providerAuthService.pollPluginOAuthStatus(provider.id, sessionId);
      if (status.status === 'success') {
        await ui.refresh?.();
        await ui.done('Connected', `${provider.name} is connected.`);
        return true;
      }
      if (status.status === 'error') {
        await ui.error('Connection Failed', status.error || 'Sign-in failed.');
        return false;
      }
      await wait(POLL_INTERVAL_MS);
    }
    await ui.error('Connection Failed', 'Sign-in did not complete. Try again.');
    return false;
  } catch (error) {
    await ui.error('Connection Failed', errorText(error));
    return false;
  }
}

/** Connect (or reconnect) a plugin sign-in. Resolves true once it is connected. */
export async function connectPluginSignIn(provider, ui) {
  const connectionType = provider?.connectionType || provider?.connection_type;
  if (connectionType === 'apikey') return connectApiKey(provider, ui);
  if (connectionType === 'oauth') return connectOAuth(provider, ui);
  await ui.error('Connection Failed', `${provider?.name || 'This app'} has no sign-in AGNT knows how to start.`);
  return false;
}

/** A `ui` over the app's SimpleModal (anything exposing showModal). */
export function modalSignInUi(modalRef, refresh) {
  const modal = () => modalRef?.value;
  const alert = (title, message) => modal()?.showModal({ title, message, confirmText: 'OK', showCancel: false });
  return {
    async prompt({ title, message, confirmText = 'Save', secret = false }) {
      const value = await modal()?.showModal({
        title,
        message,
        isPrompt: true,
        inputType: secret ? 'password' : 'text',
        placeholder: '',
        defaultValue: '',
        confirmText,
        cancelText: 'Cancel',
        confirmClass: 'btn-primary',
        showCancel: true,
      });
      return typeof value === 'string' ? value : null;
    },
    confirm({ title, message, confirmText = 'OK', cancelText = 'Cancel' }) {
      return modal()?.showModal({ title, message, confirmText, cancelText, showCancel: true, confirmClass: 'btn-primary' });
    },
    done: alert,
    error: alert,
    refresh,
  };
}
