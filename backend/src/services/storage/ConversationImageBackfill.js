/**
 * ConversationImageBackfill — one-time, idle-gated extraction of inline
 * base64 images from saved conversation blobs (content_outputs,
 * content_type='conversation') into the on-disk ImageStorage.
 *
 * WHY
 * ---
 * Until 2026-07 the chat frontend resolved {{IMAGE_REF:id}} tokens into full
 * base64 data URIs at save time, so every image-heavy conversation blob
 * carried megabytes of duplicated base64 that already existed on disk
 * server-side (ImageStorage writes every generated image at generation time).
 * Measured on a long-lived install: 85% of a typical 5.5MB conversation blob
 * was inline base64; the worst row was 68MB and took ~2.4s just to fetch and
 * parse. The frontend fix stops NEW inlining; this migration remediates the
 * blobs users already have. New installs find zero candidates and skip
 * everything.
 *
 * SAFETY MODEL (the load-bearing invariants)
 * ------------------------------------------
 * 1. VERIFY BEFORE REWRITE. Every extracted image is written to disk and
 *    read back byte-compared against the decoded buffer BEFORE the blob is
 *    touched. A {{IMAGE_REF}} that resolves to a missing/corrupt file would
 *    be silent data loss; there is no mode in which this writes a blob whose
 *    refs it could not first prove will serve.
 * 2. COMPARE-AND-SWAP. The rewrite is `UPDATE ... WHERE id=? AND content=?`.
 *    If the user autosaved that conversation between our read and our write,
 *    changes=0 and the row is skipped untouched — a live conversation can
 *    never be clobbered. Skipped rows are retried on the next boot.
 * 3. updated_at IS NEVER TOUCHED, so the user's saved-chats ordering never
 *    shuffles underneath them.
 * 4. PER-ROW INDEPENDENCE. Each row is parsed, verified, backed up, and
 *    swapped on its own. A crash mid-run leaves every completed row done and
 *    every untouched row pristine; the next boot resumes automatically
 *    because migrated rows no longer match the candidate filter. Image ids
 *    are content-hashed (img-bf-<sha1_16>), so re-extraction after an
 *    interrupt rewrites the identical file — fully idempotent.
 * 5. SKIP, DON'T THROW. Unparseable JSON, unexpected shapes, malformed data
 *    URIs: the row is left byte-identical and counted. A blob we cannot
 *    understand is a blob we do not touch.
 * 6. BACKUPS. The original blob is gzipped into <dataDir>/backfill-backups/
 *    before the swap. Backups older than 30 days are pruned at the start of
 *    each run.
 * 7. DISK PREFLIGHT. Refuses to start (and refuses individual whale rows)
 *    when free space is low — the lesson from the legacyMigration copy bug.
 *
 * SCHEDULING
 * ----------
 * Never runs at boot. scheduleConversationImageBackfill() mirrors the
 * deferred-index-build pattern: wait 5 minutes, then require a 3-minute
 * WAL-idle window (WAL mtime observes writes from BOTH processes) before
 * starting, re-checking idleness between batches. All timers are unref()'d —
 * maintenance is never the reason the process won't exit. Main process only
 * (the workflow child skips schema init and never schedules this).
 */

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import crypto from 'crypto';

// Matches the frontend's save-time inlining format exactly: a raw data URI
// inside a JS string (post-JSON.parse, so no escaping to worry about).
const DATA_URI_RE = /data:image\/([a-zA-Z0-9+.-]+);base64,([A-Za-z0-9+/=]+)/g;

// Below this, externalizing costs more (an HTTP round-trip per render) than
// it saves. Same threshold the one-off operator script used.
const MIN_DATA_URI_CHARS = 8192;

// Free-space floors. MIN_FREE_BYTES gates the whole run; per-row we
// additionally require 2x the decoded image bytes on top of the floor.
const MIN_FREE_BYTES = 256 * 1024 * 1024;

const BACKUP_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

