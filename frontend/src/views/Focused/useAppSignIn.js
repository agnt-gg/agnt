/**
 * Sign-in actions for an app card, run where the click happened.
 *
 * Connect used to open the account's own page, where a second Connect button
 * started the sign-in: two clicks for one intent (reported 2026-10-26, "user
 * clicks are sacred"). Every caller now starts the sign-in itself: OAuth opens
 * the provider's consent popup, an API key is asked for in one dialog, and
 * disconnect confirms in place. The account page uses the same functions, so
 * the two entry points cannot drift.
 *
 * Errors are surfaced, never swallowed: `error` holds the last failure for a
 * page that shows it inline, and `nav.toast` reports it everywhere else.
 */
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { CLI_DISCONNECT_ACTIONS } from './focusedModel.js';
import { describeApps } from '@/services/appCards.js';
import providerAuthService from '@/services/providerAuthService.js';
import { isTrustedOAuthMessageOrigin, hasOAuthMessagePayload } from '@/utils/oauthMessageOrigin.js';

const POPUP = { width: 600, height: 700 };

/**
 * @param {object}   deps
 * @param {object}   deps.store     the Vuex store
 * @param {object}   deps.nav       focusedNav (toast, confirm, prompt, studio, ask)
 * @param {Function} deps.findCard  id => the current app card, re-read after a sign-in
 */
