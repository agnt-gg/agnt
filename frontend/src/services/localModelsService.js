/**
 * The renderer's only view of local models: GET /api/local-models/status.
 *
 * Four places used to fetch http://127.0.0.1:1234/v1/models themselves (the
 * model store, Chat, the chat picker, Settings), so Local meant LM Studio and
 * nothing else, and it could not work at all from a phone, where 127.0.0.1 is
 * the phone. The backend now decides which local server Local is (LM Studio,
 * Ollama, llama-server, or AGNT's own) and reports it here.
 *
 * Several screens poll at once, so a status read is shared: callers within
 * STATUS_MAX_AGE_MS of each other get the same request.
 */
import { API_CONFIG, DEPLOYMENT_CONFIG } from '@/tt.config.js';
import { apiFetch, getAuthToken } from '@/utils/apiFetch.js';

export const STATUS_MAX_AGE_MS = 2000;

let cached = null; // { at, promise }

async function request(method, path, body) {
  const response = await apiFetch(`${API_CONFIG.BASE_URL}/local-models/${path}`, {
    method,
    cache: 'no-store',
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.message || data.error || `HTTP ${response.status}`), { code: data.error, status: response.status });
  return data;
}

/** Local is off on hosted instances, and the endpoint needs a signed-in session. */
export const localModelsAvailable = () => !DEPLOYMENT_CONFIG?.DISABLE_LOCAL_LLM && !!getAuthToken();

/** The status, uncached; throws with the reason. For flows that must explain a failure. */
export const getLocalStatus = () => request('GET', 'status');

/**
 * The full local status, or null when local models are unavailable here or
 * the backend could not be asked. Never throws: every caller treats "unknown"
 * as "not ready".
 */
export function fetchLocalStatus({ fresh = false } = {}) {
  if (!localModelsAvailable()) return Promise.resolve(null);
  if (!fresh && cached && Date.now() - cached.at < STATUS_MAX_AGE_MS) return cached.promise;
  const promise = request('GET', 'status').catch((error) => {
    console.warn('[localModels] status unavailable:', error.message);
    return null;
  });
  cached = { at: Date.now(), promise };
  return promise;
}

/** A Local model can be used now. */
export async function isLocalReady() {
  return !!(await fetchLocalStatus())?.ready;
}

const invalidate = (result) => {
  cached = null;
  return result;
};

/** Start an installed LM Studio. Resolves to the new status (with `error` on failure). */
export const startLmStudio = () => request('POST', 'start').then(invalidate);

/** Begin AGNT's one-click setup (download + start). `modelId` defaults to the recommended model. */
export const setupLocalModel = (modelId) => request('POST', 'managed/setup', modelId ? { modelId } : {}).then(invalidate);

export const cancelLocalSetup = () => request('POST', 'managed/cancel').then(invalidate);

/** Test hook: forget the shared status read. */
export function resetLocalStatusCache() {
  cached = null;
}
