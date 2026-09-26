/**
 * ARRIVING FROM ANOTHER CLOUD INSTANCE AS THE SAME USER.
 *
 * The page being left put a one-time sign-in code for THIS instance after `#`
 * (see composables/useSpaces.js signedInUrl). Here, before anything mounts, the
 * code is taken out of the address bar and traded at api.agnt.gg for a session,
 * the same way a URL token is adopted (urlSessionToken.js): nothing may mount
 * and poll with the wrong identity first.
 *
 * The code is removed from the address before it is redeemed, so a failed or
 * slow redemption never leaves it in history, a bookmark or a screenshot.
 * Every failure leaves the page exactly as it would have been without a code:
 * whoever is signed in here stays signed in, or the sign-in screen appears.
 */
import { API_CONFIG } from '@/tt.config.js';
import { looksLikeJwt } from './urlSessionToken.js';

const FRAGMENT = /(?:^#|&)agnt-signin=([A-Za-z0-9_-]{43})(?=&|$)/;

/** Take the code out of the address. Returns it, or null when there is none. */
export function takeInstanceSignInCode(host = globalThis.window) {
  try {
    const match = FRAGMENT.exec(host?.location?.hash || '');
    if (!match) return null;
    const { pathname, search } = host.location;
    host.history.replaceState(host.history.state, '', pathname + search);
    return match[1];
  } catch {
    return null;
  }
}

/**
 * Trade the code for a session and adopt it.
 * @returns {Promise<boolean>} whether a session was adopted
 */
export async function redeemInstanceSignInCode(store, code, { fetchImpl = globalThis.fetch, remoteUrl = API_CONFIG.REMOTE_URL } = {}) {
  try {
    const response = await fetchImpl(remoteUrl + '/tenants/signin-codes/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'status ' + response.status);
    if (!looksLikeJwt(body.token)) throw new Error('no session in the answer');
    if (store.state?.userAuth?.token !== body.token) store.commit('userAuth/SET_TOKEN', body.token);
    return true;
  } catch (error) {
    console.warn('[boot] could not carry your sign-in over from the other instance:', error.message);
    return false;
  }
}
