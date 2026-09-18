/**
 * Keep in sync with backend/src/services/auth/connectorCatalog.js
 * (API-key connectors that must not enter the chat model picker).
 */
export const CONNECTOR_CATALOG = Object.freeze([
  {
    id: 'typesafe',
    name: 'TypeSafe AI',
    icon: 'api',
    categories: ['AI', 'Security'],
    connectionType: 'apikey',
    connectorOnly: true,
    instructions:
      'Paste your TypeSafe API key from https://console.typesafe.ai/settings/keys. Used as Bearer on https://api.typesafe.ai/v1/systemone. Jev returns typed decisions, not chat — do not set this as Annie’s default model.',
  },
]);

export function isConnectorOnlyProvider(id) {
  const key = String(id || '').toLowerCase();
  return CONNECTOR_CATALOG.some((p) => p.id === key);
}

/** Append catalog rows the remote list does not already contain. */
export function mergeConnectorCatalog(providers) {
  const list = Array.isArray(providers) ? [...providers] : [];
  const ids = new Set(list.map((p) => p?.id).filter(Boolean));
  for (const row of CONNECTOR_CATALOG) {
    if (!ids.has(row.id)) list.push({ ...row });
  }
  return list;
}
