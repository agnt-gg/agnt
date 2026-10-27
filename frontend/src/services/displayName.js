import { API_CONFIG } from '@/tt.config.js';

/** The server keeps the first 32 characters of a display name (ReferralRoutes update-pseudonym). */
export const DISPLAY_NAME_MAX = 32;

/**
 * Save the signed-in person's display name, the one place that does.
 *
 * Onboarding asked for a name and then only logged it (a TODO), so a new
 * account kept its generated name ("Harsh Amethyst Seahorse") on desktop and
 * cloud alike. The server also re-issues the session with the new name in it;
 * dropping that token left the old name in everything that reads the token.
 *
 * @returns {Promise<string>} the name as the server stored it
 */
export async function saveDisplayName(store, name, { fetchImpl = fetch } = {}) {
  const wanted = String(name || '').trim();
  if (!wanted) throw new Error('Display name cannot be empty.');
  const response = await fetchImpl(`${API_CONFIG.REMOTE_URL}/referrals/update-pseudonym`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${store.state.userAuth.token}` },
    body: JSON.stringify({ newPseudonym: wanted }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) throw new Error(data.message || data.error || 'Failed to update display name');
  const saved = wanted.slice(0, DISPLAY_NAME_MAX);
  store.commit('userAuth/SET_PSEUDONYM', saved);
  if (typeof data.token === 'string' && data.token) store.commit('userAuth/ADOPT_RENEWED_TOKEN', data.token);
  return saved;
}
