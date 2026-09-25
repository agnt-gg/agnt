/**
 * grokBuildProxyModels — what cli-chat-proxy.grok.com says it serves.
 *
 * Grok Build chat goes to the proxy over HTTP (see LlmService), not through
 * the CLI. The proxy's own GET /v1/models is therefore the authoritative
 * "what can AGNT serve" list. `grok models` is not: it also prints cursor-* /
 * cline-pass-* ids the CLI routes elsewhere, and the proxy answers those with
 * 400 "Model not found". Probed live (CLI 1.0.41): /v1/models returned exactly
 * the four ids that answered 200 to a chat probe, and none of the ten that
 * failed.
 *
 * Each row also lists the reasoning efforts that model accepts, which drives
 * the effort selector (providerConfigs.registerGrokBuildProxyCatalog).
 *
 * This module only CONSUMES the existing credential API —
 * GrokBuildAuthManager.ensureValidToken() and getCliVersion(), exactly as
 * LlmService does for chat. It does not obtain, store or refresh tokens itself.
 */

import GrokBuildAuthManager from '../auth/GrokBuildAuthManager.js';

const GROK_PROXY_BASE_URL = 'https://cli-chat-proxy.grok.com/v1';
// The catalogue changes on CLI/xAI release cadence, not per request.
const PROXY_MODELS_TTL_MS = 10 * 60 * 1000;
const PROXY_MODELS_TIMEOUT_MS = 10000;

let cache = null; // { at, entries }

const copy = (entries) => entries.map((e) => ({ ...e, reasoningEfforts: [...e.reasoningEfforts] }));

/**
 * One /v1/models row → the fields AGNT uses. Live shape (CLI 1.0.41):
 *   reasoning_effort: 'high', supports_reasoning_effort: true,
 *   reasoning_efforts: [{ id, value: 'xhigh', label, default }, …],
 *   context_window: 500000
 *
 * `reasoningEfforts` is [] when the proxy lists none or says
 * supports_reasoning_effort: false. The proxy 400s on any effort a model does
 * not list, so "none listed" must mean "offer none", never "unknown".
 */
export function parseProxyModelEntry(id, entry) {
  const efforts = [];
  let defaultEffort;
  if (entry?.supports_reasoning_effort !== false && Array.isArray(entry?.reasoning_efforts)) {
    for (const e of entry.reasoning_efforts) {
      const raw = typeof e === 'string' ? e : e?.value ?? e?.id;
      const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
      if (!value || efforts.includes(value)) continue;
      efforts.push(value);
      if (e?.default === true) defaultEffort = value;
    }
  }
  const stated = typeof entry?.reasoning_effort === 'string' ? entry.reasoning_effort.trim().toLowerCase() : '';
  if (!defaultEffort && stated && efforts.includes(stated)) defaultEffort = stated;
  const ctx = Number(entry?.context_window);
  return {
    id,
    contextWindow: Number.isFinite(ctx) && ctx > 0 ? ctx : undefined,
    reasoningEfforts: efforts,
    reasoningDefaultEffort: defaultEffort,
  };
}

/**
 * Per-model entries from GET /v1/models:
 *   { id, contextWindow, reasoningEfforts, reasoningDefaultEffort }
 *
 * Sent with the same client headers as LlmService, so the answer describes
 * the surface chat will actually hit. Returns [] on ANY failure (no token,
 * network, non-2xx, bad JSON) so the caller falls back to the static
 * catalogue — a models-list outage must never take the picker down. Successes
 * are cached for PROXY_MODELS_TTL_MS; failures are not, so the next open
 * retries.
 */
export async function listProxyModelEntries({ forceRefresh = false, timeoutMs = PROXY_MODELS_TIMEOUT_MS } = {}) {
  if (!forceRefresh && cache && Date.now() - cache.at < PROXY_MODELS_TTL_MS) {
    return copy(cache.entries);
  }
  try {
    const token = await GrokBuildAuthManager.ensureValidToken();
    if (!token) return [];
    const version = await GrokBuildAuthManager.getCliVersion();
    const res = await fetch(`${GROK_PROXY_BASE_URL}/models`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'x-grok-client-version': version,
        'x-grok-client-identifier': 'xai-grok-cli',
        'x-grok-client-surface': 'grok-build',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      console.warn(`[GrokBuildModels] /v1/models returned ${res.status}; using static catalogue`);
      return [];
    }
    const body = await res.json();
    const entries = [];
    for (const row of Array.isArray(body?.data) ? body.data : []) {
      const id = typeof row?.id === 'string' ? row.id.trim() : '';
      if (!id || entries.some((e) => e.id === id)) continue;
      entries.push(parseProxyModelEntry(id, row));
    }
    if (entries.length > 0) cache = { at: Date.now(), entries };
    return copy(entries);
  } catch (err) {
    console.warn(`[GrokBuildModels] /v1/models failed (${err.message}); using static catalogue`);
    return [];
  }
}

/** Just the ids, same fetch and cache. */
export async function listProxyModels(options = {}) {
  return (await listProxyModelEntries(options)).map((e) => e.id);
}

export function __resetGrokBuildProxyModelsCacheForTests() {
  cache = null;
}

export default { listProxyModelEntries, listProxyModels, parseProxyModelEntry };
