/**
 * sessionDiscovery — "which coding CLIs is this machine already signed in to?"
 *
 * WHY
 * ---
 * Nothing in AGNT ever asked that question. Every provider answered "am I
 * connected?" individually, on demand, AFTER the user had already navigated to
 * the provider page and read the word "disconnected". A user with four CLIs
 * logged in on their machine saw four disconnected providers and no hint that
 * anything was there to find.
 *
 * This sweep asks all of them at once, so the answer can be offered instead of
 * hunted for.
 *
 * COST DISCIPLINE
 * ---------------
 * Discovery is allowed to touch the filesystem, read env vars, and read the OS
 * secret store (bounded + cached in secretStore.js). It is NOT allowed to make
 * network calls or spawn a CLI to ask its status: those cost seconds each and
 * would put a multi-second stall on the path of whoever triggers the sweep.
 * `checkApiUsable()` remains the thing that proves a token actually WORKS; this
 * only reports what exists.
 *
 * The distinction that makes the result useful is `ownedByAgnt`:
 *   true  → the user connected this in AGNT.
 *   false → we found their CLI's own session. Usable, but not ours to refresh
 *           or revoke.
 */

import { getCliProviderIds, getAuthEntry } from './AuthDispatcher.js';
import { secretStoreSupported } from './secretStore.js';

/**
 * Ask one manager what it has, tolerating the three shapes our managers come
 * in. Managers migrated to the resolver expose describeCredential(); the rest
 * still only offer a sync token read, which is enough to report presence.
 */
function describeProvider(providerId) {
  const entry = getAuthEntry(providerId);
  if (!entry || !entry.manager) return null;

  const manager = entry.manager;
  const providerName = entry.config?.name || providerId;

  // Preferred: full provenance.
  if (typeof manager.describeCredential === 'function') {
    try {
      const described = manager.describeCredential();
      return { providerId, providerName, ...described };
    } catch {
      // fall through to the coarse check
    }
  }

  // Fallback: presence only. Sync by contract — never await here, a hung
  // manager must not stall the sweep for every other provider.
  if (typeof manager.getAccessTokenSync === 'function') {
    try {
      const token = manager.getAccessTokenSync();
      return {
        providerId,
        providerName,
        connected: Boolean(token),
        source: token ? 'legacy-manager' : null,
        tier: null,
        ownedByAgnt: Boolean(token),
        label: token ? 'connected' : 'not connected',
        credPath: typeof manager.getCredentialsPath === 'function'
          ? safeCall(() => manager.getCredentialsPath())
          : null,
        keychainSupported: false,
      };
    } catch {
      // fall through
    }
  }

  return {
    providerId,
    providerName,
    connected: false,
    source: null,
    tier: null,
    ownedByAgnt: false,
    label: 'status unavailable',
    credPath: null,
    keychainSupported: false,
  };
}

function safeCall(fn) {
  try {
    return fn();
  } catch {
    return null;
  }
}

/**
 * Sweep every local CLI provider.
 *
 * @returns {{
 *   sessions: Array<object>,
 *   connected: Array<object>,
 *   adoptable: Array<object>,
 *   secretStoreSupported: boolean,
 *   checkedAt: string
 * }}
 *   `adoptable` is the interesting list: sessions that exist on this machine
 *   but were NOT created in AGNT. That is precisely the set worth surfacing as
 *   "we found these — use them?".
 */
export function discoverSessions() {
  const sessions = [];

  for (const providerId of getCliProviderIds()) {
    const described = describeProvider(providerId);
    if (described) sessions.push(described);
  }

  return {
    sessions,
    connected: sessions.filter((s) => s.connected),
    adoptable: sessions.filter((s) => s.connected && s.ownedByAgnt === false),
    secretStoreSupported: secretStoreSupported(),
    checkedAt: new Date().toISOString(),
  };
}
