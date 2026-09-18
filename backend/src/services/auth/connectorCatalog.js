/**
 * API-key connectors that are NOT chat/LLM providers.
 *
 * These must not be added to providerConfigs.js — that list feeds the model
 * picker and LlmService. Jev (TypeSafe) has no chat completions endpoint.
 *
 * AuthDispatcher.getAuthEntry falls back here so
 * POST /api/providers/:id/auth/connect can store the key locally.
 * The Connectors UI merges the same rows from the frontend copy of this list.
 */

export const CONNECTOR_CATALOG = Object.freeze([
  {
    key: 'typesafe',
    id: 'typesafe',
    name: 'TypeSafe AI',
    icon: 'api',
    categories: ['AI', 'Security'],
    connectionType: 'apikey',
    authScheme: 'api-key',
    connectorOnly: true,
    instructions:
      'Paste your TypeSafe API key from https://console.typesafe.ai/settings/keys. Used as Bearer on https://api.typesafe.ai/v1/systemone. Jev returns typed decisions, not chat — do not set this as Annie’s default model.',
  },
]);

export function getConnectorProvider(providerId) {
  const id = String(providerId || '').toLowerCase();
  return CONNECTOR_CATALOG.find((p) => p.key === id) || null;
}
