/**
 * discord-safe-attachment.js
 *
 * Pre-flight optimizer for Discord uploads. Given a source file, decides whether
 * to pass it through, transcode it to a smaller lossy format, or (for video)
 * re-encode + scale down until it fits under the target byte cap.
 *
 * Design rules:
 *  - Never touch files already lossy AND under the cap (pass-through, zero work).
 *  - PNG/BMP/TIFF photos -> JPEG Q88 (typically 15-25x smaller, no visible loss).
 *  - GIF animations -> h.264 MP4 (10-50x smaller, previews inline on Discord).
 *  - Video over cap -> two-pass h.264 CRF ~28, +faststart, yuv420p, downscale
 *    ladder (source -> 720p -> 540p -> 480p) until size fits or floor is hit.
 *  - Uses ffmpeg from PATH (no new npm deps). Fails gracefully if ffmpeg missing.
 *  - All intermediate files land in os.tmpdir() with unique names; caller decides
 *    whether to keep the optimized artifact after upload.
 *
 * This module is intentionally standalone — it has no discord.js dependency,
 * so it can be unit-tested with plain node.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { execFileSync, spawnSync } from 'child_process';

// -------- constants --------------------------------------------------------

// Conservative default: 10 MB works everywhere including legacy webhooks and
// pre-Oct-2024 servers. Discord raised the free-tier cap to 25 MB in Oct 2024
// and Nitro tiers go higher, but 10 MB is the safe common floor.
const DEFAULT_TARGET_LIMIT_BYTES = 10 * 1024 * 1024;

// Leave 8% headroom below the hard cap for multipart/container overhead — a
// 10 MB target really means "aim for <= 9.2 MB payload".
const HEADROOM_RATIO = 0.92;

// JPEG quality tier for photo transcodes. Q88 (ffmpeg -q:v 3) is the
// perceptual sweet spot for high-res photos — visually lossless, ~15-25x
// smaller than a 4:4:4 PNG for the same content.
const JPEG_QVAL = 3;

// Video downscale ladder. We try each in order until the encode fits.
const VIDEO_HEIGHT_LADDER = [null, 720, 540, 480]; // null = keep original height

// Video CRF ladder. Higher = smaller + lossier. 28 is the "small but still
// good" default; 32 is "small and acceptable"; 34 is the floor we won't cross
// without a size ladder step.
const VIDEO_CRF_LADDER = [28, 30, 32, 34];

// MIME categorization by extension. Deliberately narrow — we only need to
// know "is this an image, video, or animation?" to pick a strategy.
const IMAGE_LOSSLESS = new Set(['.png', '.bmp', '.tif', '.tiff']);
const IMAGE_LOSSY = new Set(['.jpg', '.jpeg', '.webp', '.avif', '.heic']);
const VIDEO = new Set(['.mp4', '.mov', '.mkv', '.webm', '.avi', '.m4v']);
const ANIMATION = new Set(['.gif']);
const AUDIO_LOSSY = new Set(['.mp3', '.aac', '.m4a', '.opus', '.ogg']);

// -------- ffmpeg availability probe ---------------------------------------

let _ffmpegAvailable = null;
function ffmpegAvailable() {
  if (_ffmpegAvailable !== null) return _ffmpegAvailable;
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore', timeout: 5000 });
    _ffmpegAvailable = true;
  } catch {
    _ffmpegAvailable = false;
  }
  return _ffmpegAvailable;
}

// -------- helpers ----------------------------------------------------------

function categorize(ext) {
  if (IMAGE_LOSSLESS.has(ext)) return 'image-lossless';
  if (IMAGE_LOSSY.has(ext)) return 'image-lossy';
  if (VIDEO.has(ext)) return 'video';
  if (ANIMATION.has(ext)) return 'animation';
  if (AUDIO_LOSSY.has(ext)) return 'audio';
  return 'other';
}

function tmpPath(suffix) {
  const rand = crypto.randomBytes(6).toString('hex');
  return path.join(os.tmpdir(), `agnt-discord-attach-${rand}${suffix}`);
}

/**
 * Probe a video's duration in seconds using ffprobe. Returns null on failure —
 * the caller falls back to size-based ladder stepping.
 */
function videoDurationSeconds(filePath) {
  try {
    const out = execFileSync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath],
      { encoding: 'utf8', timeout: 10000 },
    );
    const d = parseFloat(out.trim());
    return Number.isFinite(d) && d > 0 ? d : null;
  } catch {
    return null;
  }
}

/**
 * Run ffmpeg synchronously with a given arg list. Returns { ok, stderr, code }.
 * We use spawnSync (not execFileSync) so we can capture stderr on failure
 * without throwing on non-zero exit.
 */
function runFfmpeg(args, timeoutMs = 5 * 60 * 1000) {
  const res = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], {
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
  });
  return { ok: res.status === 0, stderr: res.stderr || '', code: res.status };
}

// -------- transcoders ------------------------------------------------------

/**
 * PNG/BMP/TIFF -> JPEG at Q88 (mjpeg quality scale 3). Preserves pixel data
 * with no visible loss for photo-domain content, drops file size ~15-25x.
 */
