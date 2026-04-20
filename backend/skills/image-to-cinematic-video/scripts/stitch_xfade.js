/**
 * stitch_xfade.js
 *
 * Stitch an array of clips together with an FFmpeg `xfade` crossfade.
 * This is the exact invocation that was used for the successful run.
 *
 * For CHAIN mode: use a SHORT fade (0.15s). The frames already match
 *   pixel-for-pixel at the seams (because each scene starts on the
 *   previous scene's last frame), so a fancy/long transition would
 *   throw away continuity we just paid Seedance minutes to generate.
 *
 * For PARALLEL mode: a longer decorative fade (0.5s) is usually nicer
 *   because each clip starts from the SAME reference image and the
 *   seams have visible resets — the crossfade softens them.
 *
 * Command template (per scene pair):
 *   ffmpeg -y -i a.mp4 -i b.mp4 \
 *     -filter_complex "[0:v][1:v]xfade=transition=fade:duration=D:offset=O[v]" \
 *     -map "[v]" -c:v libx264 -preset medium -crf 18 \
 *     -pix_fmt yuv420p -movflags +faststart out.mp4
 *
 * For 3+ clips we chain xfade filters. Video only — Seedance clips are
 * silent, and we don't try to mux audio here.
 *
 * Usage:
 *   const { stitchXfade } = require(
 *     'C:/Users/Studio/.agnt/skills/image-to-cinematic-video/scripts/stitch_xfade.js'
 *   );
 *   await stitchXfade({
 *     clips: [scene1, scene2, scene3],       // absolute paths
 *     outputPath: path.join(projectDir, 'final.mp4'),
 *     fadeDuration: 0.15,                     // chain mode default
 *   });
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function probeDuration(p) {
  const out = execSync(
    `ffprobe -v error -show_entries format=duration -of default=nk=1:nw=1 "${p}"`
  ).toString().trim();
  return parseFloat(out);
}

/**
 * @param {Object} opts
 * @param {string[]} opts.clips           absolute paths, in order
 * @param {string} opts.outputPath        absolute path to final mp4
 * @param {number} [opts.fadeDuration=0.15]
 * @param {string} [opts.transition='fade']  xfade transition name
 *        (fade, fadeblack, dissolve, wipeleft, slideup, circleopen, ...)
 * @param {number} [opts.crf=18]          x264 quality (lower=better)
 * @returns {Promise<{outputPath:string, durationSec:number, sizeBytes:number}>}
 */
async function stitchXfade(opts) {
  const {
    clips,
    outputPath,
    fadeDuration = 0.15,
    transition = 'fade',
    crf = 18,
  } = opts;
  if (!clips || clips.length < 2) throw new Error('need >= 2 clips');
  for (const c of clips) if (!fs.existsSync(c)) throw new Error(`missing clip: ${c}`);
  const outDir = path.dirname(outputPath);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const durations = clips.map(probeDuration);

  // Build -i flags
  const inputs = clips.map((c) => `-i "${c}"`).join(' ');

  // Build xfade chain.
  //  For 2 clips: [0:v][1:v]xfade=...:offset=d0-F[v]
  //  For 3 clips: [0:v][1:v]xfade=...:offset=d0-F[v01];
  //               [v01][2:v]xfade=...:offset=d0+d1-2F[v]
  const parts = [];
  let prevLabel = '[0:v]';
  let cumOffset = 0;
  for (let i = 1; i < clips.length; i++) {
    cumOffset += durations[i - 1] - fadeDuration;
    const isLast = i === clips.length - 1;
    const outLabel = isLast ? '[v]' : `[v${i}]`;
    parts.push(
      `${prevLabel}[${i}:v]xfade=transition=${transition}:` +
      `duration=${fadeDuration}:offset=${cumOffset.toFixed(3)}${outLabel}`
    );
    prevLabel = outLabel;
  }
  const filter = parts.join(';');

  const cmd = [
    'ffmpeg -y',
    inputs,
    `-filter_complex "${filter}"`,
    '-map "[v]"',
    `-c:v libx264 -preset medium -crf ${crf} -pix_fmt yuv420p`,
    '-movflags +faststart',
    `"${outputPath}"`,
  ].join(' ');

  execSync(cmd, { stdio: 'pipe', shell: true });

  return {
    outputPath,
    durationSec: probeDuration(outputPath),
    sizeBytes: fs.statSync(outputPath).size,
  };
}

module.exports = { stitchXfade, probeDuration };
