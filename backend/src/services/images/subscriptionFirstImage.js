/**
 * OpenAI images: the ChatGPT/Codex subscription first, the API second.
 *
 * A user signed in to ChatGPT/Codex has image generation included in that
 * subscription, so an OpenAI image request is tried there first. It falls
 * back to the API (the OpenAI key, or the account's image provider) when the
 * subscription cannot serve the request or fails. Nothing is lost by trying:
 * the subscription call is bounded and never retried, and every failure is a
 * fallback, not an error, unless the API fails too.
 *
 * Requests the subscription cannot serve skip it up front, so they do not
 * spend a doomed round trip: more than one image, variations, and edits
 * without a PNG reference.
 */

export const SUBSCRIPTION_PROVIDER = 'openai-codex';
const SUBSCRIPTION_FIRST = new Set(['openai', 'openai-codex']);

export function isSubscriptionFirstProvider(provider) {
  return SUBSCRIPTION_FIRST.has(String(provider || '').toLowerCase());
}

/**
 * Is there a ChatGPT/Codex login with an account to bill images to? A local
 * check, no network call; an expired token is refreshed when the client is
 * built, and a rejected one simply falls back to the API.
 */
export async function chatGptSubscriptionSignedIn() {
  try {
    const { getConnection } = await import('../ai/connectionRuntime.js');
    const codex = getConnection(SUBSCRIPTION_PROVIDER);
    return Boolean(codex.getOAuthToken() && codex.getChatGptAccountId());
  } catch {
    return false;
  }
}

const isPngDataUri = (value) => typeof value === 'string' && value.startsWith('data:image/png;base64,');

/** Why the subscription cannot serve this request, or null when it can. */
export function subscriptionIneligibility(params) {
  const operation = params.imageOperation || 'Generate';
  if (operation === 'Variation') return 'variations are only available through the API';
  if (operation === 'Edit') {
    const refs = params.referenceImages || (params.referenceImage ? [params.referenceImage] : []);
    if (!refs.length || !refs.every(isPngDataUri)) return 'edits through the subscription need a PNG reference image';
  }
  if (Number(params.numberOfImages || 1) > 1) return 'the subscription returns one image per request';
  return null;
}

/**
 * @param {object} params  image request (mode 'Image Generation' params)
 * @param {object} deps
 * @param {{ signedIn: () => boolean|Promise<boolean>, generate: (params) => Promise<object> }} deps.subscription
 * @param {(params, provider: string) => Promise<object>} deps.api  the API path for `provider`
 * @returns {Promise<object>} the generator's result plus servedBy, servedProvider
 *   and, when the subscription was not used, subscriptionSkipped (the reason)
 */
export async function generateImageSubscriptionFirst(params, { subscription, api, log = console }) {
  const apiProvider = String(params.fallbackProvider || 'openai').toLowerCase();

  let skipped = subscriptionIneligibility(params);
  if (!skipped) {
    let signedIn = false;
    try {
      signedIn = Boolean(await subscription.signedIn());
    } catch {
      signedIn = false;
    }
    if (!signedIn) skipped = 'not signed in to ChatGPT/Codex';
  }

  if (!skipped) {
    try {
      const result = await subscription.generate(params);
      return { ...result, servedBy: 'subscription', servedProvider: SUBSCRIPTION_PROVIDER };
    } catch (error) {
      skipped = error?.message || 'subscription request failed';
      log.warn?.(`[Images] ChatGPT subscription could not generate this image (${skipped}); using the ${apiProvider} API.`);
    }
  }

  try {
    const result = await api(params, apiProvider);
    return { ...result, servedBy: 'api', servedProvider: apiProvider, subscriptionSkipped: skipped };
  } catch (error) {
    throw new Error(`${error?.message || 'API image generation failed'} (ChatGPT subscription: ${skipped})`);
  }
}