function transcodeImageToJpeg(srcPath) {
  const outPath = tmpPath('.jpg');
  const r = runFfmpeg(['-i', srcPath, '-q:v', String(JPEG_QVAL), outPath]);
  if (!r.ok) throw new Error(`ffmpeg JPEG transcode failed: ${r.stderr.slice(0, 500)}`);
  return outPath;
}

/**
 * GIF -> h.264 MP4. Faststart + yuv420p so Discord's inline preview works.
 * We use CRF 28 as a good default; GIFs are usually small enough that we
 * never need to escalate.
 */
function transcodeGifToMp4(srcPath) {
  const outPath = tmpPath('.mp4');
  const r = runFfmpeg([
    '-i', srcPath,
    '-movflags', '+faststart',
    '-pix_fmt', 'yuv420p',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '28',
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', // ensure even dimensions for yuv420p
    outPath,
  ]);
  if (!r.ok) throw new Error(`ffmpeg GIF->MP4 failed: ${r.stderr.slice(0, 500)}`);
  return outPath;
}

/**
 * Video -> smaller video. Tries each combination of (height, CRF) in the
 * downscale + quality ladder until output fits under targetBytes, or returns
 * the smallest attempt if nothing fits (caller can still decide to try
 * uploading it, or fail loud).
 *
 * Bitrate-first strategy would be more optimal but more complex — CRF is
 * good enough for the "make this attachment small enough" job.
 */
function transcodeVideoWithinLimit(srcPath, targetBytes) {
  let bestPath = null;
  let bestSize = Infinity;

  for (const height of VIDEO_HEIGHT_LADDER) {
    for (const crf of VIDEO_CRF_LADDER) {
      const outPath = tmpPath('.mp4');
      const vf = height
        ? `scale=-2:${height}:flags=lanczos`
        : 'scale=trunc(iw/2)*2:trunc(ih/2)*2'; // just ensure even dims

      const r = runFfmpeg([
        '-i', srcPath,
        '-movflags', '+faststart',
        '-pix_fmt', 'yuv420p',
        '-c:v', 'libx264',
        '-preset', 'medium',
        '-crf', String(crf),
        '-vf', vf,
        '-c:a', 'aac',
        '-b:a', '96k',
        outPath,
      ]);

      if (!r.ok) {
        // Clean up partial file and try next tier.
        try { fs.unlinkSync(outPath); } catch {}
        continue;
      }

      const size = fs.statSync(outPath).size;
      if (size < bestSize) {
        // Replace previous best.
        if (bestPath) { try { fs.unlinkSync(bestPath); } catch {} }
        bestPath = outPath;
        bestSize = size;
      } else {
        try { fs.unlinkSync(outPath); } catch {}
      }

      if (size <= targetBytes) {
        return { path: outPath === bestPath ? bestPath : outPath, size, height: height || 'source', crf };
      }
    }
  }

  if (bestPath) {
    return { path: bestPath, size: bestSize, height: 'floor', crf: VIDEO_CRF_LADDER[VIDEO_CRF_LADDER.length - 1] };
  }
  throw new Error('All video transcode attempts failed (ffmpeg errors on every ladder step)');
}

// -------- main entry point -------------------------------------------------

/**
 * Optimize an attachment for Discord upload if needed.
 *
 * @param {string} srcPath          absolute path to source file
 * @param {object} [opts]
 * @param {number} [opts.targetLimitMB=10]  size ceiling in MB
 * @param {boolean} [opts.force=false]      re-encode even if source already fits
 * @returns {object}                        { path, size, wasOptimized, strategy, cleanup, note }
 *
 * `path`         - path to use for the actual upload (may equal srcPath)
 * `size`         - byte size of the final file
 * `wasOptimized` - true if we produced a new file
 * `strategy`     - human-readable string ('pass-through', 'png->jpeg', 'gif->mp4', 'video-reencode:720p/crf28')
 * `cleanup`      - () => void, safe to call even if pass-through (no-op)
 * `note`         - free-form info string useful for logs and tool result envelope
 */
