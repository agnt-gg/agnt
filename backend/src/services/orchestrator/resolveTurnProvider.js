import { parseFallbackList, resolveProviderKey, resolveTierModel } from './ProviderFallback.js';

/**
 * Which provider/model a chat turn runs on, and which rung chose it.
 *
 *   1. request       the pair the client sent (a pin)
 *   2. conversation  the pair saved for THIS conversation
 *   3. agent         the responding agent's own config
 *   4. default       the account default
 *   5. fallback      the account's fallback chain, first usable tier
 *   6. credentials   any provider with a stored key (last resort)
 *
 * Rungs 2-6 contribute a WHOLE pair or nothing. Mixing halves across rungs is
 * how a turn ends up with one provider and another provider's model. Only a
 * request that named half a pair is completed from lower rungs, which keeps
 * API callers that send just a provider working as before.
 *
 * Why the conversation rung exists: the client only knows a conversation's
 * saved pair after it has loaded that conversation's settings. A turn sent
 * before then (right after a reload) used to fall through to the account
 * default and silently ignore the model chosen for that chat.
 *
 * Why the fallback rung precedes the credential scan: when the account has no
 * usable default, the user has already said what to run next. The scan walks
 * the provider registry in its own order and picks a static model, which is a
 * guess about someone else's preferences.
 *
 * Every loader is injected so each rung is testable without a database.
 *
 * @returns {Promise<{provider: string|null, model: string|null, source: string|null}>}
 */
export async function resolveTurnProvider({
  requestProvider,
  requestModel,
  conversationSettings = null,
  loadAgent = async () => null,
  loadUserSettings = async () => null,
  scanCredentials = async () => null,
}) {
  let provider = nonEmpty(requestProvider);
  let model = nonEmpty(requestModel);
  if (provider && model) return { provider, model, source: 'request' };

  const requestNamedHalf = Boolean(provider || model);

  // Settings are read once and shared by the default and fallback rungs.
  let userSettingsPromise = null;
  const userSettings = () => (userSettingsPromise ??= Promise.resolve().then(loadUserSettings).catch(() => null));

  const rungs = [
    ['conversation', async () => pairOf(conversationSettings?.provider, conversationSettings?.model)],
    ['agent', async () => {
      const agent = await loadAgent();
      return agent ? pairOf(agent.provider, agent.model) : null;
    }],
    ['default', async () => {
      const settings = await userSettings();
      return settings ? pairOf(settings.selectedProvider, settings.selectedModel) : null;
    }],
    ['fallback', async () => firstFallbackTier(await userSettings())],
    ['credentials', scanCredentials],
  ];

  for (const [source, loadPair] of rungs) {
    let pair = null;
    try {
      pair = await loadPair();
    } catch (err) {
      console.warn(`[Chat] Provider rung '${source}' failed:`, err?.message || err);
    }
    if (!pair) continue;

    if (!requestNamedHalf) {
      if (pair.provider && pair.model) return { provider: pair.provider, model: pair.model, source };
      continue;
    }

    provider = provider || pair.provider;
    model = model || pair.model;
    if (provider && model) return { provider, model, source: `request+${source}` };
  }

  return { provider, model, source: null };
}

/** First tier of the account fallback chain that names a runnable pair. */
export function firstFallbackTier(settings) {
  if (!settings || !settings.fallbackEnabled) return null;
  for (const tier of parseFallbackList(settings.fallbackProviders)) {
    const tierProvider = nonEmpty(tier.provider);
    if (!tierProvider) continue;
    const model = nonEmpty(tier.model) || resolveTierModel(tierProvider, null);
    if (!model) continue;
    return { provider: resolveProviderKey(tierProvider) || tierProvider, model };
  }
  return null;
}

function pairOf(provider, model) {
  const p = nonEmpty(provider);
  const m = nonEmpty(model);
  return p || m ? { provider: p, model: m } : null;
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

export default resolveTurnProvider;
