const IMAGE_ID = /^img-[a-zA-Z0-9_-]{1,160}$/;
const MAX_BYTES = 8 * 1024 * 1024;

/** Only persisted native generate_image receipts, not links in model prose. */
export function collectImageReferences(messages) {
  if (!Array.isArray(messages)) return [];
  const found = new Map();
  for (const message of messages.slice(-500).reverse()) {
    if (message?.role !== 'assistant' || !Array.isArray(message.toolCalls)) continue;
    for (const call of message.toolCalls.slice(-100).reverse()) {
      if (call?.name !== 'generate_image') continue;
      let result = call.result;
      try { if (typeof result === 'string' && result.length <= 2 * 1024 * 1024) result = JSON.parse(result); }
      catch { continue; }
      if (result?.success !== true || !Array.isArray(result.savedImageIds)) continue;
      for (const id of result.savedImageIds.slice(0,10)) {
        if (typeof id !== 'string' || !IMAGE_ID.test(id) || found.has(id)) continue;
        found.set(id, { imageId: id, messageId: message.id, label: `Saved image ${found.size + 1}` });
        if (found.size >= 24) return [...found.values()];
      }
    }
  }
  return [...found.values()];
}

/** Same configured AGNT media route used by rendered images; never an arbitrary URL. */
export async function loadImageReference(imageId, { apiBase, fetcher = fetch, signal, timeoutMs = 15000 } = {}) {
  if (!IMAGE_ID.test(imageId || '') || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30000) throw new Error('Invalid image reference.');
  if (signal?.aborted) throw new Error('Image reference cancelled.');
  const controller = new AbortController();
  let rejectAbort;
  const aborted = new Promise((_, reject) => { rejectAbort = reject; });
  // Attach a rejection handler before any synchronous validation/abort can occur.
  aborted.catch(() => {});
  const cancel = () => { controller.abort(); rejectAbort(new Error('Image reference cancelled.')); };
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => { controller.abort(); rejectAbort(new Error('Image reference timed out.')); }, timeoutMs);
  const bounded = value => Promise.race([value, aborted]);
  let reader, complete = false;
  try {
    if (typeof apiBase !== 'string' || !apiBase || !/^(https?:\/\/|\/)/.test(apiBase) || apiBase.startsWith('//')) throw new Error('Invalid AGNT media destination.');
    const response = await bounded(fetcher(`${apiBase.replace(/\/$/, '')}/images/${imageId}`, {
      method: 'GET', credentials: 'include', redirect: 'error', signal: controller.signal,
    }));
    if (!response.ok) throw new Error(`Saved image unavailable (HTTP ${response.status}).`);
    if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'image/png') throw new Error('Only PNG references are supported.');
    const length = Number(response.headers.get('content-length'));
    if (length > MAX_BYTES) throw new Error('Image reference exceeds 8 MiB.');
    reader = response.body?.getReader();
    if (!reader) throw new Error('Image response has no readable body.');
    const chunks = []; let bytes = 0;
    while (true) {
      const { done, value } = await bounded(reader.read());
      if (controller.signal.aborted) throw new Error('Image reference cancelled.');
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) throw new Error('Image reference exceeds 8 MiB.');
      chunks.push(value);
    }
    const data = new Uint8Array(bytes); let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
    // Quick client sanity check; the backend's existing PNG validator remains authoritative.
    const signature = [137,80,78,71,13,10,26,10];
    if (bytes < 33 || signature.some((b,i) => data[i] !== b)) throw new Error('Saved image is not a PNG.');
    const header = new DataView(data.buffer);
    if (header.getUint32(8) !== 13 || header.getUint32(12) !== 0x49484452) throw new Error('Invalid PNG header.');
    const width = header.getUint32(16), height = header.getUint32(20);
    if (!width || !height || width * height > 16 * 1024 * 1024) throw new Error('Image dimensions exceed the reference limit.');
    if (controller.signal.aborted) throw new Error('Image reference cancelled.');
    complete = true;
    return new File([data], `reference-${imageId}.png`, { type: 'image/png' });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
    if (!complete) {
      controller.abort();
      try { Promise.resolve(reader?.cancel()).catch(() => {}); } catch { /* Reader already closed. */ }
    }
    try { reader?.releaseLock(); } catch { /* Pending read was cancelled. */ }
  }
}
