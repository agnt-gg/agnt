import { validatePng } from '../images/pngIntegrity.js';

import { isCodexImageProvider } from './codexImageCapability.js';
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
function decodeBase64(text) {
  if (typeof text !== 'string' || !text.length || text.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4
      || text.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) throw new Error('Invalid or oversized base64 image.');
  const bytes = Buffer.from(text, 'base64');
  if (bytes.toString('base64') !== text || bytes.length > MAX_IMAGE_BYTES) throw new Error('Noncanonical or oversized image.');
  return bytes;
}
export function referenceDataUri(value) {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(value || '');
  if (!match) throw new Error('Codex Edit requires explicit PNG data URIs, not paths or remote URLs.');
  validatePng(decodeBase64(match[1]));
  return value;
}
/**
 * Sizes the subscription endpoint honours, and how the OpenAI Images sizes AGNT
 * offers map onto them. Measured live 2026-10-02: 1536x1024 came back exactly
 * 1536x1024; 1024x1024 and auto came back square; 1792x1024 was accepted but
 * came back square, so the legacy DALL-E sizes are translated to the matching
 * orientation rather than sent through.
 */
const CODEX_SIZES = { auto: 'auto', '1024x1024': '1024x1024', '1536x1024': '1536x1024', '1024x1536': '1024x1536',
  '256x256': '1024x1024', '512x512': '1024x1024', '1792x1024': '1536x1024', '1024x1792': '1024x1536' };
// gpt-image vocabulary passes through; DALL-E's 'standard' / 'hd' translate.
const CODEX_QUALITIES = { auto: 'auto', low: 'low', medium: 'medium', high: 'high', standard: 'auto', hd: 'high' };

export function codexImageSize(size) {
  if (!size) return 'auto';
  const mapped = CODEX_SIZES[size];
  if (!mapped) throw new Error(`Unsupported image size for the ChatGPT subscription: ${size}`);
  return mapped;
}
export function codexImageQuality(quality) {
  if (!quality) return 'auto';
  const mapped = CODEX_QUALITIES[quality];
  if (!mapped) throw new Error(`Unsupported image quality for the ChatGPT subscription: ${quality}`);
  return mapped;
}

function requestFor(params) {
  const operation = params.imageOperation || 'Generate';
  if (!['Generate', 'Edit'].includes(operation)) throw new Error('Codex supports Generate/Edit, not Variation.');
  // The subscription picks its own image model; a model pin meant for the
  // Images API is recorded but cannot be honoured.
  const requestedModel = params.model || 'provider-default';
  if (params.numberOfImages != null && Number(params.numberOfImages) !== 1) throw new Error('Codex supports one image per request.');
  const size = codexImageSize(params.imageSize);
  const quality = codexImageQuality(params.imageQuality);
  // imageStyle was a DALL-E 3 control with no gpt-image equivalent; the API
  // path ignores it too. A mask or aspect ratio cannot be honoured here.
  if (params.aspectRatio || params.mask) throw new Error('Unsupported Codex rendering control.');
  const prompt = params.imagePrompt;
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 16000) throw new Error('Codex image prompt must contain 1–16000 characters.');
  if (params.referenceImage && params.referenceImages) throw new Error('Use one explicit reference selector, not both.');
  const refs = params.referenceImages || (params.referenceImage ? [params.referenceImage] : []);
  if (!Array.isArray(refs) || refs.length > 3) throw new Error('At most three explicit PNG references are supported.');
  if (operation === 'Generate' && refs.length) throw new Error('Generate cannot silently discard references; use Edit.');
  if (operation === 'Edit' && !refs.length) throw new Error('Edit requires explicit PNG references.');
  if (refs.reduce((sum, ref) => sum + (typeof ref === 'string' ? ref.length : MAX_RESPONSE_BYTES), 0) > MAX_RESPONSE_BYTES) throw new Error('Total reference bytes exceed limit.');
  const body = { prompt, background: 'auto', quality, size };
  if (refs.length) body.images = refs.map(ref => ({ image_url: referenceDataUri(ref) }));
  return { body, operation, requestedModel, referenceCount: refs.length };
}

