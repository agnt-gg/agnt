/**
 * extract_and_upload_last_frame.js
 *
 * Between every scene in CHAIN mode:
 *   1. Extract the last frame of scene N as a JPG (into projectDir/frames/)
 *   2. Upload it to uguu so scene N+1 can use it as `firstFrameUrl`
 *
 * Both steps ALWAYS happen together — splitting them invites bugs where
 * the extracted frame is on disk but no URL exists, and we've already
 * paid for the next seedance call.
 *
 * FFmpeg recipe:
 *   ffmpeg -y -sseof -0.1 -i <video> -vframes 1 -q:v 2 <out.jpg>
 *
 *   -sseof -0.1  = seek to 100ms before end of file. Safer than 0
 *                   because some codecs have no keyframe at the exact end.
 *   -vframes 1   = grab exactly one frame
 *   -q:v 2       = highest-quality JPEG (1 best, 31 worst)
 *
 *   100ms back is visually indistinguishable from the true last frame,
 *   so continuity with scene N+1 is pixel-perfect.
 *
 * Usage:
 *   const { extractAndUploadLastFrame } = require(
 *     'C:/Users/Studio/.agnt/skills/image-to-cinematic-video/scripts/extract_and_upload_last_frame.js'
 *   );
 *   const { framePath, frameUrl } =
 *     await extractAndUploadLastFrame(sceneMp4, projectDir, 'scene1');
 *   // framePath → projectDir/frames/scene1_last.jpg   (saved locally)
 *   // frameUrl  → https://o.uguu.se/XYZ.jpg           (pass to next seedance)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { uploadUguu } = require('./upload_uguu.js');

/**
 * @param {string} videoPath   absolute path to the scene .mp4
 * @param {string} projectDir  project root (frames/ subdir must exist)
 * @param {string} label       e.g. "scene1" — used in the frame filename
 * @returns {Promise<{framePath:string, frameUrl:string}>}
 */
async function extractAndUploadLastFrame(videoPath, projectDir, label) {
  if (!fs.existsSync(videoPath)) throw new Error(`video not found: ${videoPath}`);
  const framesDir = path.join(projectDir, 'frames');
  if (!fs.existsSync(framesDir)) fs.mkdirSync(framesDir, { recursive: true });

  const framePath = path.join(framesDir, `${label}_last.jpg`);

  execSync(
    `ffmpeg -y -sseof -0.1 -i "${videoPath}" -vframes 1 -q:v 2 "${framePath}"`,
    { stdio: 'pipe' }
  );
  const size = fs.statSync(framePath).size;
  if (size < 2000) throw new Error(`extracted frame tiny (${size}B): ${framePath}`);

  const frameUrl = await uploadUguu(framePath);
  return { framePath, frameUrl, sizeBytes: size };
}

/**
 * Bare last-frame extraction (no upload) — used for thumbnails / the
 * FINAL scene where we don't need a URL.
 */
function extractLastFrame(videoPath, outputJpg) {
  const dir = path.dirname(outputJpg);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  execSync(
    `ffmpeg -y -sseof -0.1 -i "${videoPath}" -vframes 1 -q:v 2 "${outputJpg}"`,
    { stdio: 'pipe' }
  );
  return outputJpg;
}

module.exports = { extractAndUploadLastFrame, extractLastFrame };
