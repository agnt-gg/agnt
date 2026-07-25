/**
 * PayloadStore — content-addressed payload externalization for SQLite columns.
 *
 * WHY THIS EXISTS
 * ---------------
 * `node_executions.input` / `.output` stored `JSON.stringify(value)` inline.
 * On any long-lived database that degrades as follows:
 *
 *   - The overwhelming majority of the table's pages become OVERFLOW pages
 *     rather than leaf pages.
 *   - Aggregates over columns positioned *after* `output` in the record (e.g.
 *     `SELECT SUM(credits_used)`, where credits_used is column 10) slow by
 *     roughly an order of magnitude, because SQLite must walk every overflow
 *     chain to reach them. The identical scan answering a header-only
 *     predicate (`error IS NOT NULL`) is dramatically cheaper. That delta is
 *     the blobs, not the row count.
 *   - WAL grows out of all proportion to the number of rows written. Under
 *     Litestream (PRD-115 cloud) every one of those bytes ships to object
 *     storage.
 *   - A large TTS/audio payload re-emitted by repeated runs is stored once per
 *     run, so duplicate base64 comes to dominate the table.
 *
 * WHAT IT DOES
 * ------------
 * Small payloads (<= INLINE_THRESHOLD) are stored exactly as before — a wash
 * on read (an inline column read and a blob read + decompress land within
 * noise of each other) and below the 4 KiB filesystem allocation unit, so a
 * file would waste more than it saves.
 *
 * Large payloads are written to a content-addressed blob store and the column
 * holds a small envelope carrying a preview, so list views / recall / the
 * executions dashboard render WITHOUT touching disk.
 *
 * Base64 data-URIs are handled separately: they are decoded to binary and
 * stored raw. zstd on base64-heavy payloads lands around 1.3x at every level —
 * compression is pointless there. Dedup is the win, and it is a large multiple.
 *
 * COMPRESSION (representative JSON and base64-heavy payloads)
 *   BIG  (base64-heavy):  L1 ~1.3x    L6 ~1.4x  at roughly half the throughput
 *   MID  (JSON/text):     L1 ~6.4x    L6 ~7.1x  at roughly a sixth
 * => level 1. L6 buys ~11% more ratio for ~6x the CPU.
 *
 * SAFETY CONTRACT
 * ---------------
 * 1. `unpack()` falls through to plain JSON.parse for anything that is not an
 *    envelope. Every pre-existing row keeps working with ZERO migration.
 *    Backfill is optional, not a release gate.
 * 2. Write order is blob -> rename -> return envelope. The caller commits the
 *    row only after pack() resolves. A crash can orphan a blob (harmless, GC
 *    reaps it) but can never commit a row pointing at a blob that does not
 *    exist. See DURABILITY below for why there is no fsync by default.
 * 3. A missing blob degrades to `{ __agnt_missing: true, preview }` instead of
 *    throwing, so one lost blob breaks one node — not the executions view.
 * 4. Blobs are immutable and hash-named. A newer blob tree is always a superset
 *    of an older one, which is what makes restore-blobs-then-DB safe.
 */

import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import zlib from 'zlib';
import { promisify } from 'util';
import PathManager from '../../utils/PathManager.js';

// ---------------------------------------------------------------- tuning ----

/**
 * Payloads at or below this stay inline as plain JSON.
 *
 * 4096 = the default NTFS/ext4 allocation unit. Below it a blob file costs a
 * full block regardless of content, so externalizing would ADD bytes.
 *
 * Payload sizes are heavily skewed: the median row is on the order of a
 * kilobyte while the tail runs to megabytes. Rows above one allocation unit
 * are therefore a small minority of ROWS but very nearly all of the BYTES, so
 * this single threshold moves almost all of the bytes while leaving the large
 * majority of rows completely untouched.
 */
const INLINE_THRESHOLD = 4096;

/** Only externalize a data-URI whose base64 body is at least this long. */
const MIN_DATA_URI_B64 = 2048;

/** Preview kept in the envelope. Enough for a list row; never parsed. */
const PREVIEW_CHARS = 300;

/** zstd level. See measurements above — 1 is the knee of the curve. */
const ZSTD_LEVEL = 1;

