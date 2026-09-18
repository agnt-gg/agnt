/**
 * Where a connector-only provider's API key is written.
 *
 * Connector-catalogue rows (see store/auth/connectorCatalog.js) exist only on
 * this client, so `POST {REMOTE_URL}/auth/apikeys/:id` has no provider to
 * attach a key to. They must go to the LOCAL route instead, which encrypts
 * into api_keys — the table the backend reads from anyway.
 *
 * This lives in its own module because the app has TWO api-key save paths that
 * had already drifted apart: Connectors.vue has one, and
 * composables/useProviderConnection.js has another used by Tools, ToolsPanel
 * and the WorkflowForge editor panel. Patching only the first left every other
 * surface silently posting connector keys to a remote store that rejects them.
 * One function, two call sites, one test.
 */
import providerAuthService from '@/services/providerAuthService.js';
import { isConnectorOnlyProvider } from '@/store/auth/connectorCatalog.js';

/** Does this provider's key belong in the local store rather than the remote one? */
export function usesLocalKeyStore(providerId) {
  return isConnectorOnlyProvider(providerId);
}

/**
 * Save an API key through the local connect route.
 * Throws on failure so each caller keeps its own error presentation.
 */
export async function saveConnectorApiKey(providerId, apiKey) {
  const result = await providerAuthService.connect(providerId, { apiKey });
  // A transport-level success with success:false is still a failure — the
  // route answers 400 with { success: false, error } for a missing key.
  if (!result?.success) {
    throw new Error(result?.error || result?.message || 'Failed to save API key');
  }
  return result;
}