// Watermark file (lives in backupDir). Without it, rows whose data URIs are
// all below MIN_DATA_URI_CHARS — terminally 'no-images' — match the LIKE
// filter forever and get re-fetched and re-parsed on EVERY boot (measured:
// 259 rows / 390MB per boot on a long-lived install). The watermark records
// the DB-clock timestamp of the last COMPLETE pass; subsequent runs only
// consider rows autosaved after it. Failed rows (verify/drift/low-disk)
// hold the watermark back to their own updated_at so they are retried.
// A corrupt or missing watermark degrades to a full rescan — never unsafe,
// only slower.
const WATERMARK_FILE = '.image-backfill-watermark.json';

function readWatermark(backupDir) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(backupDir, WATERMARK_FILE), 'utf8'));
    return typeof raw.updatedBefore === 'string' ? raw.updatedBefore : null;
  } catch {
    return null;
  }
}

function writeWatermark(backupDir, updatedBefore, log) {
  try {
    fs.mkdirSync(backupDir, { recursive: true });
    fs.writeFileSync(path.join(backupDir, WATERMARK_FILE), JSON.stringify({ updatedBefore, writtenAt: new Date().toISOString() }));
  } catch (err) {
    log(`[ConversationImageBackfill] watermark write failed (non-fatal, next boot rescans): ${err.message}`);
  }
}

const extFromMime = (mimeSubtype) => {
  const s = String(mimeSubtype || 'png').toLowerCase().replace('+xml', '').replace(/[^a-z0-9]/g, '');
  return s === 'jpeg' ? 'jpg' : s || 'png';
};

/**
 * Replace qualifying data URIs in one message-content string with
 * {{IMAGE_REF:img-bf-<hash>}} tokens. Images are deduped by content hash into
 * `imageMap` (id -> { dataUrl, buf }). Returns the rewritten string and how
 * many URIs were replaced.
 */
export function extractInlineImages(text, imageMap) {
  if (typeof text !== 'string' || text.indexOf('data:image/') === -1) {
    return { text, replaced: 0 };
  }
  let replaced = 0;
  const out = text.replace(DATA_URI_RE, (full, mime, b64) => {
    if (full.length < MIN_DATA_URI_CHARS) return full;
    let buf;
    try {
      buf = Buffer.from(b64, 'base64');
    } catch {
      return full; // malformed base64 — leave it alone
    }
    if (buf.length === 0) return full;
    const id = `img-bf-${crypto.createHash('sha1').update(b64).digest('hex').slice(0, 16)}`;
    if (!imageMap.has(id)) {
      imageMap.set(id, { dataUrl: `data:image/${extFromMime(mime)};base64,${b64}`, buf });
    }
    replaced++;
    return `{{IMAGE_REF:${id}}}`;
  });
  return { text: out, replaced };
}

/** Best-effort free-bytes probe. Returns Infinity when the API is unavailable
 *  (old Node / exotic FS) — the preflight then fails open, and the per-row
 *  write path still surfaces real ENOSPC as a per-row failure, not corruption. */
function freeBytes(dir) {
  try {
    const st = fs.statfsSync(dir);
    return st.bsize * st.bavail;
  } catch {
    return Infinity;
  }
}

function pruneOldBackups(backupDir, log) {
  try {
    if (!fs.existsSync(backupDir)) return;
    const now = Date.now();
    for (const f of fs.readdirSync(backupDir)) {
      if (!f.endsWith('.json.gz')) continue;
      const full = path.join(backupDir, f);
      try {
        if (now - fs.statSync(full).mtimeMs > BACKUP_RETENTION_MS) fs.unlinkSync(full);
      } catch { /* one stubborn file must not stop the sweep */ }
    }
  } catch (err) {
    log(`[ConversationImageBackfill] backup prune failed (non-fatal): ${err.message}`);
  }
}

/**
 * Process a single content_outputs row.
 * Returns one of: 'migrated' | 'no-images' | 'unparseable' | 'verify-failed'
 *               | 'drift' | 'low-disk' | 'error'
 */
