import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { downloadVerified } from './download.js';

const CONTENT = Buffer.from('0123456789'.repeat(1000)); // 10 000 bytes
const SHA = crypto.createHash('sha256').update(CONTENT).digest('hex');
const URL = 'https://example.test/model.gguf';

let dir;
let dest;
beforeEach(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'agnt-dl-'));
  dest = path.join(dir, 'model.gguf');
});
afterEach(() => fsp.rm(dir, { recursive: true, force: true }));

/** A server that honours Range (or not), sending the body in 1000-byte chunks. */
function server({ honourRange = true, body = CONTENT, failAfter = Infinity } = {}) {
  return vi.fn(async (_url, init = {}) => {
    const range = init.headers?.Range;
    const start = honourRange && range ? Number(/bytes=(\d+)-/.exec(range)[1]) : 0;
    const slice = body.subarray(start);
    return {
      ok: true,
      status: honourRange && range ? 206 : 200,
      body: (async function* chunks() {
        for (let at = 0; at < slice.length; at += 1000) {
          if (start + at >= failAfter) throw new Error('ECONNRESET');
          yield slice.subarray(at, at + 1000);
        }
      })(),
    };
  });
}

const job = (fetchImpl, extra = {}) => ({ url: URL, dest, size: CONTENT.length, sha256: SHA, fetchImpl, ...extra });

describe('downloadVerified', () => {
  it('downloads, verifies and moves into place; no .part left', async () => {
    const progress = [];
    await downloadVerified(job(server(), { onProgress: (done) => progress.push(done) }));
    expect(await fsp.readFile(dest)).toEqual(CONTENT);
    await expect(fsp.access(`${dest}.part`)).rejects.toThrow();
    expect(progress.at(-1)).toBe(CONTENT.length);
  });

  it('a file already at dest is trusted and not fetched again', async () => {
    await fsp.writeFile(dest, CONTENT);
    const fetchImpl = server();
    await downloadVerified(job(fetchImpl));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('an interrupted download resumes with Range and still verifies the whole file', async () => {
    await expect(downloadVerified(job(server({ failAfter: 4000 })))).rejects.toThrow('ECONNRESET');
    expect((await fsp.stat(`${dest}.part`)).size).toBe(4000);

    const resume = server();
    await downloadVerified(job(resume));
    expect(resume.mock.calls[0][1].headers).toEqual({ Range: 'bytes=4000-' });
    expect(await fsp.readFile(dest)).toEqual(CONTENT);
  });

  it('a server that ignores Range restarts the file instead of appending a second copy', async () => {
    await fsp.writeFile(`${dest}.part`, CONTENT.subarray(0, 3000));
    await downloadVerified(job(server({ honourRange: false })));
    expect(await fsp.readFile(dest)).toEqual(CONTENT);
  });

  it('wrong bytes: rejected, the part is deleted, nothing reaches dest', async () => {
    const tampered = Buffer.from(CONTENT);
    tampered[5] ^= 0xff;
    await expect(downloadVerified(job(server({ body: tampered })))).rejects.toMatchObject({ code: 'checksum_mismatch' });
    await expect(fsp.access(dest)).rejects.toThrow();
    await expect(fsp.access(`${dest}.part`)).rejects.toThrow();
  });

  it('more bytes than pinned: rejected before writing them all', async () => {
    const longer = Buffer.concat([CONTENT, Buffer.alloc(5000)]);
    await expect(downloadVerified(job(server({ body: longer })))).rejects.toMatchObject({ code: 'size_mismatch' });
    await expect(fsp.access(dest)).rejects.toThrow();
  });

  it('HTTP errors are reported, not written', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 404, body: null }));
    await expect(downloadVerified(job(fetchImpl))).rejects.toMatchObject({ code: 'http_error' });
  });
});
