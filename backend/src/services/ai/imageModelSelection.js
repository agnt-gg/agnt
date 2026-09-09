/** AGNT policies, never upstream model IDs. Other providers keep their own defaults. */
export const IMAGE_MODEL_POLICIES = Object.freeze(['latest', 'latest-fast']);
export function isImageModelPolicy(model) {
  return IMAGE_MODEL_POLICIES.includes(model);
}

// Known stable GPT Image naming contract. Unrecognised variants do not become
// recommendations by lexical accident. New numeric releases need no default edit;
// new endpoint contracts or sibling names still need compatibility review here.
function candidate(row, fast) {
  const id = typeof row === 'string' ? row : row?.id;
  if (typeof id !== 'string' || row?.deprecated === true || row?.status === 'deprecated') return null;
  const match = /^gpt-image-(\d+(?:\.\d+)*)(?:-(sunburst|flare|mini))?$/.exec(id);
  if (!match) return null;
  const variant = match[2] || '';
  if ((!fast && ['flare', 'mini'].includes(variant)) || (fast && !['flare', 'mini'].includes(variant))) return null;
  const version = match[1].split('.').map(Number);
  if (version.some(n => !Number.isSafeInteger(n))) return null;
  return { id, version, tier: fast ? (variant === 'flare' ? 2 : variant === 'mini' ? 1 : 0) : (variant === 'sunburst' ? 1 : 0) };
}
function compare(a, b) {
  for (let i = 0; i < Math.max(a.version.length, b.version.length); i++) {
    const diff = (b.version[i] || 0) - (a.version[i] || 0);
    if (diff) return diff;
  }
  return b.tier - a.tier;
}
function validateOperation(model, operation) {
  if (!['Generate', 'Edit', 'Variation'].includes(operation)) throw new Error(`Unsupported image operation: ${operation}`);
  if (operation === 'Edit' && model === 'dall-e-3') throw new Error('DALL-E 3 does not support Edit; select a supported model explicitly.');
  if (operation === 'Variation' && model !== 'dall-e-2') throw new Error('Variation requires an explicit dall-e-2 pin; models are never substituted.');
}

/**
 * Resolve once inside the image action using its already-authenticated SDK client.
 * No process-global cache, credential reads, static fallback, or billable probes.
 * A catalog establishes discoverability, NOT image entitlement or engine identity.
 */
export async function resolveOpenAiImageSelection({ model, operation = 'Generate', listModels, timeoutMs = 10000, signal }) {
  if (signal?.aborted) throw new Error('Image model selection cancelled.');
  const requestedModel = model == null || model === '' ? 'latest' : model;
  if (typeof requestedModel !== 'string' || !requestedModel.trim()) throw new Error('Image model must be a nonempty string.');
  validateOperation(requestedModel, operation);
  const selection = {
    requestedModel, selectionMode: isImageModelPolicy(requestedModel) ? 'automatic' : 'pinned',
    resolvedModel: requestedModel, returnedModel: null,
    catalogSource: null, catalogFetchedAt: null,
  };
  if (selection.selectionMode === 'pinned') return Object.freeze(selection);
  if (typeof listModels !== 'function') throw new Error('Fresh image model catalog is unavailable. Select an explicit pin or retry discovery.');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid catalog timeout.');
  const controller = new AbortController();
  let timer;
  let rejectCancelled;
  const cancelled = new Promise((_, reject) => { rejectCancelled = reject; });
  const onAbort = () => { controller.abort(); rejectCancelled(new Error('Image model selection cancelled.')); };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const expiry = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('Image model catalog discovery timed out; no fallback was used.'));
      }, timeoutMs);
    });
    const page = await Promise.race([
      Promise.resolve().then(() => listModels({ signal: controller.signal, timeout: timeoutMs, maxRetries: 0 })), expiry, cancelled,
    ]);
    if (signal?.aborted) throw new Error('Image model selection cancelled.');
    if (!Array.isArray(page?.data) || page.has_more === true || page.hasMore === true || page.data.length > 10000) {
      throw new Error('Invalid or incomplete image model catalog; cannot resolve latest.');
    }
    const ranked = page.data.map(row => candidate(row, requestedModel === 'latest-fast')).filter(Boolean).sort(compare);
    if (!ranked.length) throw new Error(`No compatible stable image models in the fresh catalog for ${requestedModel}; no static fallback was used.`);
    // Different IDs with an identical ranking are ambiguous, not alphabetic winners.
    if (ranked.some(row => compare(ranked[0], row) === 0 && ranked[0].id !== row.id)) {
      throw new Error('Ambiguous image model catalog; select an explicit model.');
    }
    return Object.freeze({ ...selection, resolvedModel: ranked[0].id, catalogSource: 'openai.models.list', catalogFetchedAt: new Date().toISOString() });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