/**
 * DURABILITY: fsync each blob before returning?
 *
 * Default OFF, and that is deliberate rather than lazy. Relative cost of the
 * write strategies (NTFS, ~100 KB payload):
 *
 *   temp + fsync + rename   ~90 ms
 *   temp + rename            ~2 ms          <- ~47x faster
 *   + mkdir cache            ~1 ms
 *   dedup hit (stat only)    sub-millisecond
 *
 * A ~90 ms fsync on every node execution would be a visible workflow slowdown.
 * More importantly it would be INCOHERENT: AGNT already runs
 * `PRAGMA synchronous = NORMAL` (database/index.js), under which SQLite does
 * NOT fsync the WAL on commit — it only syncs at checkpoints, accepting that
 * the last few transactions can be lost on power loss. Fsyncing blobs would
 * protect them *more* strictly than the rows that reference them.
 *
 * What we keep regardless of this flag is ATOMICITY: write to a temp file,
 * then rename. Rename is atomic on NTFS and POSIX, so a reader can never
 * observe a half-written blob. The failure envelope becomes:
 *
 *   - process crash / OOM  : page cache survives -> blob and WAL both intact.
 *   - power loss           : last WAL frames AND last blobs may both be lost,
 *                            which is exactly synchronous=NORMAL's contract.
 *
 * Set AGNT_BLOB_FSYNC=true for deployments that also run synchronous=FULL.
 */
const FSYNC_BLOBS = process.env.AGNT_BLOB_FSYNC === 'true';

/** Envelope marker. Presence of this key is what makes a row an envelope. */
const ENVELOPE_KEY = '__agnt_ref';
const ENVELOPE_VERSION = 1;

/** Inline marker that replaces a data-URI's base64 body. */
const BLOB_MARKER_PREFIX = 'agnt-blob:v1:';

// ------------------------------------------------------------- codec ids ----

const CODEC_ZSTD = 'zstd';
const CODEC_RAW = 'raw';

// --------------------------------------------------------------- zstd io ----

/**
 * Node 22.16 exposes zstdCompress/zstdDecompress. Older builds do not.
 * If zstd is unavailable we transparently fall back to gzip so the store still
 * works — correctness never depends on a specific codec being present, because
 * the codec id travels inside the envelope.
 */
const HAS_ZSTD = typeof zlib.zstdCompress === 'function';

const zstdCompress = HAS_ZSTD ? promisify(zlib.zstdCompress) : null;
const zstdDecompress = HAS_ZSTD ? promisify(zlib.zstdDecompress) : null;
const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

const CODEC_ACTIVE = HAS_ZSTD ? CODEC_ZSTD : 'gzip';

async function compress(buf) {
  if (HAS_ZSTD) {
    return zstdCompress(buf, {
      params: { [zlib.constants.ZSTD_c_compressionLevel]: ZSTD_LEVEL },
    });
  }
  return gzip(buf, { level: 1 });
}

async function decompress(buf, codec) {
  if (codec === CODEC_ZSTD) {
    if (!zstdDecompress) throw new Error('PayloadStore: blob is zstd but this Node build has no zstd support');
    return zstdDecompress(buf);
  }
  if (codec === 'gzip') return gunzip(buf);
  if (codec === CODEC_RAW) return buf;
  throw new Error(`PayloadStore: unknown codec "${codec}"`);
}

// ------------------------------------------------------------ blob paths ----

let _blobRoot = null;

function blobRoot() {
  if (_blobRoot) return _blobRoot;
  _blobRoot = PathManager.getDataPath('blobs');
  return _blobRoot;
}

/**
 * ab/cd/<hash> fanout. 256 x 256 = 65,536 leaf directories, so even a fleet
 * tenant with a million blobs averages ~15 files per directory — keeps `ls`,
 * rsync and inode locality sane.
 */
