/**
 * Which local model server the Local provider talks to — decided here, once.
 *
 * Local used to mean LM Studio on 127.0.0.1:1234, hardcoded in seven places
 * across the backend and the renderer. Now it means "whichever local server
 * has the model": AGNT's managed llama-server, LM Studio, Ollama, or a
 * llama-server the user runs on its default port. All of them speak the same
 * OpenAI-compatible API, so only the base URL differs.
 *
 * Callers never hold a base URL. The Local client is built with
 * LOCAL_ROUTER_BASE_URL and the fetch from createFetch(), which reads `model`
 * from each request body and sends the request to the server that has it —
 * starting AGNT's managed server on demand. That routes all ~25
 * createLlmClient callers without passing a model name through any of them.
 *
 * This module has no app imports, so providerConfigs can import it without a
 * cycle.
 */

export const KNOWN_SERVERS = Object.freeze([
  Object.freeze({ id: 'lmstudio', name: 'LM Studio', baseURL: 'http://127.0.0.1:1234/v1' }),
  Object.freeze({ id: 'ollama', name: 'Ollama', baseURL: 'http://127.0.0.1:11434/v1' }),
  Object.freeze({ id: 'llamacpp', name: 'llama.cpp server', baseURL: 'http://127.0.0.1:8080/v1' }),
]);

/** Where Local pointed before routing existed; still the answer when nothing runs. */
export const DEFAULT_LOCAL_BASE_URL = KNOWN_SERVERS[0].baseURL;
/** Placeholder base for routed clients. `.invalid` can never resolve, so a request that skips the router fails loudly. */
export const LOCAL_ROUTER_BASE_URL = 'http://agnt-local.invalid/v1';

const PROBE_TIMEOUT_MS = 800;
const PROBE_CACHE_MS = 3000;

let lastResolvedBaseURL = DEFAULT_LOCAL_BASE_URL;

/**
 * The base URL Local last resolved to (synchronous, for code that needs a URL
 * string rather than a client). Prefer a routed client wherever possible.
 */
export function getLocalBaseURL() {
  return lastResolvedBaseURL;
}

/** The request's `model`, when the body is the JSON the OpenAI SDK sends. */
export function requestModel(init) {
  if (typeof init?.body !== 'string') return undefined;
  try {
    const model = JSON.parse(init.body)?.model;
    return typeof model === 'string' ? model : undefined;
  } catch {
    return undefined;
  }
}

/**
 * @param {object} deps
 * @param {object} deps.managed  the managed runtime (see managedRuntime.js)
 */
export function createLocalRouter({ managed, fetchImpl = (...args) => fetch(...args), servers = KNOWN_SERVERS, now = () => Date.now(), probeTimeoutMs = PROBE_TIMEOUT_MS, cacheMs = PROBE_CACHE_MS }) {
  let probeCache = null; // { at, promise }

  async function probe(server) {
    try {
      const response = await fetchImpl(`${server.baseURL}/models`, { signal: AbortSignal.timeout(probeTimeoutMs), cache: 'no-store' });
      if (!response.ok) return { ...server, running: false, models: [] };
      const body = await response.json();
      const models = (body?.data || []).map((entry) => entry?.id).filter((id) => typeof id === 'string');
      return { ...server, running: true, models };
    } catch {
      return { ...server, running: false, models: [] };
    }
  }

  /** Every known server, probed in parallel; cached briefly because several screens poll. */
  function probeAll({ fresh = false } = {}) {
    if (!fresh && probeCache && now() - probeCache.at < cacheMs) return probeCache.promise;
    const promise = Promise.all(servers.map(probe));
    probeCache = { at: now(), promise };
    return promise;
  }

  function remember(baseURL) {
    lastResolvedBaseURL = baseURL;
    return baseURL;
  }

  /**
   * The server for `model`:
   *   1. the managed model, by name: started if it is not running
   *   2. any running server that lists the model
   *   3. no model named (or nobody has it): the managed server if running,
   *      else the first server with models, else the managed model if it can
   *      start, else the first server that answers at all
   *   4. nothing anywhere: the old default, so the error names LM Studio's port
   */
  async function resolve({ model, autoStart = true } = {}) {
    const activeId = managed?.activeModelId?.() || null;
    if (model && model === activeId && autoStart) return remember(await managed.ensureRunning(model));
    const managedURL = managed?.baseURL?.() || null;
    if (model && managedURL && model === managed.runningModelId()) {
      managed.touch();
      return remember(managedURL);
    }
    const probed = await probeAll();
    if (model) {
      const owner = probed.find((server) => server.models.includes(model));
      if (owner) return remember(owner.baseURL);
    }
    if (managedURL) {
      managed.touch();
      return remember(managedURL);
    }
    const serving = probed.find((server) => server.models.length);
    if (serving) return remember(serving.baseURL);
    if (activeId && autoStart && (await managed.activeModelReady())) return remember(await managed.ensureRunning(activeId));
    const answering = probed.find((server) => server.running);
    return remember(answering ? answering.baseURL : DEFAULT_LOCAL_BASE_URL);
  }

  /** fetch for an OpenAI client built with LOCAL_ROUTER_BASE_URL. */
  function createFetch() {
    return async (url, init) => {
      const href = typeof url === 'string' ? url : url?.url || String(url);
      const model = requestModel(init);
      let base;
      try {
        base = await resolve({ model });
      } catch (error) {
        // The SDK reports any fetch failure as a bare "Connection error"; keep the reason.
        console.warn(`[localModels] no local server for ${model || 'request'}: ${error.message}`);
        throw error;
      }
      return fetchImpl(href.replace(LOCAL_ROUTER_BASE_URL, base), init);
    };
  }

  /** Model ids Local can use now: every running server's, plus the managed model when it can start. */
  async function listModelIds() {
    const probed = await probeAll();
    const ids = probed.flatMap((server) => server.models);
    const managedId = managed?.runningModelId?.() || ((await managed?.activeModelReady?.()) ? managed.activeModelId() : null);
    if (managedId) ids.unshift(managedId);
    return [...new Set(ids)];
  }

  return { resolve, createFetch, probeAll, listModelIds };
}
