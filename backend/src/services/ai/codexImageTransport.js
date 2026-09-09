import { inflateSync } from 'node:zlib';

import { isCodexImageProvider } from './codexImageCapability.js';
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const MAX_PIXELS = 16 * 1024 * 1024;
function decodeBase64(text) {
  if (typeof text !== 'string' || !text.length || text.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4
      || text.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) throw new Error('Invalid or oversized base64 image.');
  const bytes = Buffer.from(text, 'base64');
  if (bytes.toString('base64') !== text || bytes.length > MAX_IMAGE_BYTES) throw new Error('Noncanonical or oversized image.');
  return bytes;
}
/** Bounded PNG integrity/decompression validation without a native image library. */
function validatePng(bytes) {
  if (bytes.length < 45 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Only valid PNG images are supported by the initial Codex adapter.');
  let offset = 8, width, height, rowBytes, ended = false, idatStarted = false;
  const compressed = [];
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    if (length > MAX_IMAGE_BYTES || offset + length + 12 > bytes.length) throw new Error('Truncated PNG.');
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    // PNG CRC32 covers the four type bytes followed by the chunk payload.
    let crc = 0xffffffff;
    for (const value of bytes.subarray(offset + 4, offset + 8 + length)) {
      crc ^= value;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    if (((crc ^ 0xffffffff) >>> 0) !== bytes.readUInt32BE(offset + 8 + length)) throw new Error('PNG checksum mismatch.');
    if (offset === 8) {
      if (type !== 'IHDR' || length !== 13) throw new Error('Missing PNG header.');
      width = chunk.readUInt32BE(0); height = chunk.readUInt32BE(4);
      const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[chunk[9]];
      if (!width || !height || width * height > MAX_PIXELS || chunk[8] !== 8 || !channels || chunk[10] || chunk[11] || chunk[12]) throw new Error('Unsupported PNG dimensions/encoding. Use noninterlaced 8-bit PNG.');
      rowBytes = width * channels + 1;
    } else if (type === 'IHDR') throw new Error('Duplicate PNG header.');
    if (type === 'IDAT') { compressed.push(chunk); idatStarted = true; }
    if (type === 'IEND') {
      if (length || !idatStarted || offset + 12 !== bytes.length) throw new Error('Invalid PNG end.');
      ended = true; break;
    }
    offset += length + 12;
  }
  if (!ended) throw new Error('Incomplete PNG image.');
  const expected = rowBytes * height;
  const decoded = inflateSync(Buffer.concat(compressed), { maxOutputLength: expected });
  if (decoded.length !== expected) throw new Error('Invalid PNG pixel payload.');
  for (let y = 0; y < height; y++) if (decoded[y * rowBytes] > 4) throw new Error('Invalid PNG filter.');
  return { width, height };
}
export function referenceDataUri(value) {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(value || '');
  if (!match) throw new Error('Codex Edit requires explicit PNG data URIs, not paths or remote URLs.');
  validatePng(decodeBase64(match[1]));
  return value;
}
function requestFor(params) {
  const operation = params.imageOperation || 'Generate';
  if (!['Generate', 'Edit'].includes(operation)) throw new Error('Codex supports Generate/Edit, not Variation.');
  const requestedModel = params.model || 'provider-default';
  if (requestedModel !== 'provider-default') throw new Error('Codex does not establish that model pins or latest are honored. Use provider-default (engine identity unknown); no model substitution was made.');
  if (params.numberOfImages != null && Number(params.numberOfImages) !== 1) throw new Error('Codex supports one image per request.');
  if (params.imageSize && params.imageSize !== 'auto') throw new Error('Codex v1 supports auto image size only.');
  if (params.imageQuality && params.imageQuality !== 'auto') throw new Error('Codex v1 supports auto quality only.');
  if (params.imageStyle || params.aspectRatio || params.mask) throw new Error('Unsupported Codex rendering control.');
  if (params.responseFormat && params.responseFormat !== 'b64_json') throw new Error('Codex returns base64 PNG only.');
  const prompt = params.imagePrompt;
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 16000) throw new Error('Codex image prompt must contain 1–16000 characters.');
  if (params.referenceImage && params.referenceImages) throw new Error('Use one explicit reference selector, not both.');
  const refs = params.referenceImages || (params.referenceImage ? [params.referenceImage] : []);
  if (!Array.isArray(refs) || refs.length > 3) throw new Error('At most three explicit PNG references are supported.');
  if (operation === 'Generate' && refs.length) throw new Error('Generate cannot silently discard references; use Edit.');
  if (operation === 'Edit' && !refs.length) throw new Error('Edit requires explicit PNG references.');
  if (refs.reduce((sum, ref) => sum + (typeof ref === 'string' ? ref.length : MAX_RESPONSE_BYTES), 0) > MAX_RESPONSE_BYTES) throw new Error('Total reference bytes exceed limit.');
  const body = { prompt, background: 'auto', quality: 'auto', size: 'auto' };
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
