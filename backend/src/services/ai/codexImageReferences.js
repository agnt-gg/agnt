import { referenceDataUri } from './codexImageTransport.js';

/** Turn-owned uploads only. Never resolves paths, URLs, or client-supplied image IDs. */
export function bindUploadReferences(images, scope) {
  if (typeof scope !== 'string' || !scope) throw new Error('Image reference scope required.');
  const entries = {};
  for (const [index, image] of (Array.isArray(images) ? images : []).entries()) {
    if (index >= 16) break;
    if (!image || image.type !== 'image/png' || image.unsupported || typeof image.data !== 'string' || image.data.length > 12 * 1024 * 1024) continue;
    try { entries[`upload:${index}`] = referenceDataUri(`data:image/png;base64,${image.data}`); }
    catch { /* Keep unsupported/malformed uploads unavailable without breaking text chat. */ }
  }
  return Object.freeze({ scope, entries: Object.freeze(entries) });
}
export function resolveImageReferences(handles, bound, scope) {
  if (!bound || scope !== bound.scope) throw new Error('Image reference scope mismatch.');
  if (!Array.isArray(handles) || !handles.length || handles.length > 3) throw new Error('Select 1–3 explicit image references.');
  if (new Set(handles).size !== handles.length) throw new Error('Duplicate image reference.');
  return handles.map(handle => {
    if (typeof handle !== 'string' || !/^upload:\d+$/.test(handle) || !Object.hasOwn(bound.entries, handle)) throw new Error('Unavailable image reference.');
    return bound.entries[handle];
  });
}
