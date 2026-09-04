import { API_CONFIG } from '@/tt.config.js';

export const REMOTE_BUNDLE_API = 'https://agnt.gg/api/creation-bundles';
const authHeaders = (token, extra = {}) => ({ ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra });
async function checked(response, context) {
  if (response.ok) return response;
  const body = await response.json().catch(() => ({}));
  const error = new Error(body.error || `${context} failed (${response.status})`);
  error.status = response.status;
  throw error;
}
async function retry(operation, context, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try { return await operation(); } catch (error) {
      lastError = error;
      if ((error.status && error.status < 500 && error.status !== 429) || attempt === attempts) break;
      await new Promise((resolve) => setTimeout(resolve, 200 * (2 ** (attempt - 1))));
    }
  }
  const error = new Error(`${context}: ${lastError.message}`);
  error.status = lastError.status;
  error.cause = lastError;
  throw error;
}
const formatMegabytes = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;

// A proxy that refuses a body for its size closes the socket before the
// browser has finished sending it, so fetch() rejects with a bare TypeError:
// no status, no headers, nothing that says why. A 21 MB film once failed as
// "Failed to fetch" for exactly that reason. The size is the one fact the
// publisher always has, so it is the fact both size-shaped failures carry.
function describeUploadFailure(file, error) {
  const size = formatMegabytes(file.size);
  if (error.status === 413) return new Error(`Uploading ${file.path}: ${size} is more than the server accepts`, { cause: error });
  if (error.status) return error;
  return new Error(`Uploading ${file.path}: the connection dropped while sending ${size}, before the server answered`, { cause: error });
}
async function sha256(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export function dirtyOverrides(openTabs, rootPath) {
  const prefix = rootPath ? `${rootPath.replace(/\\/g, '/').replace(/\/$/, '')}/` : '';
  return openTabs.filter((tab) => tab.isDirty && tab.path.replace(/\\/g, '/').startsWith(prefix)).map((tab) => ({ path: tab.path.replace(/\\/g, '/').slice(prefix.length), content: tab.content }));
}
export async function prepareArtifactBundle(entryPath, token, rootPath) {
  const source = typeof entryPath === 'object' ? entryPath : { entryPath, ...(rootPath === undefined ? {} : { rootPath }) };
  const response = await fetch(`${API_CONFIG.BASE_URL}/filesystem/publish-manifest`, { method:'POST', headers:authHeaders(token, {'Content-Type':'application/json'}), body:JSON.stringify(source) });
  return (await checked(response, 'Bundle preflight')).json();
}
export async function publishArtifactBundle({ title, manifest, token, overrides = [], bundleId = null, concurrency = 4, onBundle = () => {}, onProgress = () => {}, fetchImpl = fetch }) {
  if (manifest.preparationId && overrides.length) {
    // Artifacts always supplies the active editor content. Resolve that content
    // before declaring hashes; otherwise it restores file:/// URLs after preflight.
    const response = await checked(await fetchImpl(`${API_CONFIG.BASE_URL}/filesystem/publish-manifest`, {
      method:'POST', headers:authHeaders(token, {'Content-Type':'application/json'}),
      body:JSON.stringify({ ...manifest.preparationSource, overrides }),
    }), 'Bundle preflight');
    manifest = await response.json();
    overrides = [];
  }
  const overrideMap = new Map(overrides.map((item) => [item.path, item.content]));
  const files = await Promise.all(manifest.files.map(async (file) => {
    if (!overrideMap.has(file.path)) return file;
    const bytes = new TextEncoder().encode(overrideMap.get(file.path));
    return { ...file, size: bytes.byteLength, sha256: await sha256(bytes), editorOverride: true };
  }));
  let bundle;
  let alreadyUploaded = new Set();
  if (bundleId) {
    const status = await checked(await fetchImpl(`${REMOTE_BUNDLE_API}/${bundleId}`, { headers:authHeaders(token) }), 'Bundle resume');
    bundle = await status.json();
    if (bundle.status !== 'staging') throw new Error(`Bundle cannot resume from ${bundle.status} state`);
    alreadyUploaded = new Set(bundle.uploaded || []);
    if (manifest.preparationId && bundle.manifest?.manifestHash !== manifest.manifestHash) {
      // Changed editor bytes or newly collected files cannot reuse old uploads.
      bundle = null;
      alreadyUploaded = new Set();
    }
  }
  if (!bundle) {
    const { preparationId, preparationSource, imported, rootPath, ...publicManifest } = manifest;
    const init = await checked(await fetchImpl(REMOTE_BUNDLE_API, { method:'POST', headers:authHeaders(token, {'Content-Type':'application/json'}), body:JSON.stringify({ title, source:'desktop-app', entryPath:manifest.entryPath, manifest:{...publicManifest, files} }) }), 'Bundle initialization');
    bundle = await init.json();
    onBundle(bundle.id);
  }
  const pending = files.filter((file) => !alreadyUploaded.has(file.path));
  let completed = alreadyUploaded.size;
  let uploadedBytes = files.filter((file) => alreadyUploaded.has(file.path)).reduce((sum, file) => sum + file.size, 0);
  let cursor = 0;
  const uploadNext = async () => {
    while (cursor < pending.length) {
      const file = pending[cursor++];
      let body;
      if (overrideMap.has(file.path)) body = new TextEncoder().encode(overrideMap.get(file.path));
      else {
        const params = new URLSearchParams({
          ...(manifest.preparationId ? { preparationId:manifest.preparationId } : { rootPath:manifest.rootPath || '' }), path:file.path,
          expectedSize: String(file.size), expectedModifiedMs: String(file.modifiedMs),
        });
        const source = await checked(await fetchImpl(`${API_CONFIG.BASE_URL}/filesystem/publish-file?${params}`, { headers:authHeaders(token) }), `Reading ${file.path}`);
        body = await source.arrayBuffer();
      }
      try {
        await retry(async () => checked(await fetchImpl(`${REMOTE_BUNDLE_API}/${bundle.id}/files/${encodeURIComponent(file.path)}`, { method:'PUT', headers:authHeaders(token, {'Content-Type':'application/octet-stream','X-Content-SHA256':file.sha256}), body }), `Uploading ${file.path}`), `Uploading ${file.path}`);
      } catch (error) {
        throw describeUploadFailure(file, error);
      }
      completed += 1;
      uploadedBytes += file.size;
      onProgress({ phase:'uploading', current:completed, total:files.length, uploadedBytes, totalBytes:files.reduce((sum, item) => sum + item.size, 0), path:file.path });
    }
  };
  const workerCount = Math.max(1, Math.min(Number(concurrency) || 1, 8, pending.length || 1));
  await Promise.all(Array.from({ length: workerCount }, uploadNext));
  onProgress({ phase:'validating', current:files.length, total:files.length });
  const final = await retry(async () => checked(await fetchImpl(`${REMOTE_BUNDLE_API}/${bundle.id}/finalize`, { method:'POST', headers:authHeaders(token, {'Content-Type':'application/json'}), body:'{}' }), 'Bundle finalization'), 'Bundle finalization');
  return final.json();
}
