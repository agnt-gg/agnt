/**
 * Chutes.ai E2EE instance discovery, model resolution, and nonce cache.
 *
 * Single-threaded (Node.js event loop), but `getNonce()` does an async fetch
 * before mutating cache, so two concurrent first-use callers could each
 * receive the same provider nonce list and consume the first nonce from
 * separate copies — a protocol-level nonce-reuse risk for an encrypted
 * transport. We dedupe in-flight refreshes per chuteId so only one
 * `_fetchInstances()` runs and all waiters share the same cache object.
 */

const DEFAULT_API_BASE = 'https://api.chutes.ai';
const DEFAULT_MODELS_BASE = 'https://llm.chutes.ai';
const MODEL_MAP_TTL_MS = 5 * 60 * 1000; // 5 minutes

class ChutesDiscoveryManager {
  /**
   * @param {Object} opts
   * @param {string} opts.apiKey — Chutes access token
   * @param {string} [opts.apiBase='https://api.chutes.ai']
   * @param {string} [opts.modelsBase='https://llm.chutes.ai']
   */
  constructor({ apiKey, apiBase = DEFAULT_API_BASE, modelsBase = DEFAULT_MODELS_BASE }) {
    this._apiBase = apiBase.replace(/\/$/, '');
    this._modelsBase = modelsBase.replace(/\/$/, '');
    this._authHeaders = { Authorization: `Bearer ${apiKey}` };

    // chute_id -> { instances, expiresAt }
    this._nonceCache = new Map();

    // chute_id -> in-flight Promise<fresh> for the active refresh.
    // Ensures concurrent first-use callers share one fetch + one cache write,
    // preventing two callers from independently consuming the first nonce.
    this._nonceRefreshes = new Map();

    // model_name -> chute_id
    this._modelMap = new Map();
    this._modelMapLoadedAt = 0;
  }

  // ------------------------------------------------------------------
  // Model name -> chute_id resolution
  // ------------------------------------------------------------------

  /**
   * Resolve a model name to a chute_id UUID.
   * If the model looks like a UUID, it is returned as-is.
   *
   * @param {string} model
   * @returns {Promise<string>}
   */
  async resolveChuteId(model) {
    if (this._looksLikeUUID(model)) {
      return model;
    }

    await this._maybeRefreshModelMap();
    const chuteId = this._modelMap.get(model);
    if (chuteId) return chuteId;

    // Force refresh once on miss
    this._modelMapLoadedAt = 0;
    await this._maybeRefreshModelMap();
    const retry = this._modelMap.get(model);
    if (retry) return retry;

    throw new Error(
      `Could not resolve model '${model}' to a chute_id. ` +
        `Check that the model name is correct and available at /v1/models.`,
    );
  }

  async _maybeRefreshModelMap() {
    const now = Date.now();
    if (now - this._modelMapLoadedAt < MODEL_MAP_TTL_MS) return;

    const url = `${this._modelsBase}/v1/models`;
    const res = await fetch(url, {
      headers: this._authHeaders,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch model map: ${res.status} ${res.statusText}`);
    }
    const data = await res.json();
    const newMap = new Map();
    for (const entry of data.data || []) {
      const modelId = entry.id;
      const chuteId = entry.chute_id;
      if (modelId && chuteId) {
        newMap.set(modelId, chuteId);
      }
    }
    this._modelMap = newMap;
    this._modelMapLoadedAt = Date.now();
  }

  _looksLikeUUID(s) {
    const parts = s.split('-');
    if (parts.length !== 5) return false;
    const hex = s.replace(/-/g, '');
    return hex.length === 32 && /^[0-9a-f]+$/i.test(hex);
  }

  // ------------------------------------------------------------------
  // Instance discovery + nonce cache
  // ------------------------------------------------------------------

  /**
   * Get an (instance, nonce) pair, fetching fresh ones if needed.
   *
   * Concurrent callers for the same chuteId share a single in-flight refresh
   * (see `_nonceRefreshes`) so they can never receive duplicate nonces from
   * independent fetches. If the shared fresh cache is drained by other
   * waiters, force one more refresh and retry — bounded to avoid runaway
   * recursion if the provider keeps returning empty nonce lists.
   *
   * @param {string} chuteId
   * @param {number} [_retries=0] — internal guard; do not pass externally
   * @returns {Promise<{ instanceId: string, e2ePubkey: string, nonce: string }>}
   */
  async getNonce(chuteId, _retries = 0) {
    const cached = this._nonceCache.get(chuteId);
    if (cached && Date.now() < cached.expiresAt) {
      const result = this._takeNonce(cached);
      if (result) return result;
    }

    let refresh = this._nonceRefreshes.get(chuteId);
    if (!refresh) {
      refresh = this._fetchInstances(chuteId)
        .then((discovery) => {
          const fresh = {
            instances: discovery.instances,
            expiresAt: discovery.nonceExpiresAt,
          };
          this._nonceCache.set(chuteId, fresh);
          return fresh;
        })
        .finally(() => {
          // Always clear the in-flight slot, success or failure, so a failed
          // refresh doesn't poison the map and block future retries.
          this._nonceRefreshes.delete(chuteId);
        });
      this._nonceRefreshes.set(chuteId, refresh);
    }

    const fresh = await refresh;
    const result = this._takeNonce(fresh);
    if (result) return result;

    // Other waiters drained the just-refreshed cache. Force one more refresh
    // and retry once — bounded so a misbehaving provider can't spin forever.
    if (_retries < 2) {
      this._nonceCache.delete(chuteId);
      return this.getNonce(chuteId, _retries + 1);
    }

    throw new Error(
      `No nonces available for chute ${chuteId}. ` +
        'The chute may have no active E2EE-capable instances.',
    );
  }

  _takeNonce(cached) {
    for (const inst of cached.instances) {
      if (inst.nonces.length > 0) {
        return {
          instanceId: inst.instanceId,
          e2ePubkey: inst.e2ePubkey,
          nonce: inst.nonces.shift(),
        };
      }
    }
    return null;
  }

  async _fetchInstances(chuteId) {
    const url = `${this._apiBase}/e2e/instances/${chuteId}`;
    const res = await fetch(url, {
      headers: this._authHeaders,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch instances: ${res.status} ${res.statusText}`);
    }
    const data = await res.json();
    const instances = (data.instances || []).map((inst) => ({
      instanceId: inst.instance_id,
      e2ePubkey: inst.e2e_pubkey,
      nonces: [...(inst.nonces || [])],
    }));
    return {
      instances,
      nonceExpiresAt: Date.now() + (data.nonce_expires_in || 55) * 1000,
    };
  }

  // ------------------------------------------------------------------
  // Cache management
  // ------------------------------------------------------------------

  clearNonceCache(chuteId) {
    if (chuteId) {
      this._nonceCache.delete(chuteId);
      this._nonceRefreshes.delete(chuteId);
    } else {
      this._nonceCache.clear();
      this._nonceRefreshes.clear();
    }
  }

  clearModelMap() {
    this._modelMap = new Map();
    this._modelMapLoadedAt = 0;
  }
}

export default ChutesDiscoveryManager;