function blobPathFor(hash) {
  return path.join(blobRoot(), hash.slice(0, 2), hash.slice(2, 4), hash);
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Directories we have already created this process. `mkdir(recursive)` on an
 * existing path still costs a syscall, and skipping it is measurably cheaper.
 * Bounded so a long-lived tenant cannot grow it without limit (65,536 possible
 * leaves x ~80 B would be ~5 MB at full saturation).
 */
const _dirCache = new Set();
const DIR_CACHE_MAX = 20000;

async function ensureDir(dir) {
  if (_dirCache.has(dir)) return;
  await fsp.mkdir(dir, { recursive: true });
  if (_dirCache.size >= DIR_CACHE_MAX) _dirCache.clear();
  _dirCache.add(dir);
}

/**
 * Write a blob content-addressably.
 *
 * Returns `{ hash, bytes, deduped }`. If the hash already exists on disk we do
 * NOT rewrite it — that is the 170x win on repeated payloads, and it turns the
 * 165-copy TTS blob into a single file forever.
 *
 * Durability: temp file -> (optional fsync) -> rename. The rename is atomic,
 * so a reader can never observe a partially written blob, and it completes
 * BEFORE the row is committed (the caller awaits pack()) — the ordering that
 * makes a crash lose at most an orphan blob rather than a dangling reference.
 * See FSYNC_BLOBS above for why the sync is opt-in.
 */
async function writeBlob(buf) {
  const hash = sha256(buf);
  const dest = blobPathFor(hash);

  try {
    const st = await fsp.stat(dest);
    if (st.size > 0) return { hash, bytes: st.size, deduped: true };
  } catch {
    /* not present — fall through and write it */
  }

  await ensureDir(path.dirname(dest));

  const tmp = `${dest}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  let fh;
  try {
    fh = await fsp.open(tmp, 'wx');
    await fh.writeFile(buf);
    if (FSYNC_BLOBS) await fh.sync();
  } finally {
    if (fh) await fh.close().catch(() => {});
  }

  try {
    await fsp.rename(tmp, dest);
  } catch (err) {
    // Lost a race with a concurrent writer of the SAME content. Content
    // addressing makes that benign: the winner's bytes are identical to ours.
    await fsp.unlink(tmp).catch(() => {});
    if (!fs.existsSync(dest)) throw err;
    return { hash, bytes: buf.length, deduped: true };
  }

  return { hash, bytes: buf.length, deduped: false };
}

async function readBlob(hash) {
  return fsp.readFile(blobPathFor(hash));
}

// -------------------------------------------------------- data-URI logic ----

const B64_CHAR = /[A-Za-z0-9+/=]/;

/**
 * Find base64 data-URI bodies without regex.
 *
 * A regex like /data:[^;]+;base64,([A-Za-z0-9+/=]+)/g blows the stack on a
 * multi-megabyte match ("Maximum call stack size exceeded") — a real failure
 * mode for embedded audio/image payloads. An indexOf + character-walk scan is
 * O(n), allocation-free until a hit, and cannot overflow.
 */
function findDataUriBodies(str) {
  const hits = [];
  let i = 0;
  while ((i = str.indexOf(';base64,', i)) !== -1) {
    const start = i + 8;
    let end = start;
    while (end < str.length && B64_CHAR.test(str[end])) end++;
    if (end - start >= MIN_DATA_URI_B64) hits.push({ start, end });
    i = end > i ? end : i + 8;
  }
  return hits;
}

/**
 * Replace every large data-URI body with `agnt-blob:v1:<hash>:<mode>`.
 *
 * mode 'b' — the base64 decoded and re-encoded byte-identically, so we store
 *            decoded BINARY (a further ~1.33x on top of dedup).
 * mode 't' — round-trip was not exact (non-canonical padding / whitespace), so
 *            we store the base64 TEXT verbatim. Correctness beats the extra
 *            25%: this guarantees pack/unpack is always byte-exact.
 */
async function externalizeDataUris(str) {
  const hits = findDataUriBodies(str);
  if (hits.length === 0) return { text: str, blobs: [] };

  const blobs = [];
  const out = [];
  let cursor = 0;

  for (const { start, end } of hits) {
    const b64 = str.slice(start, end);
    let buf;
    let mode;

    const decoded = Buffer.from(b64, 'base64');
    if (decoded.toString('base64') === b64) {
      buf = decoded;
      mode = 'b';
    } else {
      buf = Buffer.from(b64, 'utf8');
      mode = 't';
    }

    const { hash, bytes, deduped } = await writeBlob(buf);
    blobs.push({ hash, bytes, deduped, mode, originalB64Length: b64.length });

    out.push(str.slice(cursor, start));
    out.push(`${BLOB_MARKER_PREFIX}${hash}:${mode}`);
    cursor = end;
  }
  out.push(str.slice(cursor));

  return { text: out.join(''), blobs };
}

/** Inverse of externalizeDataUris. */
async function inlineDataUris(str) {
  if (!str.includes(BLOB_MARKER_PREFIX)) return str;

  const out = [];
  let cursor = 0;
  let i = 0;

  while ((i = str.indexOf(BLOB_MARKER_PREFIX, cursor)) !== -1) {
    const hashStart = i + BLOB_MARKER_PREFIX.length;
    const hash = str.slice(hashStart, hashStart + 64);
    const mode = str[hashStart + 65];
    const markerEnd = hashStart + 66;

    out.push(str.slice(cursor, i));
    try {
      const buf = await readBlob(hash);
      out.push(mode === 'b' ? buf.toString('base64') : buf.toString('utf8'));
    } catch {
      // Missing blob: keep going. The surrounding JSON stays valid and the
      // caller sees an obvious sentinel instead of an exception.
      out.push('');
    }
    cursor = markerEnd;
  }
  out.push(str.slice(cursor));
  return out.join('');
}

// ------------------------------------------------------------- envelopes ----

function isEnvelopeString(stored) {
  // Cheap reject before any parse: an envelope always starts `{"__agnt_ref"`.
  return typeof stored === 'string' && stored.length > 20 && stored.startsWith(`{"${ENVELOPE_KEY}"`);
}

function parseEnvelope(stored) {
  if (!isEnvelopeString(stored)) return null;
  try {
    const env = JSON.parse(stored);
    return env && env[ENVELOPE_KEY] === ENVELOPE_VERSION ? env : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ API -----

const PayloadStore = {
  INLINE_THRESHOLD,
  ENVELOPE_KEY,

  /**
   * Serialize a value for storage in a TEXT/JSON column.
   *
   * Drop-in replacement for `JSON.stringify(value)`:
   *   - `undefined` in -> `undefined` out (so the column still binds to NULL,
   *     preserving the pre-existing behaviour exactly).
   *   - small payloads -> identical bytes to JSON.stringify.
   *   - large payloads -> a small envelope; blob durably on disk BEFORE resolve.
   */
  async pack(value) {
    let json;
    try {
      json = JSON.stringify(value);
    } catch (err) {
      // Circular / non-serializable: preserve legacy failure semantics.
      throw err;
    }
    if (json === undefined) return undefined;

    // Fast path: the large majority of rows are well under the threshold and
    // never leave here.
    if (Buffer.byteLength(json, 'utf8') <= INLINE_THRESHOLD) return json;

    try {
      // 1. Hoist base64 data-URIs out first. This is what collapses the
      //    165-copy TTS payload and stops us compressing incompressible bytes.
      const { text, blobs } = await externalizeDataUris(json);

      // Re-check: after hoisting the audio out, the residual JSON is often
      // tiny and belongs inline.
      const residualBytes = Buffer.byteLength(text, 'utf8');
      if (residualBytes <= INLINE_THRESHOLD) {
        return blobs.length > 0 ? text : json;
      }

      // 2. Compress and externalize the residual.
      const raw = Buffer.from(text, 'utf8');
      const packed = await compress(raw);
      const { hash, bytes } = await writeBlob(packed);

      const envelope = {
        [ENVELOPE_KEY]: ENVELOPE_VERSION,
        h: hash,
        n: raw.length,
        c: bytes,
        z: CODEC_ACTIVE,
        p: text.slice(0, PREVIEW_CHARS),
      };
      return JSON.stringify(envelope);
    } catch (err) {
      // ENOSPC, EACCES, EMFILE... The blob store is an optimization, never a
      // correctness dependency. Fall back to the legacy inline write so a
      // full disk degrades to "big database" instead of "lost execution".
      console.error('[PayloadStore] pack failed, storing inline:', err.message);
      return json;
    }
  },

  /**
   * Inverse of pack(). Drop-in replacement for `JSON.parse(stored)`.
   *
   * Legacy rows (plain JSON, no envelope) parse exactly as before — this is
   * what makes the change zero-migration.
   */
  async unpack(stored) {
    if (stored === null || stored === undefined) return stored;
    if (typeof stored !== 'string') return stored;

    const env = parseEnvelope(stored);
    if (!env) {
      // Not an envelope. It may still carry inline blob markers (the case
      // where base64 was hoisted but the residual stayed inline).
      const text = stored.includes(BLOB_MARKER_PREFIX) ? await inlineDataUris(stored) : stored;
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }

    try {
      const packed = await readBlob(env.h);
      const raw = await decompress(packed, env.z);
      const text = await inlineDataUris(raw.toString('utf8'));
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    } catch (err) {
      // Blob gone (GC bug, partial restore, disk fault). Degrade loudly but
      // locally — never throw into the executions view.
      console.error(`[PayloadStore] blob ${env.h?.slice(0, 12)} unreadable:`, err.message);
      return {
        __agnt_missing: true,
        reason: err.code || err.message,
        hash: env.h,
        bytes: env.n,
        preview: env.p,
      };
    }
  },

  /**
   * Zero-I/O preview for list views. This is the field that makes
   * externalization a performance WIN rather than a tradeoff: the executions
   * dashboard, `recall`, and every "show me the runs" query render from here
   * and never open a file.
   */
  preview(stored) {
    if (typeof stored !== 'string') return '';
    const env = parseEnvelope(stored);
    if (env) return env.p || '';
    return stored.slice(0, PREVIEW_CHARS);
  },

  /** True if this column value points at external storage. */
  isExternalized(stored) {
    return parseEnvelope(stored) !== null || (typeof stored === 'string' && stored.includes(BLOB_MARKER_PREFIX));
  },

  /** Byte length of the original payload, without reading the blob. */
  originalSize(stored) {
    if (typeof stored !== 'string') return 0;
    const env = parseEnvelope(stored);
    return env ? env.n || 0 : Buffer.byteLength(stored, 'utf8');
  },

  /**
   * Every blob hash referenced by a stored column value. Used by the GC's mark
   * phase. Deliberately string-scanning rather than parsing: it must work on
   * both envelopes and marker-carrying inline rows, and must never throw.
   */
  referencedHashes(stored) {
    const out = new Set();
    if (typeof stored !== 'string') return out;

    const env = parseEnvelope(stored);
    if (env?.h) out.add(env.h);

    let i = 0;
    while ((i = stored.indexOf(BLOB_MARKER_PREFIX, i)) !== -1) {
      const h = stored.slice(i + BLOB_MARKER_PREFIX.length, i + BLOB_MARKER_PREFIX.length + 64);
      if (/^[0-9a-f]{64}$/.test(h)) out.add(h);
      i += BLOB_MARKER_PREFIX.length + 64;
    }
    return out;
  },

  /**
   * Hashes reachable from a payload WITHOUT reading it — envelope hash plus any
   * markers embedded in the preview. Insufficient for GC on its own: an
   * envelope's own body can reference further blobs, so the GC must unpack.
   * Exposed for diagnostics.
   */
  blobPathFor,
  blobRoot,

  /** Store-wide stats for diagnostics / the storage settings screen. */
  async stats() {
    const root = blobRoot();
    void FSYNC_BLOBS;
    let files = 0;
    let bytes = 0;
    const walk = async (dir) => {
      let entries;
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) await walk(p);
        else {
          files++;
          try {
            bytes += (await fsp.stat(p)).size;
          } catch { /* raced with GC */ }
        }
      }
    };
    await walk(root);
    return { root, files, bytes, codec: CODEC_ACTIVE, threshold: INLINE_THRESHOLD, hasZstd: HAS_ZSTD, fsync: FSYNC_BLOBS };
  },
};

export default PayloadStore;
export { INLINE_THRESHOLD, BLOB_MARKER_PREFIX, ENVELOPE_KEY, blobPathFor, blobRoot };
