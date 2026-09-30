/**
 * googleSubscriptionModels.js — the ONE place that answers "which models does
 * this Google subscription account have?" for Antigravity and Gemini CLI
 * (OAuth). Both the list route and the refresh route call it.
 *
 * The refresh route used to send these providers through the generic OAuth
 * path, which has no Google catalog, so pressing Refresh replaced the live
 * list with the static fallback — the button made the list staler.
 *
 * Returns `{ status, body }` for the route to send, or `null` when the caller
 * should keep its own handling (Gemini CLI in API-key mode, which lists
 * dynamically through the public Gemini API).
 */

import AntigravityAuthManager from '../auth/AntigravityAuthManager.js';
import GeminiCliAuthManager from '../auth/GeminiCliAuthManager.js';
import { getProviderConfig, registerDynamicPricingFromModels } from './providerConfigs.js';
import { persistLastModels } from './lastModelsCache.js';
import { antigravityMetadataRecords } from './googleModelCatalog.js';
import { LISTING_SOURCE, listing, provenanceFields } from './modelListing.js';

export const GOOGLE_SUBSCRIPTION_PROVIDERS = Object.freeze(['antigravity', 'gemini-cli']);

const reply = (status, body) => ({ status, body });
const listed = (models, dynamic, unavailableReason) => reply(200, {
  success: true, models, cached: false, count: models.length, dynamic,
  ...provenanceFields(dynamic
    ? listing(LISTING_SOURCE.LIVE, { fetchedAt: Date.now() })
    : listing(LISTING_SOURCE.FALLBACK, { error: unavailableReason })),
});

export async function listGoogleSubscriptionModels(providerKey, { forceRefresh = false } = {}) {
  if (providerKey === 'antigravity') return listAntigravityModels({ forceRefresh });
  if (providerKey === 'gemini-cli') return listGeminiCliModels({ forceRefresh });
  return null;
}

async function listAntigravityModels({ forceRefresh }) {
  const status = await AntigravityAuthManager.checkApiUsable({ forceRefresh });
  if (!status.available) {
    return reply(400, { success: false, error: 'Antigravity is not connected. Use Google OAuth to connect.' });
  }
  // PRD-109: while cooling down after a 403/429, don't hit Google for models.
  if (status.coolingDown) {
    return reply(429, {
      success: false, coolingDown: true, retryAfterMs: status.retryAfterMs, error: status.hint,
    });
  }
  if (!await AntigravityAuthManager.getAccessToken()) {
    return reply(400, { success: false, error: 'Antigravity token not found.' });
  }

  const oauth2Client = AntigravityAuthManager.getOAuth2Client();
  const live = oauth2Client ? await AntigravityAuthManager.fetchAvailableModels(oauth2Client) : [];
  if (live.length > 0) {
    // Google's own context window / capabilities for every listed model, so a
    // model discovered today is not costed or truncated by an inferred default.
    registerDynamicPricingFromModels('antigravity', antigravityMetadataRecords(live));
    // Saved like every other provider's live list, so the default-model
    // resolver (services/ai/defaultModel.js) checks picks against it.
    persistLastModels('antigravity', live.map((m) => ({ id: m.id, name: m.name })));
    return listed(live.map((m) => m.id), true);
  }

  console.warn('[googleSubscriptionModels] Antigravity live catalog unavailable; serving the static fallback list');
  return listed([...(getProviderConfig('antigravity')?.fallbackModels || [])], false,
    'Google did not return the Antigravity model catalog');
}

async function listGeminiCliModels({ forceRefresh }) {
  if (GeminiCliAuthManager.isUsingApiKey()) return null;

  const status = await GeminiCliAuthManager.checkApiUsable({ forceRefresh });
  if (!status.available) {
    return reply(400, {
      success: false,
      error: 'Gemini CLI is not connected. Use Google OAuth or paste an API key to connect.',
    });
  }
  // No Code Assist entitlement: every model would 403, so listing any is a lie.
  if (status.unlicensed || status.deprecated) {
    return reply(400, {
      success: false, error: status.hint, deprecated: !!status.deprecated, unlicensed: !!status.unlicensed,
    });
  }

  if (status.entitledModels?.length > 0) {
    persistLastModels('gemini-cli', status.entitledModels.map((id) => ({ id, name: id })));
    return listed([...status.entitledModels], true);
  }

  // Entitlement lookup failed transiently (network, 5xx): fall back rather than
  // blank the picker. Paid tiers additionally get the Pro preview.
  console.warn('[googleSubscriptionModels] Gemini CLI entitlement list unavailable; serving the static fallback list');
  const models = [...(getProviderConfig('gemini-cli')?.fallbackModels || [])];
  if (GeminiCliAuthManager.hasPaidTier() && !models.includes('gemini-3.1-pro-preview')) {
    models.unshift('gemini-3.1-pro-preview');
  }
  return listed(models, false, 'Google did not return the Gemini CLI entitlement list');
}