/** Client construction is supplied by AGNT's existing account-aware boundary. */
export async function generateCodexImage(params, { createClient, userId, signal, beforeDispatch, timeoutMs = 90000 } = {}) {
  if (typeof beforeDispatch !== 'function') throw new Error('Stored consent revalidation is required.');
  const provider = String(params.provider).toLowerCase();
  if (!isCodexImageProvider(provider)) throw new Error('Unsupported Codex image account.');
  const request = requestFor(params); // All validation before credential use or dispatch.
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw new Error('Invalid Codex image deadline.');
  if (signal?.aborted) throw new Error('Codex image request cancelled before dispatch.');
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(onAbort, timeoutMs);
  const startedAt = Date.now();
  const checkDeadline = () => {
    if (Date.now() - startedAt >= timeoutMs) controller.abort();
    if (controller.signal.aborted) throw new Error('Codex image cancelled or deadline exceeded.');
  };
  let rejectAbort;
  const aborted = new Promise((_, reject) => { rejectAbort = reject; });
  const rejectOnAbort = () => rejectAbort(new Error('Codex image cancelled or deadline exceeded.'));
  controller.signal.addEventListener('abort', rejectOnAbort, { once: true });
  const bounded = (promise) => Promise.race([promise, aborted]);
  let dispatched = false, response, succeeded = false;
  try {
    const client = await bounded(Promise.resolve().then(() => createClient(provider, userId)));
    if (controller.signal.aborted) throw new Error('Codex image request cancelled before dispatch.');
    if (client.baseURL?.replace(/\/$/, '') !== 'https://chatgpt.com/backend-api/codex') throw new Error('Unexpected Codex image destination.');
    const endpoint = '/images/' + (request.operation === 'Edit' ? 'edits' : 'generations');
    checkDeadline();
    await bounded(beforeDispatch(client));
    checkDeadline();
    dispatched = true;
    response = await bounded(client.post(endpoint, { body: request.body, maxRetries: 0, timeout: Math.max(1, timeoutMs - (Date.now() - startedAt)),
      signal: controller.signal, fetchOptions: { redirect: 'error' },
    }).asResponse());
    if (!response.ok) throw Object.assign(new Error('Codex image request rejected.'), { status: response.status });
    const chunks = []; let size = 0;
    const iterator = response.body[Symbol.asyncIterator]();
    while (true) {
      const { done, value: chunk } = await bounded(iterator.next());
      checkDeadline();
      if (done) break;
      size += chunk.length;
      if (size > MAX_RESPONSE_BYTES) { controller.abort(); throw new Error('Codex image response exceeds limit.'); }
      chunks.push(Buffer.from(chunk));
    }
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!Array.isArray(data.data) || data.data.length !== 1) throw new Error('Codex returned an empty or unexpected image count.');
    const bytes = decodeBase64(data.data[0].b64_json);
    const dimensions = validatePng(bytes);
    checkDeadline();
    const returnedModel = typeof data.model === 'string' && data.model.trim() ? data.model : null;
    succeeded = true;
    return {
      generatedImages: ['data:image/png;base64,' + bytes.toString('base64')],
      imageMetadata: { provider, requestedModel: request.requestedModel, selectionMode: 'provider-selected',
        resolvedModel: null, returnedModel, model: returnedModel, modelIdentityVerified: false,
        modelSelectionVerified: false, latestVerified: false, operation: request.operation, referenceCount: request.referenceCount,
        ...dimensions, count: 1, format: 'png', durationMs: Date.now() - startedAt,
        requestId: response.headers.get('x-codex-imagegen-request-id') || response.headers.get('x-request-id') || null,
        usage: data.usage ?? null, cost: null,
      },
    };
  } catch (cause) {
    const status = Number.isInteger(cause.status) ? cause.status : null;
    const outcome = dispatched && (!status || status >= 500) ? 'remote outcome unknown; not retried' : 'not retried';
    // SDK error bodies can contain headers or private inputs. Never echo them.
    const category = status === 401 ? 'authentication rejected' : status === 403 ? 'account not entitled' : status === 429 ? 'rate limited' : status ? `HTTP ${status}` : controller.signal.aborted ? 'cancelled or deadline exceeded' : 'transport/response validation failed';
    throw Object.assign(new Error(`Codex image ${category} (${outcome}).`), { status, remoteOutcomeUnknown: outcome.startsWith('remote') });
  } finally {
    clearTimeout(timer);
    controller.signal.removeEventListener('abort', rejectOnAbort);
    signal?.removeEventListener('abort', onAbort);
    if (!succeeded) { controller.abort(); try { Promise.resolve(response?.body?.cancel?.()).catch(()=>{}); } catch {} }
  }
}
