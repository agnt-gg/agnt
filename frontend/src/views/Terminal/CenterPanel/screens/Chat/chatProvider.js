/**
 * Which model the chat can use right now.
 *
 * AGNT Flash comes with every signed-in account: paid plans include it and free
 * accounts get trial credits. So a signed-in account ALWAYS has a model, and
 * the "connect a provider" card is only for someone who is not signed in. When
 * Flash runs out, models.agnt.gg says so in the chat itself, with the upgrade
 * and bring-your-own-key options; that is not this card's job either.
 *
 * Before this, a signed-in account whose chosen provider was not connected (an
 * old pick, a disconnected key, a stopped local server) got the connect card
 * even though Flash was right there.
 *
 * Pure: every input is passed in (chatProvider.spec.js).
 */

const lower = (value) => String(value || '').toLowerCase();

/**
 * @typedef {object} ProviderContext
 * @property {string|null} provider        the selected provider (display name or key)
 * @property {boolean} authenticated       signed in, so AGNT Flash is available
 * @property {string[]} [connectedApps]    connected provider keys
 * @property {{id:string}[]} [customProviders]
 * @property {boolean} [localRunning]      the local model server answers
 * @property {boolean} [connectionsSettled] connections were answered authoritatively
 * @property {(name:string)=>string} [resolveKey] display name → provider key
 */

/** Whether the selected provider itself can answer. */
export function providerUsable({ provider, authenticated, connectedApps = [], customProviders = [], localRunning = false, resolveKey = lower }) {
  if (!provider) return false;
  const name = lower(provider);
  if (name === 'agnt') return !!authenticated;
  if (name === 'local') return !!localRunning;
  if (customProviders.some((cp) => cp?.id === provider)) return true;
  const key = lower(resolveKey(provider));
  return connectedApps.some((app) => lower(app) === key);
}

/** The chat has a model: the chosen one works, or (signed in) AGNT Flash. */
export function chatHasModel(context) {
  return providerUsable(context) || !!context.authenticated;
}

/**
 * Move the chat onto AGNT Flash: signed in, and the chosen provider is KNOWN
 * not to work. "Known" matters: connections load after boot, and switching on
 * a list that has not arrived yet would throw away a working choice. Nothing
 * chosen at all also switches. A local server going away is handled where its
 * disconnect is detected (Chat.vue), not here, because "not running yet" at
 * boot is not "stopped".
 */
export function shouldSwitchToFlash(context) {
  if (!context.authenticated) return false;
  const name = lower(context.provider);
  if (name === 'agnt' || name === 'local') return false;
  if (!name) return true;
  return !!context.connectionsSettled && !providerUsable(context);
}