export async function backfillRow(deps, row) {
  const { dbRun, saveBase64Image, findImageFile, backupDir, log } = deps;
  const original = row.content;

  let conv;
  try {
    conv = JSON.parse(original);
  } catch {
    return 'unparseable';
  }
  if (!conv || !Array.isArray(conv.messages)) return 'unparseable';

  const imageMap = new Map();
  let replaced = 0;
  for (const msg of conv.messages) {
    if (msg && typeof msg.content === 'string') {
      const r = extractInlineImages(msg.content, imageMap);
      msg.content = r.text;
      replaced += r.replaced;
    }
  }
  if (replaced === 0) return 'no-images';

  // Per-row disk preflight: decoded bytes we're about to write, doubled for
  // headroom, on top of the global floor.
  let decodedBytes = 0;
  for (const { buf } of imageMap.values()) decodedBytes += buf.length;
  if (freeBytes(backupDir) < MIN_FREE_BYTES + decodedBytes * 2) {
    return 'low-disk';
  }

  // 1. Write + byte-verify every image BEFORE touching the blob.
  for (const [id, { dataUrl, buf }] of imageMap) {
    try {
      const savedPath = saveBase64Image(id, dataUrl);
      const onDisk = savedPath || findImageFile(id);
      if (!onDisk) return 'verify-failed';
      const readBack = fs.readFileSync(onDisk);
      if (!readBack.equals(buf)) return 'verify-failed';
    } catch (err) {
      log(`[ConversationImageBackfill] image ${id} for row ${row.id} failed verification: ${err.message}`);
      return 'verify-failed';
    }
  }

  const rewritten = JSON.stringify(conv);

  // 2. Backup the original blob. A backup we can't write means we don't swap.
  try {
    fs.mkdirSync(backupDir, { recursive: true });
    fs.writeFileSync(path.join(backupDir, `${row.id}.json.gz`), zlib.gzipSync(original, { level: 1 }));
  } catch (err) {
    log(`[ConversationImageBackfill] backup for row ${row.id} failed — row left untouched: ${err.message}`);
    return 'error';
  }

  // 3. Compare-and-swap. updated_at deliberately untouched.
  let changes;
  try {
    changes = await dbRun(
      `UPDATE content_outputs SET content = ? WHERE id = ? AND content = ?`,
      [rewritten, row.id, original]
    );
  } catch (err) {
    log(`[ConversationImageBackfill] update for row ${row.id} failed: ${err.message}`);
    return 'error';
  }
  if (changes === 0) return 'drift';

  return 'migrated';
}

/**
 * Run the full backfill over every candidate row. Rowid-cursor driven so a
 * row that fails (verify/drift/unparseable) is passed over within this run
 * instead of being re-selected forever; migrated rows fall out of the LIKE
 * filter naturally. Yields between rows; calls `shouldContinue()` between
 * batches so the scheduler can pause when the DB gets busy.
 */
