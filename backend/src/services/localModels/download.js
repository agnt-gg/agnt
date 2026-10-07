/**
 * Download one file, resumably, and keep it only if its bytes hash to the
 * pinned SHA-256.
 *
 * Bytes land in `<dest>.part`. An interrupted or cancelled download leaves the
 * part behind and the next attempt asks for the rest with a Range request; a
 * server that ignores Range (200 instead of 206) restarts the file. The part
 * is renamed to `dest` only after size and hash match, so a file at `dest` is
 * always a verified one: checking for it is enough, it is never re-hashed.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import crypto from 'node:crypto';
import { once } from 'node:events';

export class DownloadError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DownloadError';
    this.code = code;
  }
}

async function sizeOf(file) {
  try {
    return (await fsp.stat(file)).size;
  } catch {
    return 0;
  }
}

/** Hash bytes already on disk so a resumed download still verifies end to end. */
async function hashExisting(file, hash) {
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
}

/**
 * @param {object} job
 * @param {string} job.url
 * @param {string} job.dest
 * @param {number} job.size      expected byte count
 * @param {string} job.sha256    expected lowercase hex digest
 * @param {(done: number) => void} [job.onProgress]  bytes of this file on disk so far
 * @param {AbortSignal} [job.signal]
 * @param {typeof fetch} [job.fetchImpl]
 */
export async function downloadVerified({ url, dest, size, sha256, onProgress = () => {}, signal, fetchImpl = fetch }) {
  if ((await sizeOf(dest)) === size) {
    onProgress(size);
    return dest;
  }
  const part = `${dest}.part`;
  let offset = await sizeOf(part);
  if (offset > size) {
    await fsp.rm(part, { force: true });
    offset = 0;
  }

  const hash = crypto.createHash('sha256');
  if (offset === size) {
    await hashExisting(part, hash);
  } else {
    const response = await fetchImpl(url, { headers: offset ? { Range: `bytes=${offset}-` } : {}, signal, redirect: 'follow' });
    if (!(response.ok || response.status === 206)) throw new DownloadError('http_error', `Download failed: HTTP ${response.status} for ${url}`);
    if (offset && response.status !== 206) offset = 0; // Range ignored: start over
    if (offset) await hashExisting(part, hash);

    const out = fs.createWriteStream(part, { flags: offset ? 'a' : 'w' });
    let done = offset;
    try {
      for await (const chunk of response.body) {
        hash.update(chunk);
        done += chunk.length;
        if (done > size) throw new DownloadError('size_mismatch', `Download of ${url} is larger than the expected ${size} bytes.`);
        if (!out.write(chunk)) await once(out, 'drain');
        onProgress(done);
      }
    } finally {
      out.end();
      await once(out, 'close');
    }
    if (done !== size) throw new DownloadError('incomplete', `Download of ${url} ended at ${done} of ${size} bytes.`);
  }

  const digest = hash.digest('hex');
  if (digest !== sha256) {
    await fsp.rm(part, { force: true });
    throw new DownloadError('checksum_mismatch', `Downloaded file failed its integrity check (${url}).`);
  }
  await fsp.rename(part, dest);
  onProgress(size);
  return dest;
}