export function optimizeForDiscord(srcPath, opts = {}) {
  const targetMB = Number.isFinite(opts.targetLimitMB) ? opts.targetLimitMB : 10;
  const targetBytes = Math.floor(targetMB * 1024 * 1024 * HEADROOM_RATIO);
  const force = opts.force === true;

  const absPath = path.resolve(srcPath);
  if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
    throw new Error(`optimizeForDiscord: not a regular file: ${absPath}`);
  }

  const srcSize = fs.statSync(absPath).size;
  const ext = path.extname(absPath).toLowerCase();
  const kind = categorize(ext);

  // Case 0: already fits and (lossy OR non-recompressible) -> pass through.
  if (!force && srcSize <= targetBytes && kind !== 'image-lossless' && kind !== 'animation') {
    return {
      path: absPath,
      size: srcSize,
      wasOptimized: false,
      strategy: 'pass-through',
      cleanup: () => {},
      note: `Source fits under ${targetMB} MB cap (${(srcSize / 1024 / 1024).toFixed(2)} MB), no re-encode needed.`,
    };
  }

  // Case 1: PNG/BMP/TIFF (a photo, most likely) -> transcode to JPEG.
  // Even if it already fits, PNGs of photos are almost always wasteful; we
  // still convert if `force` is set. Otherwise we honor the pass-through above.
  if (kind === 'image-lossless') {
    if (!ffmpegAvailable()) {
      // No ffmpeg available -> fall back to pass-through with warning.
      return {
        path: absPath,
        size: srcSize,
        wasOptimized: false,
        strategy: 'pass-through (ffmpeg unavailable)',
        cleanup: () => {},
        note: `ffmpeg not on PATH; cannot transcode ${ext} to JPEG. Uploading original ${(srcSize / 1024 / 1024).toFixed(2)} MB.`,
      };
    }
    // If PNG already fits AND force is false, skip (handled above except for
    // image-lossless which we always want to compress). Reconsider: only
    // convert if the source is over the cap OR force is true. This avoids
    // stripping alpha channels from small icon PNGs the user meant to preserve.
    if (srcSize <= targetBytes && !force) {
      return {
        path: absPath,
        size: srcSize,
        wasOptimized: false,
        strategy: 'pass-through (small PNG)',
        cleanup: () => {},
        note: `PNG under cap (${(srcSize / 1024 / 1024).toFixed(2)} MB); preserved as-is to keep alpha channel.`,
      };
    }
    const outPath = transcodeImageToJpeg(absPath);
    const outSize = fs.statSync(outPath).size;
    return {
      path: outPath,
      size: outSize,
      wasOptimized: true,
      strategy: 'png->jpeg',
      cleanup: () => { try { fs.unlinkSync(outPath); } catch {} },
      note: `Transcoded ${ext} -> JPEG Q88: ${(srcSize / 1024 / 1024).toFixed(2)} MB -> ${(outSize / 1024 / 1024).toFixed(2)} MB (${(srcSize / outSize).toFixed(1)}x smaller).`,
    };
  }

  // Case 2: GIF -> MP4 (huge win, inline previews).
  if (kind === 'animation') {
    if (!ffmpegAvailable()) {
      return {
        path: absPath,
        size: srcSize,
        wasOptimized: false,
        strategy: 'pass-through (ffmpeg unavailable)',
        cleanup: () => {},
        note: `ffmpeg not on PATH; cannot transcode GIF to MP4. Uploading original ${(srcSize / 1024 / 1024).toFixed(2)} MB.`,
      };
    }
    const outPath = transcodeGifToMp4(absPath);
    const outSize = fs.statSync(outPath).size;
    return {
      path: outPath,
      size: outSize,
      wasOptimized: true,
      strategy: 'gif->mp4',
      cleanup: () => { try { fs.unlinkSync(outPath); } catch {} },
      note: `Transcoded GIF -> h.264 MP4: ${(srcSize / 1024 / 1024).toFixed(2)} MB -> ${(outSize / 1024 / 1024).toFixed(2)} MB.`,
    };
  }

  // Case 3: Video over cap -> re-encode with downscale ladder.
  if (kind === 'video' && (srcSize > targetBytes || force)) {
    if (!ffmpegAvailable()) {
      return {
        path: absPath,
        size: srcSize,
        wasOptimized: false,
        strategy: 'pass-through (ffmpeg unavailable)',
        cleanup: () => {},
        note: `ffmpeg not on PATH; cannot re-encode video. Uploading original ${(srcSize / 1024 / 1024).toFixed(2)} MB.`,
      };
    }
    const duration = videoDurationSeconds(absPath); // informational only
    const res = transcodeVideoWithinLimit(absPath, targetBytes);
    const fitsNow = res.size <= targetBytes;
    return {
      path: res.path,
      size: res.size,
      wasOptimized: true,
      strategy: `video-reencode:${res.height === 'source' ? 'source' : res.height}p/crf${res.crf}`,
      cleanup: () => { try { fs.unlinkSync(res.path); } catch {} },
      note: `Video re-encoded to h.264 (target ${targetMB} MB${duration ? `, ${duration.toFixed(1)}s source` : ''}): ${(srcSize / 1024 / 1024).toFixed(2)} MB -> ${(res.size / 1024 / 1024).toFixed(2)} MB${fitsNow ? '' : ' [STILL OVER CAP — floor of ladder reached]'}.`,
    };
  }

  // Case 4: Anything else over cap (lossy image, audio, "other") -> we can't
  // usefully compress without more info. Pass through with a warning.
  return {
    path: absPath,
    size: srcSize,
    wasOptimized: false,
    strategy: 'pass-through (over cap, no strategy)',
    cleanup: () => {},
    note: `Source is ${(srcSize / 1024 / 1024).toFixed(2)} MB (over ${targetMB} MB cap) but is ${kind}; no safe auto-optimization strategy. Consider manually compressing before upload.`,
  };
}

// Named exports for testability.
export const _internal = {
  categorize,
  ffmpegAvailable,
  DEFAULT_TARGET_LIMIT_BYTES,
  HEADROOM_RATIO,
};