export async function runConversationImageBackfill(deps, { batchSize = 10, shouldContinue = () => Promise.resolve(true) } = {}) {
  const { dbAll, backupDir, log } = deps;
  const stats = { migrated: 0, noImages: 0, unparseable: 0, verifyFailed: 0, drift: 0, lowDisk: 0, error: 0, bytesBefore: 0, bytesAfter: 0 };

  if (freeBytes(backupDir) < MIN_FREE_BYTES) {
    log('[ConversationImageBackfill] insufficient free disk space — deferring to next boot');
    return { ...stats, deferred: true };
  }

  pruneOldBackups(backupDir, log);

  // DB clock, not JS clock — updated_at is written by CURRENT_TIMESTAMP (UTC)
  // and string-compared, so the watermark must come from the same clock.
  const watermark = readWatermark(backupDir);
  const nowRows = await dbAll(`SELECT datetime('now') AS now`);
  const runStart = nowRows[0]?.now || null;
  // updated_at of every row this run could NOT complete; the new watermark
  // must stay below all of them so they re-enter next boot.
  const holdbacks = [];

  let cursor = 0;
  for (;;) {
    const rows = await dbAll(
      `SELECT rowid AS rid, id, content, updated_at FROM content_outputs
        WHERE rowid > ? AND content_type = 'conversation'
          AND (? IS NULL OR updated_at IS NULL OR updated_at > ?)
          AND content LIKE '%data:image/%'
        ORDER BY rowid LIMIT ?`,
      [cursor, watermark, watermark, batchSize]
    );
    if (rows.length === 0) break;

    for (const row of rows) {
      cursor = row.rid;
      const before = row.content.length;
      const outcome = await backfillRow(deps, row);
      switch (outcome) {
        case 'migrated': {
          stats.migrated++;
          stats.bytesBefore += before;
          // Cheap recount: the rewritten length is before minus what we removed;
          // re-derive from a fresh read would cost another big query. Close enough
          // for logging — correctness lives in the row itself.
          break;
        }
        case 'no-images': stats.noImages++; break;
        case 'unparseable': stats.unparseable++; break;
        case 'verify-failed': stats.verifyFailed++; holdbacks.push(row.updated_at); break;
        case 'drift': stats.drift++; holdbacks.push(row.updated_at); break;
        case 'low-disk': stats.lowDisk++; holdbacks.push(row.updated_at); break;
        default: stats.error++; holdbacks.push(row.updated_at); break;
      }
      // Yield the event loop between rows — a 68MB parse is already chunky;
      // never stack two back-to-back without letting I/O breathe.
      await new Promise((r) => setImmediate(r));
    }

    if (!(await shouldContinue())) {
      // Watermark deliberately NOT advanced — unvisited rows must be
      // re-considered next boot.
      log('[ConversationImageBackfill] pausing (DB busy) — remaining rows resume next boot');
      return { ...stats, paused: true };
    }
  }

  // Complete pass: advance the watermark to run start, clamped below the
  // oldest row we could not complete. A failed row's updated_at is unchanged
  // (we never touched it), so `updated_at > watermark` re-selects it. The
  // " - 1 second" guards the exclusive comparison against same-second ties.
  if (runStart) {
    let next = runStart;
    for (const ts of holdbacks) {
      if (typeof ts === 'string' && ts.length > 0) {
        const held = await dbAll(`SELECT datetime(?, '-1 seconds') AS t`, [ts]);
        const heldTs = held[0]?.t;
        if (heldTs && heldTs < next) next = heldTs;
      } else {
        // A holdback row with NULL/odd updated_at can't be watermark-tracked;
        // don't advance at all — full rescan next boot is the safe fallback.
        next = null;
        break;
      }
    }
    if (next) writeWatermark(backupDir, next, log);
  }

  if (stats.migrated > 0 || stats.verifyFailed > 0 || stats.error > 0) {
    log(
      `[ConversationImageBackfill] done: migrated=${stats.migrated} noImages=${stats.noImages} ` +
      `unparseable=${stats.unparseable} verifyFailed=${stats.verifyFailed} drift=${stats.drift} ` +
      `lowDisk=${stats.lowDisk} error=${stats.error}`
    );
  }
  return stats;
}

/**
 * Boot-time scheduler. Mirrors scheduleDeferredIndexBuild in
 * models/database/index.js: first check after 5 minutes, require a 3-minute
 * WAL-idle window, re-arm up to ~1h, then give up until next boot (unlike the
 * index build we never force — every row retries next boot for free, so
 * there is no reason to ever collide with a busy install).
 *
 * `deps` must provide: dbAll, dbRun, saveBase64Image, findImageFile,
 * walPath, backupDir, log.
 */
export function scheduleConversationImageBackfill(deps, attempt = 0) {
  const RETRY_DELAY_MS = Number(process.env.AGNT_IMG_BACKFILL_RETRY_MS) || 5 * 60 * 1000;
  const IDLE_THRESHOLD_MS = Number(process.env.AGNT_IMG_BACKFILL_IDLE_MS) || 3 * 60 * 1000;
  const MAX_ATTEMPTS = Number(process.env.AGNT_IMG_BACKFILL_MAX_ATTEMPTS) || 12;

  const isIdle = () =>
    new Promise((resolve) => {
      fs.stat(deps.walPath, (err, st) => {
        if (err) return resolve(true); // no WAL => no recent writes; fail open
        resolve(Date.now() - st.mtimeMs > IDLE_THRESHOLD_MS);
      });
    });

  const timer = setTimeout(async () => {
    try {
      if (!(await isIdle())) {
        if (attempt < MAX_ATTEMPTS) return scheduleConversationImageBackfill(deps, attempt + 1);
        deps.log('[ConversationImageBackfill] DB never went idle — deferring entirely to next boot');
        return;
      }
      await runConversationImageBackfill(deps, { shouldContinue: isIdle });
    } catch (err) {
      deps.log(`[ConversationImageBackfill] run failed (will retry next boot): ${err.message}`);
    }
  }, RETRY_DELAY_MS);
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}