export function useAppSignIn({ store, nav, findCard }) {
  const busy = ref(false);
  const error = ref('');
  let popupTimer = null;

  // The catalogue keeps its own id casing ('Slack'); the auth endpoints want it.
  function catalogueId(card) {
    const wanted = String(card?.providerId || '').toLowerCase();
    const entry = (store.state.appAuth?.allProviders || []).find((p) => String(p.id).toLowerCase() === wanted);
    return entry ? String(entry.id) : card?.providerId;
  }

  function fail(message) {
    error.value = message;
    nav.toast(message);
    return false;
  }

  /** OAuth: the provider's consent page in a popup; resolves once it closes. */
  async function signInWithPopup(card) {
    error.value = '';
    busy.value = true;
    let authUrl;
    try {
      authUrl = await store.dispatch('appAuth/requestOAuthUrl', catalogueId(card));
    } catch (e) {
      busy.value = false;
      return fail(`Couldn’t start connecting ${card.name}. ${e?.message || e}`);
    }
    const left = window.screenX + (window.outerWidth - POPUP.width) / 2;
    const top = window.screenY + (window.outerHeight - POPUP.height) / 2;
    const popup = window.open(
      authUrl,
      `oauth_${catalogueId(card)}`,
      `width=${POPUP.width},height=${POPUP.height},left=${left},top=${top},toolbar=no,menubar=no,scrollbars=yes,resizable=yes`,
    );
    if (!popup) {
      busy.value = false;
      return fail('The sign-in window was blocked. Allow pop-ups for AGNT and try again.');
    }
    // Re-read connections once the popup closes. One timer at a time, cleared
    // on close and on unmount, so nothing polls after the page is gone.
    clearInterval(popupTimer);
    return new Promise((resolve) => {
      popupTimer = setInterval(async () => {
        if (!popup.closed) return;
        clearInterval(popupTimer);
        popupTimer = null;
        await store.dispatch('appAuth/refreshAfterConnect').catch((e) => console.warn('[sign-in] refresh failed:', e?.message || e));
        // A reconnect clears the failing state only once health is re-read.
        await store.dispatch('appAuth/checkConnectionHealth').catch((e) => console.warn('[sign-in] health check failed:', e?.message || e));
        busy.value = false;
        const ready = findCard(card.providerId)?.status === 'ready';
        if (ready) nav.toast(`${card.name} connected.`);
        resolve(ready);
      }, 500);
    });
  }

  /** API key: saved as given; an empty key is a no-op, not an error. */
  async function saveKey(card, key) {
    const trimmed = String(key || '').trim();
    if (!trimmed) return false;
    error.value = '';
    busy.value = true;
    try {
      await store.dispatch('appAuth/saveApiKey', { providerId: catalogueId(card), apiKey: trimmed });
      await store.dispatch('appAuth/checkConnectionHealth').catch((e) => console.warn('[sign-in] health check failed:', e?.message || e));
      nav.toast(`${card.name} connected.`);
      return true;
    } catch (e) {
      return fail(`Couldn’t save the ${card.name} key. ${e?.message || e}`);
    } finally {
      busy.value = false;
    }
  }

  /** One dialog for the key; cancelling it does nothing. */
  async function promptForKey(card) {
    const key = await nav.prompt({
      title: `Connect ${card.name}`,
      message: `Paste your ${card.name} API key. It is stored in your AGNT vault.`,
      placeholder: 'API key',
      secret: true,
      confirmText: 'Connect',
    });
    return key ? saveKey(card, key) : false;
  }

  /** Connect or reconnect, by how this card signs in. */
  function signIn(card) {
    switch (card?.connectionType) {
      case 'oauth':
        return signInWithPopup(card);
      case 'apikey':
        return promptForKey(card);
      case 'cli':
        // Signs in on this computer with a code from its own app: Studio's guided setup.
        nav.studio('ConnectorsScreen', { section: 'oauth' });
        return Promise.resolve(false);
      default:
        nav.ask(`Connect ${card?.name || 'this app'} to AGNT`);
        return Promise.resolve(false);
    }
  }

  async function disconnect(card) {
    const name = card.name;
    // One sign-in can power several apps; say which ones stop.
    const stops = describeApps(card);
    const message = stops && card.apps?.length > 1
      ? `${stops} will stop working until you connect ${name} again.`
      : `AGNT won’t be able to use ${name} until you connect it again.`;
    if (!(await nav.confirm({ title: `Disconnect ${name}?`, message, confirmText: 'Disconnect', danger: true }))) return false;
    error.value = '';
    busy.value = true;
    try {
      const cliAction = CLI_DISCONNECT_ACTIONS[card.providerId];
      if (cliAction) {
        const result = await store.dispatch(cliAction);
        if (result && result.success === false) throw new Error(result.error || 'Failed to disconnect.');
        await store.dispatch('appAuth/fetchConnectedApps', { forceRefresh: true });
      } else {
        await store.dispatch('appAuth/disconnectApp', catalogueId(card));
      }
      nav.toast(`${name} disconnected.`);
      return true;
    } catch (e) {
      return fail(`Couldn’t disconnect ${name}. ${e?.message || e}`);
    } finally {
      busy.value = false;
    }
  }

  // Desktop path: for the desktop app's origin, api.agnt.gg's callback page postMessages the raw
  // `code` to the opener instead of exchanging it, and the opener must POST it to /auth/callback.
  // Without this listener the popup closed and nothing was ever stored (Connectors does the same).
  async function onOAuthMessage(event) {
    if (!isTrustedOAuthMessageOrigin(event.origin)) return;
    if (!hasOAuthMessagePayload(event)) return;
    if (event.data.type !== 'oauth-callback') return;
    const { code, state } = event.data;
    try {
      const result = await providerAuthService.completeRemoteOAuthCallback({ code, state });
      if (!result?.success) throw new Error(result?.error || 'OAuth completion failed');
      await store.dispatch('appAuth/refreshAfterConnect').catch((e) => console.warn('[sign-in] refresh failed:', e?.message || e));
      await store.dispatch('appAuth/checkConnectionHealth').catch((e) => console.warn('[sign-in] health check failed:', e?.message || e));
    } catch (e) {
      busy.value = false;
      fail(`Couldn’t finish connecting the service. ${e?.message || e}`);
    }
  }

  onMounted(() => window.addEventListener('message', onOAuthMessage));
  onBeforeUnmount(() => {
    clearInterval(popupTimer);
    window.removeEventListener('message', onOAuthMessage);
  });

  return { busy, error, signIn, signInWithPopup, saveKey, promptForKey, disconnect };
}
