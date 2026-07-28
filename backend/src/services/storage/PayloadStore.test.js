/**
 * PayloadStore correctness gate.
 *
 * The contract this file defends:
 *   1. pack -> unpack is byte-exact for every payload shape we actually store.
 *   2. Legacy rows (plain JSON.stringify output) still unpack. This is what
 *      makes the change zero-migration; if it breaks, every historical row in
 *      a 30 GB database becomes unreadable.
 *   3. Small payloads produce byte-identical output to JSON.stringify, so the
 *      86% of rows below the threshold are provably untouched.
 *   4. Identical content writes exactly one blob (the 170x dedup win).
 *   5. A missing blob degrades to a sentinel, never an exception.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

let PayloadStore;
let blobPathFor;
let TMP;
let prevAgntHome;
let prevUserDataPath;
let prevDocker;

beforeAll(async () => {
  TMP = await fsp.mkdtemp(path.join(os.tmpdir(), 'agnt-payloadstore-'));

  // PathManager resolves its data dir from env at module-eval time, so this
  // must be set before the first import of anything that pulls it in.
  prevAgntHome = process.env.AGNT_HOME;
  prevUserDataPath = process.env.USER_DATA_PATH;
  prevDocker = process.env.DOCKER_CONTAINER;
  delete process.env.USER_DATA_PATH;
  delete process.env.DOCKER_CONTAINER;
  process.env.AGNT_HOME = TMP;

  const mod = await import('./PayloadStore.js');
  PayloadStore = mod.default;
  blobPathFor = mod.blobPathFor;
});

afterAll(async () => {
  if (prevAgntHome === undefined) delete process.env.AGNT_HOME;
  else process.env.AGNT_HOME = prevAgntHome;
  if (prevUserDataPath !== undefined) process.env.USER_DATA_PATH = prevUserDataPath;
  if (prevDocker !== undefined) process.env.DOCKER_CONTAINER = prevDocker;
  await fsp.rm(TMP, { recursive: true, force: true });
});

// Deterministic pseudo-random text so failures are reproducible.
const bigText = (bytes, seed = 'x') => {
  let s = '';
  let i = 0;
  while (s.length < bytes) s += `${seed}-chunk-${i++}-lorem-ipsum-dolor-sit-amet-consectetur `;
  return s.slice(0, bytes);
};

const countBlobs = async (dir) => {
  let n = 0;
  const walk = async (d) => {
    let entries;
    try { entries = await fsp.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) await walk(path.join(d, e.name));
      else if (!e.name.endsWith('.tmp')) n++;
    }
  };
  await walk(dir);
  return n;
};

describe('PayloadStore — inline fast path (86% of real rows)', () => {
  it('produces byte-identical output to JSON.stringify below the threshold', async () => {
    const cases = [
      { success: true, results: [1, 2, 3] },
      'a plain string',
      12345,
      true,
      null,
      [],
      {},
      { nested: { deep: { deeper: ['a', 'b'] } } },
    ];
    for (const v of cases) {
      const packed = await PayloadStore.pack(v);
      expect(packed).toBe(JSON.stringify(v));
      expect(await PayloadStore.unpack(packed)).toEqual(v);
    }
  });

  it('preserves undefined -> undefined so the column still binds NULL', async () => {
    expect(await PayloadStore.pack(undefined)).toBeUndefined();
    expect(JSON.stringify(undefined)).toBeUndefined();
  });

  it('round-trips a payload sitting exactly on the threshold boundary', async () => {
    for (const delta of [-2, -1, 0, 1, 2]) {
      const target = PayloadStore.INLINE_THRESHOLD + delta;
      const v = { d: bigText(Math.max(1, target - 12)) };
      const packed = await PayloadStore.pack(v);
      expect(await PayloadStore.unpack(packed)).toEqual(v);
    }
  });

  it('rejects non-serializable input the same way JSON.stringify does', async () => {
    const circular = {};
    circular.self = circular;
    await expect(PayloadStore.pack(circular)).rejects.toThrow();
  });
});

describe('PayloadStore — externalization', () => {
  it('round-trips a large JSON payload exactly', async () => {
    const v = {
      success: true,
      results: Array.from({ length: 400 }, (_, i) => ({
        i,
        title: `result number ${i}`,
        body: bigText(200, `b${i}`),
        tags: ['alpha', 'beta', 'gamma'],
      })),
    };
    const packed = await PayloadStore.pack(v);
    expect(PayloadStore.isExternalized(packed)).toBe(true);
    expect(packed.length).toBeLessThan(1000);
    expect(await PayloadStore.unpack(packed)).toEqual(v);
  });

  it('keeps a zero-I/O preview in the envelope', async () => {
    const v = { success: true, marker: 'FINDME', filler: bigText(50000) };
    const packed = await PayloadStore.pack(v);
    const preview = PayloadStore.preview(packed);
    expect(preview).toContain('FINDME');
    expect(preview.length).toBeLessThanOrEqual(300);
  });

  it('reports the original size without reading the blob', async () => {
    const v = { filler: bigText(60000) };
    const packed = await PayloadStore.pack(v);
    expect(PayloadStore.originalSize(packed)).toBe(Buffer.byteLength(JSON.stringify(v), 'utf8'));
  });

  it('handles unicode and emoji without corruption', async () => {
    const v = { text: '日本語テキスト 🎉 émoji ünïcode '.repeat(1000), ok: true };
    const packed = await PayloadStore.pack(v);
    expect(await PayloadStore.unpack(packed)).toEqual(v);
  });
});

describe('PayloadStore — base64 data-URIs (the 170x dedup case)', () => {
  const makeAudioPayload = (bytes, seed = 7) => {
    const buf = Buffer.alloc(bytes);
    for (let i = 0; i < bytes; i++) buf[i] = (i * seed + 13) % 256;
    return {
      success: true,
      audioUrl: `data:audio/mpeg;base64,${buf.toString('base64')}`,
      voice: 'alloy',
    };
  };

  it('round-trips a data-URI payload byte-exactly', async () => {
    const v = makeAudioPayload(300_000);
    const packed = await PayloadStore.pack(v);
    const out = await PayloadStore.unpack(packed);
    expect(out).toEqual(v);
    expect(out.audioUrl).toBe(v.audioUrl);
  });

  it('stores ONE blob for 165 identical payloads', async () => {
    const root = path.join(TMP, '.agnt', 'data', 'blobs', 'dedup-probe');
    await fsp.mkdir(root, { recursive: true });

    const v = makeAudioPayload(250_000, 11);
    const before = await countBlobs(PayloadStore.blobRoot());

    const packedAll = [];
    for (let i = 0; i < 165; i++) packedAll.push(await PayloadStore.pack(v));

    const after = await countBlobs(PayloadStore.blobRoot());
    // One audio blob. The residual JSON is tiny post-hoist, so it stays inline.
    expect(after - before).toBeLessThanOrEqual(2);

    // Every copy must still reconstruct independently.
    expect(await PayloadStore.unpack(packedAll[0])).toEqual(v);
    expect(await PayloadStore.unpack(packedAll[164])).toEqual(v);
    expect(new Set(packedAll).size).toBe(1);
  });

  it('shrinks the stored column by orders of magnitude', async () => {
    const v = makeAudioPayload(1_000_000, 3);
    const legacy = JSON.stringify(v).length;
    const packed = await PayloadStore.pack(v);
    expect(packed.length).toBeLessThan(legacy / 100);
    expect(await PayloadStore.unpack(packed)).toEqual(v);
  });

  it('handles multiple data-URIs in one payload', async () => {
    const v = {
      images: [
        `data:image/png;base64,${Buffer.alloc(40_000, 1).toString('base64')}`,
        `data:image/png;base64,${Buffer.alloc(40_000, 2).toString('base64')}`,
        `data:image/png;base64,${Buffer.alloc(40_000, 1).toString('base64')}`,
      ],
    };
    const packed = await PayloadStore.pack(v);
    expect(await PayloadStore.unpack(packed)).toEqual(v);
  });

  it('preserves non-canonical base64 verbatim (mode t)', async () => {
    // Deliberately malformed padding: decode+re-encode would NOT be identity,
    // so the store must fall back to storing the text as-is.
    const weird = `${'QUJDREVG'.repeat(600)}A`;
    const v = { blob: `data:application/octet-stream;base64,${weird}` };
    const packed = await PayloadStore.pack(v);
    const out = await PayloadStore.unpack(packed);
    expect(out.blob).toBe(v.blob);
  });

  it('leaves data-URIs below the min size inline', async () => {
    const small = `data:image/png;base64,${Buffer.alloc(300, 9).toString('base64')}`;
    const v = { icon: small, filler: bigText(50_000) };
    const packed = await PayloadStore.pack(v);
    expect(await PayloadStore.unpack(packed)).toEqual(v);
  });
});

describe('PayloadStore — backward compatibility (zero-migration contract)', () => {
  it('unpacks legacy plain-JSON rows written before this feature existed', async () => {
    const legacyRows = [
      JSON.stringify({ success: true, data: [1, 2, 3] }),
      JSON.stringify({ huge: bigText(200_000) }),
      JSON.stringify('bare string'),
      JSON.stringify(null),
      JSON.stringify(42),
    ];
    for (const row of legacyRows) {
      expect(await PayloadStore.unpack(row)).toEqual(JSON.parse(row));
    }
  });

  it('passes through null and undefined unchanged', async () => {
    expect(await PayloadStore.unpack(null)).toBeNull();
    expect(await PayloadStore.unpack(undefined)).toBeUndefined();
  });

  it('returns raw text for a column that was never valid JSON', async () => {
    expect(await PayloadStore.unpack('not json at all')).toBe('not json at all');
  });

  it('does not mistake user data containing the envelope key for an envelope', async () => {
    const v = { __agnt_ref: 'this is user data, not an envelope', more: bigText(80_000) };
    const packed = await PayloadStore.pack(v);
    expect(await PayloadStore.unpack(packed)).toEqual(v);
  });
});

describe('PayloadStore — failure modes', () => {
  it('degrades to a sentinel when a blob is missing, never throws', async () => {
    const v = { data: bigText(120_000) };
    const packed = await PayloadStore.pack(v);
    const env = JSON.parse(packed);

    await fsp.unlink(blobPathFor(env.h));

    const out = await PayloadStore.unpack(packed);
    expect(out.__agnt_missing).toBe(true);
    expect(out.hash).toBe(env.h);
    expect(out.preview).toBeTruthy();
  });

  it('survives a truncated / corrupt blob file', async () => {
    const v = { data: bigText(120_000, 'corrupt') };
    const packed = await PayloadStore.pack(v);
    const env = JSON.parse(packed);

    await fsp.writeFile(blobPathFor(env.h), Buffer.from('garbage not a valid codec stream'));

    const out = await PayloadStore.unpack(packed);
    expect(out.__agnt_missing).toBe(true);
  });

  it('leaves no .tmp files behind after writes', async () => {
    await PayloadStore.pack({ x: bigText(90_000, 'tmpcheck') });
    const leftovers = [];
    const walk = async (d) => {
      let entries;
      try { entries = await fsp.readdir(d, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.isDirectory()) await walk(path.join(d, e.name));
        else if (e.name.endsWith('.tmp')) leftovers.push(e.name);
      }
    };
    await walk(PayloadStore.blobRoot());
    expect(leftovers).toEqual([]);
  });
});

describe('PayloadStore — concurrency', () => {
  // Asserts the guaranteed contract, not envelope-string identity. pack() is
  // explicitly allowed to fall back to an inline write when the blob store
  // errors ("the blob store is an optimization, never a correctness
  // dependency") — under full-suite I/O contention on Windows one of 40
  // concurrent packs can legitimately take that path, which made the old
  // `new Set(results).size === 1` assertion fail intermittently. What must
  // ALWAYS hold: every result round-trips, and everything that did externalize
  // shares one hash backed by exactly one blob on disk (the dedup win).
  it('handles many concurrent writes of identical content', async () => {
    const v = { shared: bigText(150_000, 'concurrent') };
    const results = await Promise.all(Array.from({ length: 40 }, () => PayloadStore.pack(v)));

    // 1. Correctness is unconditional.
    const back = await Promise.all(results.map((r) => PayloadStore.unpack(r)));
    for (const b of back) expect(b).toEqual(v);

    // 2. Dedup: every externalized result points at the same content hash.
    const hashes = new Set(
      results
        .map((r) => { try { return JSON.parse(r); } catch { return null; } })
        .filter((e) => e && e.h)
        .map((e) => e.h),
    );
    expect(hashes.size, 'identical content must resolve to a single content hash').toBe(1);

    // 3. ...backed by exactly one file, with no temp files stranded by the
    //    39 writers that lost the race. Scoped to this hash: the ab/cd/ fanout
    //    directory is shared, so other payloads may legitimately live here.
    const [hash] = [...hashes];
    const blobPath = blobPathFor(hash);
    expect(fs.existsSync(blobPath)).toBe(true);

    const leafDir = path.dirname(blobPath);
    const entries = await fsp.readdir(leafDir);
    expect(entries.filter((n) => n === hash)).toEqual([hash]);
    expect(entries.filter((n) => n.startsWith(hash) && n.endsWith('.tmp'))).toEqual([]);
  });

  it('handles concurrent writes of distinct content', async () => {
    const vals = Array.from({ length: 25 }, (_, i) => ({ i, data: bigText(20_000, `d${i}`) }));
    const packed = await Promise.all(vals.map((v) => PayloadStore.pack(v)));
    const back = await Promise.all(packed.map((p) => PayloadStore.unpack(p)));
    expect(back).toEqual(vals);
  });
});

describe('PayloadStore — GC support', () => {
  it('reports every referenced hash from an envelope', async () => {
    const v = { data: bigText(100_000, 'gc') };
    const packed = await PayloadStore.pack(v);
    const hashes = PayloadStore.referencedHashes(packed);
    expect(hashes.size).toBe(1);
    expect(hashes.has(JSON.parse(packed).h)).toBe(true);
  });

  it('reports hashes from inline marker rows', async () => {
    const v = { audio: `data:audio/mpeg;base64,${Buffer.alloc(200_000, 5).toString('base64')}` };
    const packed = await PayloadStore.pack(v);
    expect(PayloadStore.referencedHashes(packed).size).toBeGreaterThanOrEqual(1);
  });

  it('returns an empty set for inline rows and junk', () => {
    expect(PayloadStore.referencedHashes('{"a":1}').size).toBe(0);
    expect(PayloadStore.referencedHashes(null).size).toBe(0);
    expect(PayloadStore.referencedHashes(12345).size).toBe(0);
  });
});
